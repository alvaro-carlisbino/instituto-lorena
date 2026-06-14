import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { insertInteraction } from './crm.ts'
import { shospGetAgenda, shospSchedule } from './shosp.ts'
import { createPagBankCheckout, createPagBankPixOrder } from './pagbank.ts'
import { createRedeIntent, resolveRedeKit } from './rede.ts'
import { formatBRLCents, normalizeCouponCode } from './coupons.ts'

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

export type CrmAiActionResult = { type: string; ok: boolean; detail?: string; customerNote?: string; imageUrl?: string }

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

      if (type === 'pagbank_pix' || type === 'pix' || type === 'pix_qr') {
        // Pix DIRETO (copia-e-cola + QR), via PagBank Orders. Aceita kit OU amount_cents, frete e cupom.
        const { data: leadFull } = await admin
          .from('leads')
          .select('id, patient_name, phone, custom_fields, tenant_id')
          .eq('id', opts.allowedLeadId)
          .maybeSingle()
        const lf = leadFull as
          | { id: string; patient_name?: string; phone?: string; custom_fields?: Record<string, unknown>; tenant_id?: string }
          | null
        if (!lf) {
          results.push({ type: 'pagbank_pix', ok: false, detail: 'lead_not_found' })
          continue
        }
        const freightRaw = op.freight_cents ?? op.freightCents
        const freightCents =
          freightRaw != null && Number.isFinite(Number(freightRaw)) ? Math.max(0, Math.round(Number(freightRaw))) : undefined
        try {
          const out = await createPagBankPixOrder(admin, {
            tenantId: String(lf.tenant_id ?? leadTenantId),
            lead: { id: lf.id, patient_name: lf.patient_name, phone: lf.phone, custom_fields: lf.custom_fields ?? null },
            kit: op.kit != null ? String(op.kit) : undefined,
            amountCents: op.amount_cents != null ? Number(op.amount_cents) : undefined,
            description: op.description != null ? String(op.description) : undefined,
            couponCode: op.coupon != null ? String(op.coupon) : undefined,
            freightCents,
            supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
          })
          const note = couponNote(op.coupon, out.couponCode, out.baseCents, out.discountCents, out.amountCents)
          // detail = copia-e-cola (vai no texto); imageUrl = PNG do QR (enviado como imagem).
          results.push({ type: 'pagbank_pix', ok: true, detail: out.qrText, customerNote: note, imageUrl: out.qrImageUrl || undefined })
          summaries.push(
            `Pix gerado (${out.label}${out.env === 'sandbox' ? ', sandbox' : ''}${out.couponCode ? `, cupom ${out.couponCode} -${formatBRLCents(out.discountCents)}` : ''})`,
          )
        } catch (e) {
          results.push({ type: 'pagbank_pix', ok: false, detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
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
        } else if (op.amount_cents != null) {
          amountCents = Math.round(Number(op.amount_cents))
          description = op.description != null ? String(op.description).slice(0, 120) : 'Tricopill'
        } else {
          results.push({ type: 'rede_link', ok: false, detail: 'missing_kit_or_amount' })
          continue
        }
        const installments = Math.max(1, Math.min(12, Number(op.installments ?? 12) || 12))
        // Frete (entrega à parte) somado ao link, em centavos — vem do PROMPT ADICIONAL
        // conforme a cidade/CEP que a IA perguntou ao cliente.
        const freightRaw = op.freight_cents ?? op.freightCents
        const freightCents =
          freightRaw != null && Number.isFinite(Number(freightRaw)) ? Math.max(0, Math.round(Number(freightRaw))) : undefined
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
          })
          const note = couponNote(op.coupon, out.couponCode, out.baseCents, out.discountCents, out.amountCents)
          results.push({ type: 'rede_link', ok: true, detail: out.url, customerNote: note })
          summaries.push(
            `Link cartão e.Rede gerado (${description}, até ${installments}x${out.couponCode ? `, cupom ${out.couponCode} -${formatBRLCents(out.discountCents)}` : ''})`,
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
