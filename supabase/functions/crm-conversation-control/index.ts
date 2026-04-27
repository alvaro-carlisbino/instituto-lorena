import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

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

type Action = 'get_state' | 'set_mode' | 'get_config' | 'set_config'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !serviceRole || !anon) return json({ error: 'server_misconfigured' }, 500)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  })
  const admin = createClient(supabaseUrl, serviceRole)

  const { data: authData, error: authErr } = await userClient.auth.getUser()
  if (authErr || !authData.user) return json({ error: 'unauthorized' }, 401)
  const authUserId = authData.user.id
  const userEmail = authData.user.email ?? ''

  const { data: me } = await admin.from('app_users').select('id, role, email').eq('auth_user_id', authUserId).maybeSingle()
  const role = String((me?.role as string | undefined) ?? 'sdr').toLowerCase()
  const canManageConfig = role === 'admin' || role === 'gestor'

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  const action = String(body.action ?? '').trim() as Action
  if (!action) return json({ error: 'missing_action' }, 400)

  if (action === 'get_state') {
    const leadId = String(body.leadId ?? '').trim()
    if (!leadId) return json({ error: 'missing_lead' }, 400)
    const { data, error } = await admin.from('crm_conversation_states').select('*').eq('lead_id', leadId).maybeSingle()
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, state: data ?? { lead_id: leadId, owner_mode: 'auto', ai_enabled: true } })
  }

  if (action === 'set_mode') {
    const leadId = String(body.leadId ?? '').trim()
    const ownerMode = String(body.ownerMode ?? '').trim().toLowerCase()
    if (!leadId || !['human', 'ai', 'auto'].includes(ownerMode)) return json({ error: 'invalid_payload' }, 400)

    const patch: Record<string, unknown> = {
      lead_id: leadId,
      owner_mode: ownerMode,
      updated_at: new Date().toISOString(),
    }
    if (ownerMode === 'human') patch.last_human_reply_at = new Date().toISOString()
    const { data, error } = await admin.from('crm_conversation_states').upsert(patch).select('*').single()
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, state: data })
  }

  if (action === 'get_config') {
    const { data, error } = await admin.from('crm_ai_configs').select('*').eq('id', 'default').maybeSingle()
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, config: data })
  }

  if (action === 'set_config') {
    if (!canManageConfig) return json({ error: 'forbidden' }, 403)
    const systemPrompt = String(body.systemPrompt ?? '')
    const enabled = Boolean(body.enabled ?? true)
    const defaultOwnerMode = String(body.defaultOwnerMode ?? 'auto').toLowerCase()
    if (!['human', 'ai', 'auto'].includes(defaultOwnerMode)) return json({ error: 'invalid_default_mode' }, 400)
    const maxAiRepliesPerHour = Number(body.maxAiRepliesPerHour ?? 2)
    const minSecondsBetweenAiReplies = Number(body.minSecondsBetweenAiReplies ?? 240)

    const payload = {
      id: 'default',
      enabled,
      system_prompt: systemPrompt.slice(0, 12000),
      default_owner_mode: defaultOwnerMode,
      max_ai_replies_per_hour: Number.isFinite(maxAiRepliesPerHour) ? Math.max(1, Math.min(20, maxAiRepliesPerHour)) : 2,
      min_seconds_between_ai_replies: Number.isFinite(minSecondsBetweenAiReplies)
        ? Math.max(30, Math.min(3600, minSecondsBetweenAiReplies))
        : 240,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await admin.from('crm_ai_configs').upsert(payload).select('*').single()
    if (error) return json({ error: error.message }, 400)
    await admin.from('audit_logs').insert({
      actor_id: (me?.id as string | undefined) ?? null,
      actor_email: userEmail || null,
      action: 'UPDATE',
      target_table: 'crm_ai_configs',
      target_id: 'default',
      metadata: { updated_by: userEmail || authUserId },
    })
    return json({ ok: true, config: data })
  }

  return json({ error: 'unknown_action' }, 400)
})
