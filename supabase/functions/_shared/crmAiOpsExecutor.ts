import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { insertInteraction } from './crm.ts'
import { notifyAgents } from './notifyAgents.ts'
import { shospGetAgenda, shospSchedule } from './shosp.ts'
import { createPagBankCheckout, PAGBANK_KITS, normalizeKitKey } from './pagbank.ts'
import { createRedeIntent, createRedePix, resolveRedeKit, REDE_KIT_MAX_INSTALLMENTS, inferRedeKit } from './rede.ts'
import { formatBRLCents, normalizeCouponCode } from './coupons.ts'
import { applyFreightMarkup, boxForKit, declaredValueCentsForKit, isFreeShippingKit, localDeliveryCents, melhorEnvioConfigured, quoteFreteMelhorEnvio } from './melhorEnvio.ts'
import { enrichEnderecoViaCep, resolveCepBrasil } from './cep.ts'

/** Modalidades de entrega canônicas (gravadas em custom_fields.entrega.delivery_mode). */
const DELIVERY_MODES = ['retirada_clinica', 'entrega_local_maringa', 'envio_externo'] as const
function normalizeDeliveryMode(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase()
  return (DELIVERY_MODES as readonly string[]).includes(s) ? s : ''
}

/**
 * Resolve o frete em centavos para um op de fechamento (pix/cartão):
 *  - Se a IA mandou `freight_service` ("PAC"/"SEDEX") + `to_cep`, RECOTA no servidor
 *    (Melhor Envio) e usa o valor autoritativo — não confia no número copiado pela IA.
 *  - Caso contrário, usa `freight_cents`/`freightCents` literal (compatível com o fluxo antigo).
 * Devolve `undefined` quando não há frete (ex.: retirada na clínica).
 */
async function resolveFreightCents(
  admin: SupabaseClient,
  tenantId: string,
  op: Record<string, unknown>,
): Promise<number | undefined> {
  const literalRaw = op.freight_cents ?? op.freightCents
  const literal =
    literalRaw != null && Number.isFinite(Number(literalRaw)) ? Math.max(0, Math.round(Number(literalRaw))) : undefined

  // MODALIDADE define o frete antes de qualquer cotação:
  //  - retirada_clinica   → sem frete (cliente busca na clínica)
  //  - entrega_local_maringa → entrega da equipe: R$ 15 em Maringá, R$ 20 na região
  //    (Sarandi/Paiçandu/Marialva). A praça é resolvida pelo CEP (ViaCEP); sem CEP
  //    válido cai na taxa de Maringá (default de localDeliveryCents).
  //  - envio_externo / ausente → cota o Melhor Envio (abaixo)
  const deliveryMode = normalizeDeliveryMode(op.delivery_mode ?? op.to_delivery_mode)
  if (deliveryMode === 'retirada_clinica') return undefined
  // FRETE GRÁTIS por kit (alavanca de ticket — default kit 5 meses): zera o frete em qualquer
  // modalidade de envio. Vale antes da cotação/taxa local.
  if (isFreeShippingKit(op.kit)) return 0
  if (deliveryMode === 'entrega_local_maringa') {
    const cepDigits = String(op.to_cep ?? op.toCep ?? op.cep ?? '').replace(/\D/g, '')
    const cityInfo = cepDigits.length === 8 ? await resolveCepBrasil(cepDigits) : null
    return localDeliveryCents(cityInfo)
  }

  const toCep = String(op.to_cep ?? op.toCep ?? op.cep ?? '').replace(/\D/g, '')
  // Cota sempre que há CEP válido (não depende mais da IA citar "PAC"/"SEDEX"): o valor
  // autoritativo é o do Melhor Envio, não o serviço que a IA escolheu.
  if (toCep.length === 8 && melhorEnvioConfigured()) {
    try {
      // A caixa ESCALA com o kit (peso real): sem isto o frete de 4 frascos saía como o de 1.
      const box = boxForKit(op.kit)
      // SEGURO/valor declarado: a etiqueta real (autoShipToCart) é comprada declarando o valor do
      // produto, e os Correios cobram isso como %. A cotação que COBRA o cliente tem que incluir o
      // MESMO seguro — senão a etiqueta sai sempre mais cara que o cobrado. Usa o valor do kit
      // (ou amount_cents avulso); kit desconhecido cai no seguro padrão.
      const insuranceCents =
        declaredValueCentsForKit(op.kit) ??
        (op.amount_cents != null && Number.isFinite(Number(op.amount_cents)) ? Math.max(0, Math.round(Number(op.amount_cents))) : undefined) ??
        undefined
      const q = await quoteFreteMelhorEnvio(admin, tenantId, toCep, {
        ...(box ? { box } : {}),
        ...(insuranceCents != null ? { insuranceCents } : {}),
      })
      // COBRA SEMPRE a transportadora MAIS BARATA cotada (qualquer empresa: Correios, Jadlog,
      // Loggi…), não o serviço que a IA citou — assim o valor bate com o real e fica idêntico
      // ao que a etiqueta (autoShipToCart) vai pagar, que também pega a mais barata. options[0]
      // já vem ordenado do mais barato pelo Melhor Envio. Aplica margem (markup + arredonda).
      const chosen = q.ok ? (q.options[0] ?? null) : null
      if (chosen) return applyFreightMarkup(chosen.priceCents, { internal: chosen.internal })
    } catch {
      // cai no literal abaixo
    }
  }
  return literal
}

/**
 * Persiste o endereço de entrega capturado na venda em `lead.custom_fields.entrega`
 * (cep/numero/complemento/serviço). É o que o envio AUTOMÁTICO no Melhor Envio usa no
 * fechamento. Best-effort: nunca lança. Faz merge (não apaga campos já capturados).
 */
type CadastroSnapshot = Record<string, unknown>
type EntregaSnapshot = Record<string, unknown>

