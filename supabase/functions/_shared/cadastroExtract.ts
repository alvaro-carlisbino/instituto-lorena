import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { enrichEnderecoViaCep } from './cep.ts'
import { maybeReshipAfterAddressComplete } from './melhorEnvio.ts'
import { brPhoneVariants, isPlaceholderName } from './crm.ts'

// LLM = mesma config do resto do CRM: Z.ai (GLM) por env, com fallback OpenAI.
function normalizeApiRoot(raw: string): string {
  const trimmed = (raw ?? '').trim().replace(/\/$/, '')
  if (!trimmed || trimmed.includes('/coding/')) return 'https://api.z.ai/api/paas/v4'
  return trimmed
}

function llmConfig(): { apiKey: string; url: string; model: string } | null {
  const zaiKey = (Deno.env.get('ZAI_API_KEY') ?? '').trim()
  if (zaiKey) {
    const root = normalizeApiRoot(Deno.env.get('ZAI_API_BASE') ?? '')
    const model = (Deno.env.get('ZAI_MODEL') ?? '').trim() || 'glm-4.7'
    return { apiKey: zaiKey, url: `${root}/chat/completions`, model }
  }
  const oaKey = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
  if (oaKey) {
    const model = (Deno.env.get('OPENAI_MODEL') ?? '').trim() || 'gpt-4o-mini'
    return { apiKey: oaKey, url: 'https://api.openai.com/v1/chat/completions', model }
  }
  return null
}

/**
 * Captura passiva de dados de cadastro do paciente no fluxo da conversa.
 * Quando a mensagem do paciente tem pista de cadastro (e-mail, data, CPF ou
 * palavras-chave), extrai nome/nascimento/sexo/email/cpf e guarda em
 * leads.custom_fields.cadastro — preenchendo só o que falta. Assim o
 * agendamento pelo CRM (Shosp) já vem com os campos prontos, sem digitar.
 */


export type EnderecoFields = {
  cep?: string; logradouro?: string; numero?: string
  bairro?: string; cidade?: string; uf?: string; complemento?: string
}

export type CadastroFields = {
  nomeCompleto?: string
  dataNascimento?: string // DD/MM/AAAA
  sexo?: string // M | F
  email?: string
  cpf?: string
  /** Telefone de contato ditado na conversa (só dígitos, sem +). */
  telefone?: string
  /** Endereço de ENTREGA capturado da conversa (gravado em custom_fields.entrega). */
  endereco?: EnderecoFields
}

const EMAIL_RX = /[\w.+-]+@[\w-]+\.[\w.-]+/
const DATE_RX = /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/
const CPF_RX = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/
const CEP_RX = /\b\d{5}-?\d{3}\b/

