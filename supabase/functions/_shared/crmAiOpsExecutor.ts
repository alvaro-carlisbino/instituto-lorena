import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { insertInteraction } from './crm.ts'

const CRM_OPS_MARKER = '<<<CRM_OPS>>>'

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

export type CrmAiActionResult = { type: string; ok: boolean; detail?: string }

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
    .select('id, pipeline_id, stage_id, patient_name')
    .eq('id', opts.allowedLeadId)
    .maybeSingle()
  if (!leadRow) {
    return [{ type: '_error', ok: false, detail: 'lead_not_found' }]
  }
  const pipelineId = String((leadRow as { pipeline_id?: string }).pipeline_id ?? '')
  const patientName = String((leadRow as { patient_name?: string }).patient_name ?? opts.patientLabel)

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

      if (type === 'book_appointment' || type === 'schedule_appointment') {
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