async function persistEntrega(
  admin: SupabaseClient,
  leadId: string,
  op: Record<string, unknown>,
): Promise<{ cadastro: CadastroSnapshot; entrega: EntregaSnapshot }> {
  try {
    const { data } = await admin.from('leads').select('custom_fields, phone').eq('id', leadId).maybeSingle()
    const cf = ((data as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>
    const leadPhone = String((data as { phone?: string } | null)?.phone ?? '').replace(/\D/g, '')
    const prev = (cf.entrega ?? {}) as Record<string, unknown>
    const prevCad = (cf.cadastro ?? {}) as Record<string, unknown>

    const cep = String(op.to_cep ?? op.toCep ?? op.cep ?? '').replace(/\D/g, '')
    const str = (v: unknown) => (v == null ? undefined : String(v).trim() || undefined)

    // CEP novo ≠ CEP já gravado → rua/bairro/cidade/UF antigos pertencem ao endereço velho;
    // não podem ser herdados (viram endereço "Frankenstein").
    const prevCep = String(prev.cep ?? '').replace(/\D/g, '')
    const cepMudou = cep.length === 8 && prevCep.length === 8 && cep !== prevCep
    const base = cepMudou ? { ...prev, logradouro: undefined, bairro: undefined, cidade: undefined, uf: undefined } : prev

    // ENTREGA: só sobrescreve campos que vieram no op (merge — nunca apaga o já capturado).
    let entrega: EntregaSnapshot = {
      ...base,
      ...(cep.length === 8 ? { cep } : {}),
      numero: str(op.to_number) ?? base.numero,
      complemento: str(op.to_complement) ?? base.complemento,
      bairro: str(op.to_neighborhood ?? op.to_bairro) ?? base.bairro,
      logradouro: str(op.to_street ?? op.to_logradouro ?? op.to_address) ?? base.logradouro,
      cidade: str(op.to_city ?? op.to_cidade) ?? base.cidade,
      uf: (str(op.to_uf ?? op.to_state) ?? (base.uf as string | undefined))?.toUpperCase(),
      service: str(op.freight_service) ?? base.service,
      delivery_mode: normalizeDeliveryMode(op.delivery_mode ?? op.to_delivery_mode) || base.delivery_mode,
    }
    // Cliente manda só "CEP + número" — rua/bairro/cidade/UF vêm do ViaCEP (senão o
    // endereço fica salvo só com o número).
    entrega = await enrichEnderecoViaCep(entrega)

    // CADASTRO completo (NF-e): nome, CPF, telefone, e-mail, nascimento, sexo — merge quando vierem no op.
    const cpf = String(op.to_cpf ?? op.cpf ?? '').replace(/\D/g, '')
    const sexoRaw = String(op.to_sex ?? op.to_sexo ?? '').trim().toUpperCase()
    // TELEFONE: prioriza o que a IA capturou no op; senão herda o já gravado; senão AUTO do
    // número do WhatsApp do lead (leads.phone). Assim o telefone quase sempre existe sem atrito,
    // e a trava de prontidão só barra quando não há nenhum número estruturado.
    const opPhone = String(op.to_phone ?? op.to_telefone ?? op.phone ?? op.telefone ?? '').replace(/\D/g, '')
    const prevPhone = String(prevCad.telefone ?? '').replace(/\D/g, '')
    const telefone = opPhone.length >= 10 ? opPhone : prevPhone.length >= 10 ? prevPhone : leadPhone.length >= 10 ? leadPhone : ''
    const cadastro: CadastroSnapshot = {
      ...prevCad,
      nomeCompleto: str(op.to_name ?? op.to_nome ?? op.customer_name) ?? prevCad.nomeCompleto,
      ...(cpf.length === 11 ? { cpf } : {}),
      ...(telefone ? { telefone } : {}),
      email: str(op.to_email ?? op.email) ?? prevCad.email,
      dataNascimento: str(op.to_birthdate ?? op.to_nascimento) ?? prevCad.dataNascimento,
      ...(['M', 'F'].includes(sexoRaw) ? { sexo: sexoRaw } : {}),
    }

    await admin.from('leads').update({ custom_fields: { ...cf, entrega, cadastro } }).eq('id', leadId)
    return { cadastro, entrega }
  } catch {
    return { cadastro: {}, entrega: {} }
  }
}

/**
 * Trava de prontidão antes de gerar QUALQUER link/Pix: como a NF-e é emitida automática no
 * fechamento, o pedido precisa de cadastro completo SEMPRE (inclusive retirada). Exige nome
 * completo + telefone + CPF(11) + CEP(8) + número. O telefone é auto-preenchido do WhatsApp
 * em persistEntrega, então só barra quando não há número nenhum (raro). Devolve o que falta
 * (em pt-BR) p/ a IA pedir.
 */
function validateOrderReadiness(
  cadastro: CadastroSnapshot,
  entrega: EntregaSnapshot,
): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  const nome = String(cadastro.nomeCompleto ?? '').trim()
  const telefone = String(cadastro.telefone ?? '').replace(/\D/g, '')
  const cpf = String(cadastro.cpf ?? '').replace(/\D/g, '')
  const cep = String(entrega.cep ?? '').replace(/\D/g, '')
  const numero = String(entrega.numero ?? '').trim()
  const logradouro = String(entrega.logradouro ?? '').trim()
  if (nome.split(/\s+/).filter(Boolean).length < 2) missing.push('nome completo')
  if (telefone.length < 10) missing.push('telefone com DDD')
  if (cpf.length !== 11) missing.push('CPF')
  if (cep.length !== 8) missing.push('CEP')
  if (!numero) missing.push('número do endereço')
  // Rua: o ViaCEP preenche sozinho em persistEntrega; só chega vazio quando o CEP é
  // "geral" (cidade inteira/rural) — aí a IA precisa pedir a rua ao cliente.
  if (!logradouro) missing.push('nome da rua (o CEP não identifica a rua sozinho)')
  return { ok: missing.length === 0, missing }
}

/**
 * Aviso ao cliente quando a entrega é RETIRADA na clínica: informa o prazo de liberação
 * (1 dia útil após a confirmação do pagamento). Anexado à mensagem do Pix/cartão para o
 * cliente saber que NÃO é envio pelos Correios e quando o pedido fica disponível.
 */
function pickupAdviceNote(entrega: EntregaSnapshot): string {
  const mode = normalizeDeliveryMode((entrega as Record<string, unknown>).delivery_mode)
  if (mode !== 'retirada_clinica') return ''
  return '📍 Como você vai *retirar na clínica*, assim que o pagamento for confirmado seu pedido fica disponível para retirada em até *1 dia útil*. Te aviso por aqui quando estiver pronto! 💚'
}

/** Host do gerador de imagem do QR Code Pix (override por env). O payload Pix (EMV) é público. */
const PIX_QR_IMAGE_BASE = (Deno.env.get('PIX_QR_IMAGE_BASE') ?? 'https://api.qrserver.com/v1/create-qr-code/').trim()

/**
 * Gera a imagem do QR Code Pix a partir do copia-e-cola (EMV) e devolve um DATA URI base64
 * (data:image/png;base64,...). A e.Rede raramente devolve a imagem do QR, e a W-API só aceita
 * imagem como base64 OU URL terminada em .png/.jpg — a URL do gerador (com query string) é
 * REJEITADA ("A URL da imagem deve ser nos formatos .png/.jpeg/.jpg"). Por isso baixamos o PNG
 * e mandamos em base64. Best-effort: devolve '' se o gerador falhar (o copia-e-cola no texto da
 * mensagem já resolve o pagamento). O PNG do QR é ~1KB, então o base64 trafega tranquilo no JSON.
 */
async function pixQrImageDataUri(emv: string): Promise<string> {
  try {
    const sep = PIX_QR_IMAGE_BASE.includes('?') ? '&' : '?'
    const url = `${PIX_QR_IMAGE_BASE}${sep}size=400x400&margin=12&format=png&data=${encodeURIComponent(emv)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return ''
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length === 0) return ''
    let bin = ''
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!)
    return `data:image/png;base64,${btoa(bin)}`
  } catch {
    return ''
  }
}

const CRM_OPS_MARKER = '<<<CRM_OPS>>>'

/** URL pública do app (rota /pagar/:id do checkout de cartão). */
const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') ?? 'https://instituto-lorena.vercel.app').trim()

/**
 * Mensagem ao cliente sobre o cupom: confirma quando aplicou; avisa quando o
 * código foi informado mas não valeu. Sem código → undefined (nada a dizer).
 */
function couponNote(
  requested: unknown,
  appliedCode: string | null,
  baseCents: number,
  discountCents: number,
  finalCents: number,
): string | undefined {
  if (appliedCode && discountCents > 0) {
    return `Cupom *${appliedCode}* aplicado: -${formatBRLCents(discountCents)} (de ${formatBRLCents(baseCents)} por ${formatBRLCents(finalCents)}).`
  }
  const reqCode = normalizeCouponCode(String(requested ?? ''))
  if (reqCode) return `O cupom *${reqCode}* não é válido (expirado, esgotado ou inexistente) — segue o valor normal.`
  return undefined
}

/** Revalida se o horário ainda está livre na Shosp (anti double-booking). */
async function shospSlotStillFree(codigoPrestador: number, data: string, horario: string): Promise<boolean> {
  try {
    const r = await shospGetAgenda({ codigoUnidade: 1, dataInicial: data, diasMostrar: 1, codigoPrestador })
    const flat: Record<string, unknown>[] = []
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk)
      else if (x && typeof x === 'object') flat.push(x as Record<string, unknown>)
    }
    walk((r.data as { dados?: unknown })?.dados ?? null)
    const hhmm = horario.slice(0, 5)
    for (const p of flat.filter((o) => 'horarios' in o)) {
      const horarios = (p.horarios ?? {}) as Record<string, { horario?: Record<string, unknown>[] }>
      const day = horarios[data]
      if (!day) continue
      for (const h of day.horario ?? []) {
        if (String(h.horario ?? '').slice(0, 5) === hhmm) {
          return Boolean(h.codigoHorario) && !h.codigoAgendamento
        }
      }
    }
  } catch {
    // se não der pra checar, é mais seguro abortar
  }
  return false
}

export function peelCrmOpsFromModelReply(raw: string): { remainder: string; ops: unknown[] } {
  const text = raw.replace(/\r\n/g, '\n')
  const idx = text.lastIndexOf(CRM_OPS_MARKER)
  if (idx < 0) return { remainder: text.trim(), ops: [] }
  const jsonPart = text.slice(idx + CRM_OPS_MARKER.length).trim()
  const remainder = text.slice(0, idx).trim()
  let ops: unknown[] = []
  try {
    const parsed = JSON.parse(jsonPart) as { ops?: unknown[] }
    ops = Array.isArray(parsed.ops) ? parsed.ops : []
  } catch {
    ops = []
  }
  return { remainder, ops }
}

export type CrmAiActionResult = { type: string; ok: boolean; detail?: string; customerNote?: string; imageUrl?: string; installments?: number }

/** Token para ilike: remove wildcards problemáticos. */
export function sanitizeLeadSearchToken(raw: string): string {
  return raw
    .replace(/[%_\\"'\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

export function isListLeadsFilteredOp(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  return String((raw as Record<string, unknown>).type ?? '').trim().toLowerCase() === 'list_leads_filtered'
}

export type ListedLeadRow = {
  id: string
  patient_name: string | null
  phone: string | null
  source: string | null
  score: number | null
  temperature: string | null
  stage_id: string | null
  pipeline_id: string | null
  summary: string | null
  created_at: string | null
}

/**
 * Lista leads com filtros seguros (RLS do cliente). Só deve ser chamado com JWT de utilizador autenticado.
 * Processa apenas a primeira operação do array (evita abuso).
 */
export async function executeListLeadsFilteredOps(
  admin: SupabaseClient,
  listQueries: unknown[],
): Promise<{ results: CrmAiActionResult[]; rows?: ListedLeadRow[] }> {
  const results: CrmAiActionResult[] = []
  if (listQueries.length === 0) return { results }

  if (listQueries.length > 1) {
    results.push({
      type: 'list_leads_filtered',
      ok: false,
      detail: 'only_first_query_executed',
    })
  }

  const rawOp = listQueries[0]
  if (!rawOp || typeof rawOp !== 'object' || Array.isArray(rawOp)) {
    results.push({ type: 'list_leads_filtered', ok: false, detail: 'invalid_op' })
    return { results }
  }
  const op = rawOp as Record<string, unknown>
  const limitRaw = Number(op.limit ?? 25)
  const limit = Math.min(50, Math.max(5, Number.isFinite(limitRaw) ? limitRaw : 25))

  const stageId = op.stage_id != null ? String(op.stage_id).trim() : ''
  const pipelineId = op.pipeline_id != null ? String(op.pipeline_id).trim() : ''
  const temperature = String(op.temperature ?? op.temp ?? '').trim().toLowerCase()
  const search = op.search != null ? String(op.search) : ''

  try {
    let q = admin
      .from('leads')
      .select('id, patient_name, phone, source, score, temperature, stage_id, pipeline_id, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (stageId) q = q.eq('stage_id', stageId)
    if (pipelineId) q = q.eq('pipeline_id', pipelineId)
    if (temperature && ['cold', 'warm', 'hot'].includes(temperature)) {
      q = q.eq('temperature', temperature)
    }
    const token = sanitizeLeadSearchToken(search)
    if (token.length >= 2) {
      q = q.or(`patient_name.ilike.%${token}%,summary.ilike.%${token}%,phone.ilike.%${token}%`)
    }

    const { data, error } = await q
    if (error) {
      results.push({
        type: 'list_leads_filtered',
        ok: false,
        detail: error.message.slice(0, 220),
      })
      return { results }
    }

    const rows = (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id ?? ''),
      patient_name: r.patient_name != null ? String(r.patient_name) : null,
      phone: r.phone != null ? String(r.phone) : null,
      source: r.source != null ? String(r.source) : null,
      score: typeof r.score === 'number' ? r.score : null,
      temperature: r.temperature != null ? String(r.temperature) : null,
      stage_id: r.stage_id != null ? String(r.stage_id) : null,
      pipeline_id: r.pipeline_id != null ? String(r.pipeline_id) : null,
      summary: r.summary != null ? String(r.summary).slice(0, 280) : null,
      created_at: r.created_at != null ? String(r.created_at) : null,
    }))

    results.push({
      type: 'list_leads_filtered',
      ok: true,
      detail: `count=${rows.length}`,
    })
    return { results, rows }
  } catch (e) {
    results.push({
      type: 'list_leads_filtered',
      ok: false,
      detail: e instanceof Error ? e.message.slice(0, 160) : String(e),
    })
    return { results }
  }
}

const SAO_PAULO_TZ = 'America/Sao_Paulo'

function getYmdInTimeZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, da] = ymd.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, da + days, 12, 0, 0))
  return next.toISOString().slice(0, 10)
}

function weekdayInSaoPaulo(ymd: string): number {
  const [y, m, da] = ymd.split('-').map(Number)
  const utcMid = Date.UTC(y, m - 1, da, 15, 0, 0)
  const w = new Intl.DateTimeFormat('en-US', {
    timeZone: SAO_PAULO_TZ,
    weekday: 'short',
  }).format(new Date(utcMid))
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[w] ?? 0
}

/** Resolve weekday (0=dom … 6=sáb) a partir das notas; evita "segunda opção" como segunda-feira. */
function weekdayTargetFromNotes(notes: string): number | null {
  const n = notes.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  const notOpcaoSegunda = !/\bsegunda\s+op(c(c|ç)ao|ção)\b/.test(n)
  const notOpcaoTerca = !/\bter[cç]a\s+op(c(c|ç)ao|ção)\b/.test(n)
  const notOpcaoQuarta = !/\bquarta\s+op(c(c|ç)ao|ção)\b/.test(n)
  const notOpcaoQuinta = !/\bquinta\s+op(c(c|ç)ao|ção)\b/.test(n)
  const notOpcaoSexta = !/\bsexta\s+op(c(c|ç)ao|ção)\b/.test(n)

  if (/\bdomingo\b/.test(n)) return 0
  if (/\b(segunda-feira|segunda\s+feira)\b/.test(n) || (/\bsegunda\b/.test(n) && notOpcaoSegunda)) return 1
  if (/\b(ter[cç]a-feira|ter[cç]a\s+feira)\b/.test(n) || (/\bter[cç]a\b/.test(n) && notOpcaoTerca)) return 2
  if (/\b(quarta-feira|quarta\s+feira)\b/.test(n) || (/\bquarta\b/.test(n) && notOpcaoQuarta)) return 3
  if (/\b(quinta-feira|quinta\s+feira)\b/.test(n) || (/\bquinta\b/.test(n) && notOpcaoQuinta)) return 4
  if (/\b(sexta-feira|sexta\s+feira)\b/.test(n) || (/\bsexta\b/.test(n) && notOpcaoSexta)) return 5
  if (/\bs[aá]bado\b/.test(n)) return 6
  return null
}

/** Primeira data (YYYY-MM-DD) em SP, a partir de `base`, cujo weekday coincide com o texto (segunda…sexta). */
function firstYmdMatchingWeekdayFromNotes(notes: string, base: Date): string | null {
  const target = weekdayTargetFromNotes(notes)
  if (target === null) return null
  let ymd = getYmdInTimeZone(base, SAO_PAULO_TZ)
  for (let i = 0; i < 21; i += 1) {
    if (weekdayInSaoPaulo(ymd) === target) return ymd
    ymd = addDaysToYmd(ymd, 1)
  }
  return null
}

/** Hora local (0–23) do instante ISO no fuso indicado. */
function slotLocalHourInTimeZone(iso: string, timeZone: string): number {
  const d = new Date(iso)
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d)
  return Number(p.find((x) => x.type === 'hour')?.value ?? -1)
}

/** Janela de hora local (início do slot) para filtrar vagas; alinhado a notas da IA (tarde, manhã, "15h", "~15h"). */
function localHourWindowFromNotes(notes: string): { min: number; max: number } | null {
  const n = notes.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  const approxStd = n.match(/(?:por\s*volta\s*(?:de|das)?|às|as)\s*(\d{1,2})\s*h\b/)
  const approxParen = n.match(/\(\s*~?\s*(\d{1,2})\s*h\s*\)/)
  const approxTilde = n.match(/~\s*(\d{1,2})\s*h\b/)
  const hApprox = parseInt(
    approxStd?.[1] ?? approxParen?.[1] ?? approxTilde?.[1] ?? '',
    10,
  )
  const hasTarde = /\btarde\b/.test(n)
  const hasManha = /\bmanh[aã]\b/.test(n)

  if (Number.isFinite(hApprox) && hApprox >= 8 && hApprox <= 19) {
    return { min: Math.max(8, hApprox - 1), max: Math.min(17, hApprox + 1) }
  }
  if (hasTarde && !hasManha) return { min: 13, max: 17 }
  if (hasManha && !hasTarde) return { min: 8, max: 11 }
  return null
}

async function validateStage(
  admin: SupabaseClient,
  pipelineId: string,
  stageId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('pipeline_stages')
    .select('id')
    .eq('id', stageId)
    .eq('pipeline_id', pipelineId)
    .maybeSingle()
  return Boolean(data?.id)
}

/**
 * Executa operações CRM pedidas pela IA (JSON). Só altera `allowedLeadId` — ignora outros ids no payload.
 */
export async function executeCrmAiOpsFromModel(
  admin: SupabaseClient,
  opts: {
    allowedLeadId: string
    ops: unknown[]
    patientLabel: string
    logToInteractions: boolean
  },
): Promise<CrmAiActionResult[]> {
  const results: CrmAiActionResult[] = []
  const summaries: string[] = []

  const { data: leadRow } = await admin
    .from('leads')
    .select('id, pipeline_id, stage_id, patient_name, tenant_id')
    .eq('id', opts.allowedLeadId)
    .maybeSingle()
  if (!leadRow) {
    return [{ type: '_error', ok: false, detail: 'lead_not_found' }]
  }
  const pipelineId = String((leadRow as { pipeline_id?: string }).pipeline_id ?? '')
  const patientName = String((leadRow as { patient_name?: string }).patient_name ?? opts.patientLabel)
  const leadTenantId = String((leadRow as { tenant_id?: string }).tenant_id ?? '')

  // Feature flag por tenant: auto-agendamento da IA.
  let autoSchedulingEnabled = false
  if (leadTenantId) {
    const { data: cfgRow } = await admin
      .from('crm_ai_configs')
      .select('auto_scheduling_enabled')
      .eq('tenant_id', leadTenantId)
      .eq('id', 'default')
      .maybeSingle()
    autoSchedulingEnabled = Boolean(
      (cfgRow as { auto_scheduling_enabled?: boolean } | null)?.auto_scheduling_enabled,
    )
  }

  for (const rawOp of opts.ops) {
    if (!rawOp || typeof rawOp !== 'object' || Array.isArray(rawOp)) continue
    const op = rawOp as Record<string, unknown>
    const type = String(op.type ?? '').trim().toLowerCase()

    try {
      if (type === 'move_lead' || type === 'update_lead_stage') {
        const stageId = String(op.stage_id ?? '').trim()
        const newPipeline = op.pipeline_id != null ? String(op.pipeline_id).trim() : ''
        if (!stageId) {
          results.push({ type, ok: false, detail: 'missing_stage_id' })
          continue
        }
        const effPipeline = newPipeline || pipelineId
        if (!effPipeline) {
          results.push({ type, ok: false, detail: 'missing_pipeline' })
          continue
        }
        const okStage = await validateStage(admin, effPipeline, stageId)
        if (!okStage) {
          results.push({ type, ok: false, detail: 'invalid_stage_for_pipeline' })
          continue
        }
        const patch: Record<string, unknown> = {
          stage_id: stageId,
          updated_at: new Date().toISOString(),
        }
        if (newPipeline) patch.pipeline_id = newPipeline
        const { error } = await admin.from('leads').update(patch).eq('id', opts.allowedLeadId)
        if (error) {
          results.push({ type, ok: false, detail: error.message.slice(0, 200) })
          continue
        }
        results.push({ type, ok: true, detail: `stage=${stageId}` })
        summaries.push(`Etapa atualizada (${stageId})`)
        continue
      }

      if (type === 'set_temperature') {
        const value = String(op.value ?? op.temperature ?? '').trim().toLowerCase()
        if (!['cold', 'warm', 'hot'].includes(value)) {
          results.push({ type, ok: false, detail: 'invalid_temperature' })
          continue
        }
        const { error } = await admin
          .from('leads')
          .update({ temperature: value, updated_at: new Date().toISOString() })
          .eq('id', opts.allowedLeadId)
        if (error) {
          results.push({ type, ok: false, detail: error.message.slice(0, 200) })
          continue
        }
        results.push({ type, ok: true, detail: value })
        summaries.push(`Temperatura: ${value}`)
        continue
      }

      if (type === 'update_summary' || type === 'update_lead_summary') {
        const text = String(op.text ?? op.summary ?? '').trim().slice(0, 2000)
        if (!text) {
          results.push({ type, ok: false, detail: 'empty_summary' })
          continue
        }
        const { error } = await admin
          .from('leads')
          .update({ summary: text, updated_at: new Date().toISOString() })
          .eq('id', opts.allowedLeadId)
        if (error) {
          results.push({ type, ok: false, detail: error.message.slice(0, 200) })
          continue
        }
        results.push({ type, ok: true })
        summaries.push('Resumo do lead atualizado')
        continue
      }

      if (type === 'shosp_book') {
        if (!autoSchedulingEnabled) {
          results.push({ type, ok: false, detail: 'auto_scheduling_disabled' })
          continue
        }
        const codigoPrestador = Number(op.codigoPrestador ?? op.codigo_prestador)
        const dataYmd = String(op.data ?? '').trim()
        const horario = String(op.horario ?? '').trim()
        const codigoHorario = Number(op.codigoHorario ?? op.codigo_horario)
        const codigoServico = Number(op.codigoServico ?? op.codigo_servico)
        if (!codigoPrestador || !/^\d{4}-\d{2}-\d{2}$/.test(dataYmd) || !horario || !codigoHorario || !codigoServico) {
          results.push({ type, ok: false, detail: 'missing_or_invalid_params' })
          continue
        }
        // Trava 1: o horário ainda está livre (anti double-booking).
        if (!(await shospSlotStillFree(codigoPrestador, dataYmd, horario))) {
          results.push({ type, ok: false, detail: 'slot_taken_or_unavailable' })
          continue
        }
        // Dados do paciente (lead + cadastro captado na conversa).
        const { data: leadFull } = await admin
          .from('leads')
          .select('patient_name, phone, shosp_prontuario, custom_fields')
          .eq('id', opts.allowedLeadId)
          .maybeSingle()
        const lf = leadFull as
          | { patient_name?: string; phone?: string; shosp_prontuario?: string; custom_fields?: Record<string, unknown> }
          | null
        const cad = ((lf?.custom_fields?.cadastro as Record<string, string>) ?? {})
        const nome = String(cad.nomeCompleto || lf?.patient_name || '').trim()
        const telefone = String(lf?.phone ?? '').replace(/\D/g, '')
        const email = String(cad.email ?? '').trim()
        const dataNascimento = String(cad.dataNascimento ?? '').trim()
        const sexo = String(cad.sexo ?? '').trim().toUpperCase()
        const prontuario = lf?.shosp_prontuario ? String(lf.shosp_prontuario) : ''
        // Trava 2: dados obrigatórios SÓ para paciente novo. Se já tem prontuário,
        // o codigoPaciente basta (a Shosp usa o cadastro existente).
        const missing: string[] = []
        if (!prontuario) {
          if (nome.split(/\s+/).filter(Boolean).length < 2) missing.push('nome completo')
          if (telefone.length < 10) missing.push('telefone')
          if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(dataNascimento)) missing.push('data de nascimento (DD/MM/AAAA)')
          if (sexo !== 'M' && sexo !== 'F') missing.push('sexo (M/F)')
          if (!email) missing.push('email')
        }
        if (missing.length) {
          results.push({ type, ok: false, detail: `missing_patient_data: ${missing.join(', ')}` })
          continue
        }
        const sched = await shospSchedule({
          codigoPrestador,
          codigoUnidade: 1,
          codigoServico,
          codigoPlanoSaude: 1,
          data: dataYmd,
          horario,
          codigoHorario,
          nome,
          telefone,
          email: email || 'naoinformado@institutolorena.com.br',
          dataNascimento: dataNascimento || '01/01/1990',
          sexo: sexo || 'M',
          codigoPaciente: prontuario || undefined,
        })
        const dados = (sched.data as { dados?: { codigoAgendamento?: number; codigoPaciente?: string } } | undefined)?.dados
        if (!sched.ok || !dados?.codigoAgendamento) {
          results.push({ type, ok: false, detail: `shosp_fail: ${sched.error ?? 'no_codigoAgendamento'}`.slice(0, 200) })
          continue
        }
        if (dados.codigoPaciente && !prontuario) {
          await admin.from('leads').update({ shosp_prontuario: String(dados.codigoPaciente) }).eq('id', opts.allowedLeadId)
        }
        const quando = `${dataYmd.split('-').reverse().join('/')} ${horario.slice(0, 5)}`
        results.push({ type, ok: true, detail: quando })
        summaries.push(`Agendado na Shosp (${quando}, agendamento ${dados.codigoAgendamento})`)
        continue
      }

      if (type === 'pagbank_checkout' || type === 'pagbank_link') {
        const { data: leadFull } = await admin
          .from('leads')
          .select('id, patient_name, phone, custom_fields, tenant_id')
          .eq('id', opts.allowedLeadId)
          .maybeSingle()
        const lf = leadFull as
          | { id: string; patient_name?: string; phone?: string; custom_fields?: Record<string, unknown>; tenant_id?: string }
          | null
        if (!lf) {
          results.push({ type: 'pagbank_checkout', ok: false, detail: 'lead_not_found' })
          continue
        }
        try {
          const out = await createPagBankCheckout(admin, {
            tenantId: String(lf.tenant_id ?? leadTenantId),
            lead: { id: lf.id, patient_name: lf.patient_name, phone: lf.phone, custom_fields: lf.custom_fields ?? null },
            kit: op.kit != null ? String(op.kit) : undefined,
            amountCents: op.amount_cents != null ? Number(op.amount_cents) : undefined,
            description: op.description != null ? String(op.description) : undefined,
            couponCode: op.coupon != null ? String(op.coupon) : undefined,
            supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
          })
          const note = couponNote(op.coupon, out.couponCode, out.baseCents, out.discountCents, out.amountCents)
          results.push({ type: 'pagbank_checkout', ok: true, detail: out.payLink, customerNote: note })
          summaries.push(`Link PagBank gerado (${out.label}${out.couponCode ? `, cupom ${out.couponCode} -${formatBRLCents(out.discountCents)}` : ''})`)
        } catch (e) {
          results.push({
            type: 'pagbank_checkout',
            ok: false,
            detail: (e instanceof Error ? e.message : String(e)).slice(0, 200),
          })
        }
        continue
      }

      if (type === 'rede_pix' || type === 'pagbank_pix' || type === 'pix' || type === 'pix_qr') {
        // Pix DIRETO (copia-e-cola + QR) via e.Rede (createRedePix). Aceita kit OU amount_cents,
        // frete e cupom. (`pagbank_pix`/`pix*` são aliases legados — o motor é 100% e.Rede.)
        // (Preço Pix do kit = tabela PAGBANK_KITS, que já é o valor com 5% off.)
        const freightCents = await resolveFreightCents(admin, leadTenantId, op)
        const snapPix = await persistEntrega(admin, opts.allowedLeadId, op)
        // MESMA trava NF-e do cartão: não gera Pix sem cadastro completo (nome+telefone+CPF+CEP+número).
        const readyPix = validateOrderReadiness(snapPix.cadastro, snapPix.entrega)
        if (!readyPix.ok) {
          results.push({
            type: 'rede_pix',
            ok: false,
            detail: `cadastro_incompleto: ${readyPix.missing.join(', ')}`,
            customerNote: `Pra finalizar e já emitir sua nota fiscal, só preciso de: ${readyPix.missing.join(', ')}. Pode me mandar? 💚`,
          })
          continue
        }
        const pixKey = op.kit != null ? normalizeKitKey(String(op.kit)) : null
        const pixKit = pixKey ? PAGBANK_KITS[pixKey] : undefined
        let pixAmount = 0
        let pixDesc = ''
        if (pixKit) {
          pixAmount = pixKit.amountCents
          pixDesc = pixKit.label
        } else {
          // SÓ vendemos KIT cadastrado — sem venda avulsa por valor livre.
          results.push({ type: 'rede_pix', ok: false, detail: 'kit_obrigatorio', customerNote: 'Consigo gerar o Pix só para os kits do Tricopill (1 mês, 3+1 ou 5 meses). Qual deles você quer? 💚' })
          continue
        }
        try {
          const out = await createRedePix(admin, {
            tenantId: leadTenantId,
            amountCents: pixAmount,
            description: pixDesc,
            leadId: opts.allowedLeadId,
            couponCode: op.coupon != null ? String(op.coupon) : undefined,
            freightCents,
            kit: pixKey ?? undefined,
            customerName: String(snapPix.cadastro.nomeCompleto ?? '').trim() || undefined,
            customerDoc: String(snapPix.cadastro.cpf ?? '').replace(/\D/g, '') || undefined,
            phone: String(snapPix.cadastro.telefone ?? '').replace(/\D/g, '') || undefined,
          })
          const note = couponNote(op.coupon, out.couponCode, out.baseCents, out.discountCents, out.amountCents)
          const pixNote = [note, pickupAdviceNote(snapPix.entrega)].filter(Boolean).join('\n\n')
          // detail = copia-e-cola (vai no texto). imageUrl = QR como IMAGEM (data URI base64): a
          // e.Rede raramente devolve a imagem e a W-API rejeita URL sem extensão .png, então
          // geramos o PNG do copia-e-cola e mandamos em base64.
          const pixImg = out.qrText ? await pixQrImageDataUri(out.qrText) : ''
          results.push({
            type: 'rede_pix',
            ok: true,
            detail: out.qrText,
            customerNote: pixNote || undefined,
            ...(pixImg ? { imageUrl: pixImg } : {}),
          })
          summaries.push(`Pix gerado via Rede (${pixDesc}${out.couponCode ? `, cupom ${out.couponCode} -${formatBRLCents(out.discountCents)}` : ''})`)
          // VENDA QUENTE: o cliente recebeu o Pix — avisa o consultor pra acompanhar o fechamento.
          // É só um FYI (sininho), NÃO desliga a IA nem marca "aguardando consultor" (o cliente
          // ainda paga sozinho). Dedupe por lead p/ não repetir a cada Pix dentro de 6h.
          await notifyAgents(admin, {
            leadId: opts.allowedLeadId,
            kind: 'urgent',
            title: 'Venda quente — acompanhe',
            body: `${String(snapPix.cadastro.nomeCompleto ?? 'Cliente').trim()} recebeu o Pix (${pixDesc}). Pronto pra fechar!`,
            includeOwner: true,
            tenantId: leadTenantId,
            dedupeKey: 'venda_quente',
            dedupeWindowMinutes: 360,
          })
        } catch (e) {
          results.push({ type: 'rede_pix', ok: false, detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
        }
        continue
      }

      if (type === 'rede_link' || type === 'rede_checkout' || type === 'rede_card') {
        // Cartão (e.Rede), parcelado até 12x. Aceita kit OU amount_cents+description, e cupom.
        const kitRaw = op.kit != null ? String(op.kit) : ''
        const resolved = kitRaw ? resolveRedeKit(kitRaw) : null
        let amountCents = 0
        let description = ''
        if (resolved) {
          amountCents = resolved.amountCents
          description = resolved.label
        } else {
          // SÓ vendemos KIT cadastrado — sem venda avulsa por valor livre.
          results.push({ type: 'rede_link', ok: false, detail: 'kit_obrigatorio', customerNote: 'Consigo gerar o link de pagamento só para os kits do Tricopill (1 mês, 3+1 ou 5 meses). Qual deles você quer? 💚' })
          continue
        }
        // KIT: prioriza o que a IA mandou; se ela mandou amount_cents (sem kit), INFERE o kit
        // pelo valor do produto (match exato com REDE_KITS). Sem isso o kit ficava null no
        // rede_payments e a venda no cartão NÃO ia pro Bling automaticamente.
        const kitKey = resolved?.key ?? inferRedeKit(amountCents)

        const installments = Math.max(1, Math.min(12, Number(op.installments ?? 12) || 12))
        // Parcelamento EFETIVO = limitado pela regra do kit (1 frasco=1x; kits 3+1/5=3x).
        const kitCap = kitKey ? REDE_KIT_MAX_INSTALLMENTS[kitKey] : undefined
        const effInstallments = kitCap ? Math.min(installments, kitCap) : installments
        // Frete (entrega à parte) somado ao link, em centavos. Cotação real: se a IA mandar
        // freight_service ("PAC"/"SEDEX") + to_cep, o servidor recota (Melhor Envio); senão
        // usa o freight_cents literal.
        const freightCents = await resolveFreightCents(admin, leadTenantId, op)
        const snap = await persistEntrega(admin, opts.allowedLeadId, op)
        // TRAVA NF-e: não gera o link sem cadastro completo (nome+CPF+CEP+número). A nota é
        // emitida automática no fechamento, então o pedido precisa estar pronto p/ NF-e.
        const ready = validateOrderReadiness(snap.cadastro, snap.entrega)
        if (!ready.ok) {
          results.push({
            type: 'rede_link',
            ok: false,
            detail: `cadastro_incompleto: ${ready.missing.join(', ')}`,
            customerNote: `Pra finalizar e já emitir sua nota fiscal, só preciso de: ${ready.missing.join(', ')}. Pode me mandar? 💚`,
          })
          continue
        }
        try {
          const out = await createRedeIntent(admin, {
            tenantId: leadTenantId,
            amountCents,
            description,
            leadId: opts.allowedLeadId,
            installments,
            appBaseUrl: APP_BASE_URL,
            couponCode: op.coupon != null ? String(op.coupon) : undefined,
            freightCents,
            kit: kitKey ?? undefined, // guarda o kit (ou inferido) p/ criar o pedido no Bling ao pagar
            // Dados do cliente na cobrança (controle + conciliação + titular do cartão na e.Rede).
            customerName: String(snap.cadastro.nomeCompleto ?? '').trim() || undefined,
            customerDoc: String(snap.cadastro.cpf ?? '').replace(/\D/g, '') || undefined,
            phone: String(snap.cadastro.telefone ?? '').replace(/\D/g, '') || undefined,
          })
          const note = couponNote(op.coupon, out.couponCode, out.baseCents, out.discountCents, out.amountCents)
          const linkNote = [note, pickupAdviceNote(snap.entrega)].filter(Boolean).join('\n\n')
          results.push({ type: 'rede_link', ok: true, detail: out.url, customerNote: linkNote || undefined, installments: effInstallments })
          summaries.push(
            `Link cartão e.Rede gerado (${description}, até ${effInstallments}x${out.couponCode ? `, cupom ${out.couponCode} -${formatBRLCents(out.discountCents)}` : ''})`,
          )
        } catch (e) {
          results.push({
            type: 'rede_link',
            ok: false,
            detail: (e instanceof Error ? e.message : String(e)).slice(0, 200),
          })
        }
        continue
      }

      if (type === 'book_appointment' || type === 'schedule_appointment') {
        if (!autoSchedulingEnabled) {
          results.push({
            type,
            ok: false,
            detail: 'auto_scheduling_disabled_for_tenant',
          })
          continue
        }
        const duration = Math.min(
          180,
          Math.max(15, Number(op.duration_minutes ?? op.duration ?? 30) || 30),
        )
        const notes = op.notes != null ? String(op.notes).trim().slice(0, 500) : ''
        const now = new Date()
        const searchStartYmd =
          firstYmdMatchingWeekdayFromNotes(notes, now) ?? getYmdInTimeZone(now, SAO_PAULO_TZ)
        const searchEndYmd = addDaysToYmd(searchStartYmd, 14)
        const hourWin = localHourWindowFromNotes(notes)

        const rpcPayload: Record<string, unknown> = {
          p_starts_on: searchStartYmd,
          p_ends_on: searchEndYmd,
          p_duration_minutes: duration,
        }
        if (hourWin) {
          rpcPayload.p_local_hour_min = hourWin.min
          rpcPayload.p_local_hour_max = hourWin.max
        }

        const { data: rpcData, error: rpcErr } = await admin.rpc(
          'find_first_appointment_slot',
          rpcPayload,
        )
        if (rpcErr) {
          results.push({ type, ok: false, detail: rpcErr.message.slice(0, 200) })
          continue
        }
        const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as {
          room_id?: string
          slot_start?: string
          slot_end?: string
        } | null
        if (!row?.room_id || !row.slot_start || !row.slot_end) {
          results.push({ type, ok: false, detail: 'no_slot_available' })
          continue
        }
        const slotHour = slotLocalHourInTimeZone(String(row.slot_start), SAO_PAULO_TZ)
        if (slotHour < 8 || slotHour >= 20) {
          results.push({
            type,
            ok: false,
            detail: 'invalid_slot_outside_business_hours',
          })
          continue
        }
        const id = `appt-${crypto.randomUUID()}`
        const nowIso = new Date().toISOString()
        const { error: insErr } = await admin.from('appointments').insert({
          id,
          lead_id: opts.allowedLeadId,
          room_id: String(row.room_id),
          starts_at: String(row.slot_start),
          ends_at: String(row.slot_end),
          status: 'confirmed',
          attendance_status: 'expected',
          notes: notes || null,
          created_at: nowIso,
          updated_at: nowIso,
        })
        if (insErr) {
          results.push({ type, ok: false, detail: insErr.message.slice(0, 200) })
          continue
        }
        results.push({
          type,
          ok: true,
          detail: `${row.slot_start}`,
        })
        const summaryWhen = (() => {
          try {
            return new Date(String(row.slot_start)).toLocaleString('pt-BR', {
              dateStyle: 'short',
              timeStyle: 'short',
              timeZone: SAO_PAULO_TZ,
            })
          } catch {
            return String(row.slot_start).slice(0, 16)
          }
        })()
        summaries.push(`Marcação criada (${summaryWhen}, horário de Maringá)`)
        continue
      }

      results.push({ type: type || 'unknown', ok: false, detail: 'unsupported_op' })
    } catch (e) {
      results.push({
        type,
        ok: false,
        detail: e instanceof Error ? e.message.slice(0, 120) : String(e),
      })
    }
  }

  if (opts.logToInteractions && summaries.length > 0) {
    try {
      await insertInteraction(admin, {
        leadId: opts.allowedLeadId,
        patientName,
        channel: 'system',
        direction: 'system',
        author: 'Assistente IA',
        content: `Ações automáticas no CRM: ${summaries.join('; ')}.`,
      })
    } catch {
      /* não bloquear resposta ao paciente */
    }
  }

  return results
}
