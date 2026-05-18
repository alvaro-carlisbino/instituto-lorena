import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { notifyAgents } from '../_shared/notifyAgents.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

/**
 * Minutos sem resposta após os quais disparamos lembretes de "alguém sem responder".
 * Cada nível dispara no máximo uma vez por lead (dedupe por chave dedicada).
 */
const STALE_LEVELS: Array<{ minutes: number; key: string; kind: 'urgent' | 'handoff'; title: string }> = [
  { minutes: 15, key: 'stale_waiting_human_15m', kind: 'urgent', title: 'Lead aguardando há 15 min' },
  { minutes: 60, key: 'stale_waiting_human_1h', kind: 'urgent', title: 'Lead aguardando há 1 hora' },
  { minutes: 240, key: 'stale_waiting_human_4h', kind: 'urgent', title: 'Lead aguardando há 4 horas' },
]

function pickStaleLevel(idleMinutes: number): (typeof STALE_LEVELS)[number] | null {
  // Devolve o nível mais alto cuja janela já foi cruzada.
  for (let i = STALE_LEVELS.length - 1; i >= 0; i--) {
    if (idleMinutes >= STALE_LEVELS[i].minutes) return STALE_LEVELS[i]
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cronSecret = (Deno.env.get('CRON_INBOX_SECRET') ?? '').trim()
  const provided = (req.headers.get('x-cron-secret') ?? '').trim()
  if (cronSecret && provided !== cronSecret) return json({ error: 'unauthorized' }, 401)

  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceKey)

  const now = Date.now()
  const windowStart = new Date(now + 50 * 60 * 1000).toISOString()
  const windowEnd = new Date(now + 70 * 60 * 1000).toISOString()
  const dayStart = new Date(now).toISOString()
  const dayEnd = new Date(now + 25 * 3600 * 1000).toISOString()

  const { data: upcoming, error: apptErr } = await admin
    .from('appointments')
    .select('id, lead_id, starts_at, room_id, status')
    .in('status', ['draft', 'confirmed'])
    .gte('starts_at', windowStart)
    .lte('starts_at', windowEnd)

  if (apptErr) return json({ error: apptErr.message }, 500)

  const { data: dayList } = await admin
    .from('appointments')
    .select('id, lead_id, starts_at')
    .in('status', ['draft', 'confirmed'])
    .gte('starts_at', dayStart)
    .lt('starts_at', dayEnd)

  let created = 0
  const rows = upcoming ?? []
  for (const a of rows) {
    const leadId = String((a as { lead_id: string }).lead_id)
    const apptId = String((a as { id: string }).id)
    const { data: lead } = await admin.from('leads').select('owner_id, patient_name').eq('id', leadId).maybeSingle()
    if (!lead) continue
    const ownerId = String((lead as { owner_id: string }).owner_id)
    const { data: owner } = await admin.from('app_users').select('auth_user_id, name').eq('id', ownerId).maybeSingle()
    const authId = (owner as { auth_user_id?: string | null })?.auth_user_id
    if (!authId) continue

    const { error: insErr } = await admin.from('app_inbox_notifications').insert({
      auth_user_id: authId,
      kind: 'appointment',
      title: 'Lembrete: marcação em cerca de 1 hora',
      body: `Lead: ${(lead as { patient_name: string }).patient_name ?? leadId}. Consulte a Agenda.`,
      metadata: { type: 'appointment_reminder_1h', appointmentId: apptId, leadId },
    })
    if (!insErr) {
      created += 1
    }
  }

  // === Lembretes de "alguém sem responder" (leads em waiting_human há muito tempo) ===
  const fourHoursAgo = new Date(now - 4 * 3600_000).toISOString()
  const { data: stale } = await admin
    .from('leads')
    .select('id, patient_name, last_interaction_at, conversation_status')
    .eq('conversation_status', 'waiting_human')
    .gte('last_interaction_at', fourHoursAgo) // só leads recentes; nada de baixar leads antigos do dia anterior
    .is('deleted_at', null)
    .limit(200)

  let staleNotified = 0
  for (const row of stale ?? []) {
    const r = row as { id: string; patient_name: string; last_interaction_at: string | null }
    if (!r.last_interaction_at) continue
    const idleMs = now - new Date(r.last_interaction_at).getTime()
    const idleMin = Math.floor(idleMs / 60_000)
    const level = pickStaleLevel(idleMin)
    if (!level) continue

    const inserted = await notifyAgents(admin, {
      leadId: String(r.id),
      kind: level.kind,
      title: level.title,
      body: `${r.patient_name || 'Lead'} ainda não foi atendido(a). Vamos responder?`,
      includeOwner: true,
      // Cada nível dispara no máximo uma vez por lead durante um intervalo amplo.
      dedupeKey: level.key,
      dedupeWindowMinutes: 24 * 60,
    })
    if (inserted > 0) staleNotified++
  }

  return json({
    ok: true,
    remindersCreated: created,
    dayAppointments: (dayList ?? []).length,
    staleNotified,
  })
})
