import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { blingAuthorizeUrl, blingClientCreds, blingExchangeCode } from '../_shared/bling.ts'

// OAuth2 do Bling v3.
//  POST { action:'authorize_url', returnUrl } (autenticado) -> URL de autorização do Bling.
//  GET  ?code&state (público, redirect do Bling)           -> troca código por tokens e volta ao app.
// O state é guardado em webhook_jobs (source='bling-oauth-state') mapeando -> { tenantId, returnUrl }.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { ...cors, Location: url } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  // === Callback do Bling (GET ?code&state) ===
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const code = url.searchParams.get('code') ?? ''
    const state = url.searchParams.get('state') ?? ''
    if (!code || !state) return json({ error: 'missing_code_or_state' }, 400)

    const { data: stateRow } = await admin
      .from('webhook_jobs')
      .select('id, status')
      .eq('source', 'bling-oauth-state')
      .eq('note', state)
      .maybeSingle()
    if (!stateRow) return json({ error: 'invalid_state' }, 400)

    let tenantId = ''
    let returnUrl = ''
    try {
      const meta = JSON.parse(String((stateRow as { status?: string }).status ?? '{}'))
      tenantId = String(meta.tenantId ?? '')
      returnUrl = String(meta.returnUrl ?? '')
    } catch {
      // ignore
    }
    if (!tenantId) return json({ error: 'state_without_tenant' }, 400)

    try {
      await blingExchangeCode(admin, tenantId, code)
      await admin.from('webhook_jobs').delete().eq('id', String((stateRow as { id: string }).id))
      const back = returnUrl || `${supabaseUrl}`
      const sep = back.includes('?') ? '&' : '?'
      return redirect(`${back}${sep}bling=ok`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const back = returnUrl || `${supabaseUrl}`
      const sep = back.includes('?') ? '&' : '?'
      return redirect(`${back}${sep}bling=erro&msg=${encodeURIComponent(msg.slice(0, 120))}`)
    }
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // === Início do fluxo (autenticado): gera a URL de autorização ===
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

  let payload: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  if (String(payload.action ?? '') !== 'authorize_url') return json({ error: 'unknown_action' }, 400)

  const creds = blingClientCreds()
  if (!creds) return json({ error: 'bling_client_not_configured' }, 400)

  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  const returnUrl = String(payload.returnUrl ?? '').slice(0, 300)
  const state = crypto.randomUUID()
  await admin.from('webhook_jobs').insert({
    source: 'bling-oauth-state',
    status: JSON.stringify({ tenantId, returnUrl }),
    note: state,
  })

  return json({ ok: true, authorizeUrl: blingAuthorizeUrl(creds.clientId, state) })
})
