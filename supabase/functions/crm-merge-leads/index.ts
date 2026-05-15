import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { mergeLeadDropIntoKeep } from '../_shared/crm.ts'

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

  const auth = (req.headers.get('Authorization') ?? '').trim()
  if (auth !== `Bearer ${serviceRole}`) return json({ error: 'unauthorized' }, 401)

  let body: { keep_lead_id?: string; drop_lead_id?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const keepLeadId = String(body.keep_lead_id ?? '').trim()
  const dropLeadId = String(body.drop_lead_id ?? '').trim()
  if (!keepLeadId || !dropLeadId) {
    return json({ error: 'missing_fields', message: 'keep_lead_id e drop_lead_id são obrigatórios' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRole)
  try {
    await mergeLeadDropIntoKeep(admin, keepLeadId, dropLeadId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return json({ error: 'merge_failed', message: msg }, 400)
  }

  return json({ ok: true, keep_lead_id: keepLeadId })
})
