import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { buildBlingCatalog } from '../_shared/bling.ts'

// Ações autenticadas do Bling para o frontend.
//  POST { action:'list_products', refresh? } -> catálogo (nome, código, preço, estoque) do polo ativo.

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

  let payload: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  if (String(payload.action ?? '') === 'list_products') {
    try {
      const out = await buildBlingCatalog(admin, tenantId, { forceRefresh: payload.refresh === true })
      return json({ ok: true, items: out.items, fetchedAt: out.fetchedAt, fromCache: out.fromCache })
    } catch (e) {
      return json({ ok: false, error: 'bling_catalog_failed', message: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  return json({ error: 'unknown_action' }, 400)
})
