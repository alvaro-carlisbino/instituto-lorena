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

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
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
        const start = new Date()
        const end = new Date(start)
        end.setUTCDate(end.getUTCDate() + 14)

        const { data: rpcData, error: rpcErr } = await admin.rpc('find_first_appointment_slot', {
          p_starts_on: ymdUtc(start),
          p_ends_on: ymdUtc(end),
          p_duration_minutes: duration,
        })
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
        summaries.push(`Marcação criada (${String(row.slot_start).slice(0, 16)}…)`)
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