/** Gate barato: só chama o LLM quando há sinal de dado de cadastro OU de endereço. */
export function textHasCadastroHints(text: string): boolean {
  if (!text) return false
  if (EMAIL_RX.test(text) || CPF_RX.test(text) || DATE_RX.test(text) || CEP_RX.test(text)) return true
  return /nasc|nascimento|meu nome|me chamo|cpf|e-?mail|endere[çc]o|\brua\b|\bavenida\b|\bav\.?\b|bairro|n[uú]mero|\bcep\b|\bn[º°]\b/i.test(text)
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  // GLM às vezes embrulha em ```json ... ``` ou texto — pega o primeiro {...}.
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0]) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function extractCadastro(conversationText: string): Promise<CadastroFields> {
  const cfg = llmConfig()
  if (!cfg) return {}
  let res: Response
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'Extraia dados de cadastro e ENDEREÇO DE ENTREGA do cliente a partir da mensagem. Responda APENAS um objeto JSON (sem texto fora dele, sem markdown) com as chaves que encontrar: nomeCompleto, dataNascimento (formato DD/MM/AAAA), sexo (M ou F), email, cpf, telefone (só dígitos, com DDD), e endereco (um objeto com cep, logradouro, numero, bairro, cidade, uf [sigla de 2 letras], complemento). Omita chaves sem valor claro. NÃO invente. dataNascimento só se for claramente a data de nascimento (nunca data de consulta/agendamento). telefone só quando o cliente estiver informando o telefone de contato DELE (nunca o telefone da clínica/loja, nunca CPF). Preencha endereco SÓ quando o cliente estiver informando o endereço de entrega dele. Se não houver nada, responda {}.',
          },
          { role: 'user', content: conversationText.slice(0, 4000) },
        ],
      }),
    })
  } catch {
    return {}
  }
  if (!res.ok) return {}
  const data = (await res.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return {}
  try {
    const parsed = extractJsonObject(content)
    if (!parsed) return {}
    const out: CadastroFields = {}
    if (typeof parsed.nomeCompleto === 'string' && parsed.nomeCompleto.trim().split(' ').length >= 2) {
      out.nomeCompleto = parsed.nomeCompleto.trim()
    }
    if (typeof parsed.dataNascimento === 'string' && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(parsed.dataNascimento)) {
      out.dataNascimento = parsed.dataNascimento.trim()
    }
    const sx = String(parsed.sexo ?? '').toUpperCase()
    if (sx === 'M' || sx === 'F') out.sexo = sx
    if (typeof parsed.email === 'string' && EMAIL_RX.test(parsed.email)) out.email = parsed.email.trim()
    if (typeof parsed.cpf === 'string' && CPF_RX.test(parsed.cpf)) out.cpf = parsed.cpf.trim()
    // Telefone BR: 10 (fixo) ou 11 (celular) dígitos, com ou sem o 55 na frente. Descarta
    // o que o LLM confundiu com CPF (11 dígitos também) checando o DDD e o 9º dígito.
    if (parsed.telefone != null) {
      const tel = String(parsed.telefone).replace(/\D/g, '').replace(/^55/, '')
      const dddOk = tel.length >= 10 && Number(tel.slice(0, 2)) >= 11 && Number(tel.slice(0, 2)) <= 99
      const celOk = tel.length === 11 && tel[2] === '9'
      const fixoOk = tel.length === 10 && /^[2-5]/.test(tel[2] ?? '')
      if (dddOk && (celOk || fixoOk) && tel !== String(out.cpf ?? '').replace(/\D/g, '')) {
        out.telefone = tel
      }
    }
    if (parsed.endereco && typeof parsed.endereco === 'object') {
      const e = parsed.endereco as Record<string, unknown>
      const end: EnderecoFields = {}
      const cep = String(e.cep ?? '').replace(/\D/g, '')
      if (cep.length === 8) end.cep = cep
      for (const k of ['logradouro', 'numero', 'bairro', 'cidade', 'complemento'] as const) {
        const v = String(e[k] ?? '').trim()
        if (v) end[k] = v.slice(0, 120)
      }
      const uf = String(e.uf ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
      if (uf.length === 2) end.uf = uf
      if (Object.keys(end).length) out.endereco = end
    }
    return out
  } catch {
    return {}
  }
}

/**
 * O nome do lead vem do "push name" do WhatsApp — quase sempre o apelido, em minúsculas
 * ("giovana"). Quando o paciente manda o nome completo pra Dandara fazer o cadastro, esse
 * nome tem que virar o nome do lead: é ele que aparece no quadro, na agenda da Shosp, no
 * pedido e no PDF do histórico. Antes ficava só enterrado em custom_fields.cadastro.
 *
 * Só promove quando é seguro — ou o nome atual é placeholder, ou é um primeiro nome solto,
 * ou o nome completo COMEÇA com o atual (é a mesma pessoa, mais completa). Nome já editado
 * à mão com sobrenome diferente NUNCA é sobrescrito.
 */
export function shouldPromoteName(atual: string, completo: string): boolean {
  const a = (atual ?? '').trim()
  const c = (completo ?? '').trim()
  if (c.split(/\s+/).length < 2) return false
  if (!a || isPlaceholderName(a)) return true
  if (a.toLowerCase() === c.toLowerCase()) return false
  const soUmNome = a.split(/\s+/).length === 1
  const ehPrefixo = c.toLowerCase().startsWith(a.toLowerCase() + ' ')
  return soUmNome || ehPrefixo
}

/** Telefone sintético do ManyChat (prefixo 888001): placeholder, qualquer real é melhor. */
const isSyntheticPhone = (phone: string): boolean => /^888001\d*$/.test((phone ?? '').replace(/\D/g, ''))

/** Convenção do CRM: só dígitos, com 55 na frente (55 + DDD + número). */
const toCrmPhone = (tel: string): string => {
  const d = (tel ?? '').replace(/\D/g, '').replace(/^55/, '')
  return d.length >= 10 ? `55${d}` : ''
}

/** Best-effort: extrai e grava em leads.custom_fields.cadastro (só preenche o que falta). */
export async function captureCadastroForLead(
  admin: SupabaseClient,
  leadId: string,
  inboundText: string,
): Promise<CadastroFields | null> {
  try {
    if (!textHasCadastroHints(inboundText)) return null
    const fields = await extractCadastro(inboundText)
    if (!Object.keys(fields).length) return null
    const { data: lead } = await admin
      .from('leads')
      .select('custom_fields, patient_name, phone')
      .eq('id', leadId)
      .maybeSingle()
    const leadRow = lead as
      | { custom_fields?: Record<string, unknown>; patient_name?: string; phone?: string }
      | null
    const cf = (leadRow?.custom_fields ?? {}) as Record<string, unknown>
    const cadastro = { ...((cf.cadastro as Record<string, unknown>) ?? {}) }
    const entrega = { ...((cf.entrega as Record<string, unknown>) ?? {}) }
    let changed = false
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'endereco') continue // endereço vai para custom_fields.entrega, não cadastro
      if (v && !cadastro[k]) {
        cadastro[k] = v
        changed = true
      }
    }
    // Endereço de entrega: preenche só o que falta em custom_fields.entrega (não sobrescreve
    // delivery_mode/service já gravados). Assim, quando o cliente manda o endereço pra IA, o
    // pedido já pago ganha o endereço — o aviso "registre o endereço" some sozinho.
    if (fields.endereco) {
      for (const [k, v] of Object.entries(fields.endereco)) {
        if (v && !entrega[k]) {
          entrega[k] = v
          changed = true
        }
      }
    }
    // Rua/bairro/cidade/UF que o cliente não ditou vêm do ViaCEP pelo CEP — sem isso o
    // endereço fica gravado só com CEP + número.
    if (entrega.cep) {
      const antes = JSON.stringify(entrega)
      const cheio = await enrichEnderecoViaCep(entrega)
      if (JSON.stringify(cheio) !== antes) {
        Object.assign(entrega, cheio)
        changed = true
      }
    }
    // O cadastro não pode ficar só no JSON: promove pras COLUNAS do lead o que a clínica
    // enxerga (nome no quadro/agenda, telefone pra ligar). Era exatamente isto que faltava —
    // a Dandara pedia todos os dados, o cliente mandava, e o lead continuava "giovana" com
    // telefone sintético do ManyChat.
    const patch: Record<string, unknown> = {}

    const nomeAtual = String(leadRow?.patient_name ?? '')
    const nomeCompleto = String(cadastro.nomeCompleto ?? '')
    if (nomeCompleto && shouldPromoteName(nomeAtual, nomeCompleto)) {
      patch.patient_name = nomeCompleto
      changed = true
    }

    // Telefone: SÓ substitui o sintético `888001…` do ManyChat (que não disca). Número real
    // já gravado nunca é trocado pelo que o cliente digitou — pode ser o do marido, do filho.
    const telAtual = String(leadRow?.phone ?? '')
    const telNovo = toCrmPhone(String(cadastro.telefone ?? ''))
    if (telNovo && isSyntheticPhone(telAtual)) {
      // Guarda anti-duplicado: se outro lead já é dono desse número, deixa como está — juntar
      // os dois é decisão humana (/mesclar-leads), não efeito colateral de um webhook.
      const variants = brPhoneVariants(telNovo)
      const { data: donoAtual } = await admin
        .from('leads')
        .select('id')
        .in('phone', variants.length ? variants : [telNovo])
        .neq('id', leadId)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (!donoAtual) {
        patch.phone = telNovo
        changed = true
      }
    }

    if (!changed) return null
    await admin
      .from('leads')
      .update({ custom_fields: { ...cf, cadastro, entrega }, ...patch })
      .eq('id', leadId)
    // Endereço completado DEPOIS do pagamento (caso Kellen: o checkout do site entra sem o
    // número da casa, o cliente manda pelo WhatsApp minutos depois) → religa o envio que o
    // fechamento pulou por `sem_numero`/`sem_cep`. Totalmente guardado e best-effort lá dentro.
    await maybeReshipAfterAddressComplete(admin, leadId)
    return fields
  } catch {
    return null
  }
}
