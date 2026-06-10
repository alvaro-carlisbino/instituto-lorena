import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

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


export type CadastroFields = {
  nomeCompleto?: string
  dataNascimento?: string // DD/MM/AAAA
  sexo?: string // M | F
  email?: string
  cpf?: string
}

const EMAIL_RX = /[\w.+-]+@[\w-]+\.[\w.-]+/
const DATE_RX = /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/
const CPF_RX = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/

/** Gate barato: só chama o LLM quando há sinal de dado de cadastro. */
export function textHasCadastroHints(text: string): boolean {
  if (!text) return false
  if (EMAIL_RX.test(text) || CPF_RX.test(text) || DATE_RX.test(text)) return true
  return /nasc|nascimento|meu nome|me chamo|cpf|e-?mail/i.test(text)
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
              'Extraia dados de cadastro do PACIENTE a partir da mensagem. Responda APENAS um objeto JSON (sem texto fora dele, sem markdown) com as chaves que encontrar: nomeCompleto, dataNascimento (formato DD/MM/AAAA), sexo (M ou F), email, cpf. Omita chaves sem valor claro. NÃO invente. dataNascimento só se for claramente a data de nascimento do paciente (nunca data de consulta/agendamento). Se não houver nada, responda {}.',
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
    return out
  } catch {
    return {}
  }
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
    const { data: lead } = await admin.from('leads').select('custom_fields').eq('id', leadId).maybeSingle()
    const cf = ((lead as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>
    const cadastro = { ...((cf.cadastro as Record<string, unknown>) ?? {}) }
    let changed = false
    for (const [k, v] of Object.entries(fields)) {
      if (v && !cadastro[k]) {
        cadastro[k] = v
        changed = true
      }
    }
    if (!changed) return null
    await admin.from('leads').update({ custom_fields: { ...cf, cadastro } }).eq('id', leadId)
    return fields
  } catch {
    return null
  }
}
