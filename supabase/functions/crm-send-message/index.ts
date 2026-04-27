import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from '../_shared/crm.ts'
import { getWhatsappProviderFromEnv } from '../_shared/whatsapp/provider.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  let body: { leadId?: string; to?: string; text?: string }
  try {
    body = (await req.json()) as { leadId?: string; to?: string; text?: string }
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const leadId = String(body.leadId ?? '').trim()
  const to = String(body.to ?? '').trim()
  const text = String(body.text ?? '').trim()
  if (!leadId || !to || !text) return json({ error: 'missing_fields' }, 400)

  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .select('id, patient_name')
    .eq('id', leadId)
    .maybeSingle()
  if (leadErr || !lead) return json({ error: 'lead_not_found' }, 404)

  let provider
  try {
    provider = getWhatsappProviderFromEnv()
  } catch (e) {
    return json({ error: 'provider_not_configured', message: e instanceof Error ? e.message : String(e) }, 500)
  }

  try {
    const sent = await provider.sendMessage({ to, text, leadId })
    await insertInteraction(admin, {
      leadId: String(lead.id),
      patientName: String(lead.patient_name ?? 'Lead'),
      channel: 'whatsapp',
      direction: 'out',
      author: user.email ?? 'Operador',
      content: text,
    })

    await admin.from('webhook_jobs').insert({
      source: 'whatsapp-webhook',
      status: 'done',
      note: `outbound:${provider.name}:${sent.externalMessageId}`.slice(0, 500),
    })

    return json({
      ok: true,
      provider: provider.name,
      externalMessageId: sent.externalMessageId,
      status: sent.status,
    })
  } catch (e) {
    await admin.from('webhook_jobs').insert({
      source: 'whatsapp-webhook',
      status: 'retry',
      note: `outbound_error:${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    })
    return json({ error: 'send_failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }
})

