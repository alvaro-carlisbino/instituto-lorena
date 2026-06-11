import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { buildBlingCatalog, blingCreateSaleOrder } from '../_shared/bling.ts'
import { PAGBANK_KITS } from '../_shared/pagbank.ts'

// Ações autenticadas do Bling para o frontend.
//  list_products      -> catálogo (nome, código, preço, estoque) do polo ativo
//  get_order_config   -> { default_contato_id, auto_order_enabled }
//  set_order_config   -> grava { default_contato_id?, auto_order_enabled? }
//  create_test_order  -> cria um pedido de teste no Bling para um kit

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

  const action = String(payload.action ?? '')

  if (action === 'list_products') {
    try {
      const out = await buildBlingCatalog(admin, tenantId, { forceRefresh: payload.refresh === true })
      return json({ ok: true, items: out.items, fetchedAt: out.fetchedAt, fromCache: out.fromCache })
    } catch (e) {
      return json({ ok: false, error: 'bling_catalog_failed', message: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  if (action === 'get_order_config') {
    const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
    const cfg = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
    return json({
      ok: true,
      default_contato_id: cfg.default_contato_id != null ? String(cfg.default_contato_id) : '',
      auto_order_enabled: cfg.auto_order_enabled === true,
    })
  }

  if (action === 'set_order_config') {
    const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
    const cfg = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
    const next = { ...cfg }
    if (payload.default_contato_id !== undefined) {
      next.default_contato_id = String(payload.default_contato_id ?? '').trim()
    }
    if (payload.auto_order_enabled !== undefined) {
      next.auto_order_enabled = payload.auto_order_enabled === true
    }
    await admin.from('tenant_integrations').upsert({ tenant_id: tenantId, bling: next })
    return json({ ok: true })
  }

  if (action === 'create_test_order') {
    const kit = String(payload.kit ?? '3_meses')
    const amountCents = PAGBANK_KITS[kit]?.amountCents ?? 18905
    try {
      const out = await blingCreateSaleOrder(admin, tenantId, { kit, amountCents, customerName: 'Pedido de teste' })
      return json({ ok: true, orderId: out.orderId, bottles: out.bottles })
    } catch (e) {
      return json({ ok: false, error: 'bling_order_failed', message: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  return json({ error: 'unknown_action' }, 400)
})
