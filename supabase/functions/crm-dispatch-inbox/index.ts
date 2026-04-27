import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
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

  return json({ ok: true, remindersCreated: created, dayAppointments: (dayList ?? []).length })
})
