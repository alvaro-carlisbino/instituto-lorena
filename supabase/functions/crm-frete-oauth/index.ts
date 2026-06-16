/**
 * crm-frete-oauth — OAuth2 do Melhor Envio (conecta a conta de frete UMA vez).
 *
 * Rotas (verify_jwt=false — o callback é redirect público do navegador):
 *  GET  ?code=&state=                 callback do ME: troca o código por tokens e persiste.
 *  GET  ?connect=1&k=<CONNECT_KEY>    link de conexão: gera state e redireciona pro ME.
 *                                     opcional &tenant=tricopill &return=<url de volta>.
 *  POST {action:'authorize_url',returnUrl}  (autenticado) → URL de autorização p/ botão do painel.
 *
 * O state é guardado em webhook_jobs (source='melhorenvio-oauth-state', note=state,
 * status=JSON{tenantId,returnUrl}). Tokens vão pra tenant_integrations.melhorenvio.
 *
 * Secrets: MELHOR_ENVIO_CLIENT_ID/SECRET/SANDBOX/REDIRECT_URI/SCOPES, MELHOR_ENVIO_CONNECT_KEY.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { meAuthorizeUrl, meClientCreds, meExchangeCode } from '../_shared/melhorEnvio.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-connect-key',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { ...cors, Location: url } })
}
function html(body: string, status = 200): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;max-width:560px;margin:auto">${body}</body>`, {
    status,
    headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

const DEFAULT_TENANT = 'tricopill'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const url = new URL(req.url)

  // === GET ===
  if (req.method === 'GET') {
    const code = url.searchParams.get('code') ?? ''
    const state = url.searchParams.get('state') ?? ''

    // --- Início da conexão: ?connect=1&k=<key> → seed state + redirect pro ME ---
    if (!code && (url.searchParams.get('connect') === '1' || url.searchParams.has('connect'))) {
      const connectKey = (Deno.env.get('MELHOR_ENVIO_CONNECT_KEY') ?? '').trim()
      const got = (url.searchParams.get('k') ?? req.headers.get('x-connect-key') ?? '').trim()
      if (!connectKey || got !== connectKey) return html('<h2>403</h2><p>Chave de conexão inválida.</p>', 403)
      if (!meClientCreds()) return html('<h2>Config faltando</h2><p>Defina MELHOR_ENVIO_CLIENT_ID e _SECRET.</p>', 400)

      const tenantId = (url.searchParams.get('tenant') ?? DEFAULT_TENANT).trim() || DEFAULT_TENANT
      const returnUrl = String(url.searchParams.get('return') ?? '').slice(0, 300)
      const newState = crypto.randomUUID()
      await admin.from('webhook_jobs').insert({
        source: 'melhorenvio-oauth-state',
        status: JSON.stringify({ tenantId, returnUrl }),
        note: newState,
      })
      return redirect(meAuthorizeUrl(newState))
    }

    // --- Callback do ME: ?code=&state= ---
    if (!code || !state) return html('<h2>Faltou code/state</h2><p>Para conectar, use o link com <code>?connect=1&k=…</code>.</p>', 400)

    const { data: stateRow } = await admin
      .from('webhook_jobs')
      .select('id, status')
      .eq('source', 'melhorenvio-oauth-state')
      .eq('note', state)
      .maybeSingle()
    if (!stateRow) return html('<h2>State inválido</h2><p>Refaça a conexão.</p>', 400)

    let tenantId = ''
    let returnUrl = ''
    try {
      const meta = JSON.parse(String((stateRow as { status?: string }).status ?? '{}'))
      tenantId = String(meta.tenantId ?? '')
      returnUrl = String(meta.returnUrl ?? '')
    } catch {
      // ignore
    }
    if (!tenantId) return html('<h2>State sem tenant</h2>', 400)

    try {
      await meExchangeCode(admin, tenantId, code)
      await admin.from('webhook_jobs').delete().eq('id', String((stateRow as { id: string }).id))
      if (returnUrl) {
        const sep = returnUrl.includes('?') ? '&' : '?'
        return redirect(`${returnUrl}${sep}melhorenvio=ok`)
      }
      return html(`<h2>✅ Melhor Envio conectado</h2><p>Polo <b>${tenantId}</b>. Pode fechar esta aba.</p>`)
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 240)
      if (returnUrl) {
        const sep = returnUrl.includes('?') ? '&' : '?'
        return redirect(`${returnUrl}${sep}melhorenvio=erro&msg=${encodeURIComponent(msg.slice(0, 120))}`)
      }
      return html(`<h2>❌ Falha ao conectar</h2><pre style="white-space:pre-wrap">${msg}</pre>`, 502)
    }
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // === POST {action:'authorize_url'} (autenticado) — para um botão "Conectar" no painel ===
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
  if (!meClientCreds()) return json({ error: 'melhor_envio_client_not_configured' }, 400)

  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = (typeof tid === 'string' ? tid.trim() : '') || DEFAULT_TENANT

  const returnUrl = String(payload.returnUrl ?? '').slice(0, 300)
  const state = crypto.randomUUID()
  await admin.from('webhook_jobs').insert({
    source: 'melhorenvio-oauth-state',
    status: JSON.stringify({ tenantId, returnUrl }),
    note: state,
  })
  return json({ ok: true, authorizeUrl: meAuthorizeUrl(state) })
})
