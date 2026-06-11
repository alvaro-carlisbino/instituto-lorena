import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { createRedePaymentLink, readRedeConfig } from '../_shared/rede.ts'

// Rede/Itaú (cartão) — ações autenticadas.
//  get_config    -> { configured, env }
//  set_config    -> grava { pv?, token?, env?, base_url?, link_path? }
//  generate_link -> cria link de cartão { amountCents, description?, leadId? }

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

  if (action === 'get_config') {
    const cfg = await readRedeConfig(admin, tenantId)
    return json({ ok: true, configured: cfg != null, env: cfg?.env ?? 'sandbox' })
  }

  if (action === 'set_config') {
    const { data } = await admin.from('tenant_integrations').select('rede').eq('tenant_id', tenantId).maybeSingle()
    const cur = ((data as { rede?: Record<string, unknown> } | null)?.rede ?? {}) as Record<string, unknown>
    const next = { ...cur }
    for (const k of ['client_id', 'client_secret', 'company_number', 'created_by', 'env', 'token_base', 'pay_base'] as const) {
      if (payload[k] !== undefined) next[k] = String(payload[k] ?? '').trim()
    }
    // Troca de credenciais invalida o token em cache.
    if (payload.client_id !== undefined || payload.client_secret !== undefined) {
      delete next.access_token
      delete next.token_expires_at
    }
    await admin.from('tenant_integrations').upsert({ tenant_id: tenantId, rede: next })
    return json({ ok: true })
  }

  if (action === 'generate_link') {
    const amountCents = Math.round(Number(payload.amountCents ?? 0))
    const description = String(payload.description ?? 'Pagamento')
    const leadId = payload.leadId != null ? String(payload.leadId) : ''
    const reference = leadId ? `lead:${leadId}` : `manual-${crypto.randomUUID()}`
    try {
      const out = await createRedePaymentLink(admin, { tenantId, amountCents, description, reference })
      return json({ ok: true, payLink: out.payLink, amountCents: out.amountCents })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const status = msg.startsWith('rede_nao_configurado') || msg.startsWith('rede_link_path') ? 400 : 502
      return json({ ok: false, error: 'rede_link_failed', message: msg }, status)
    }
  }

  return json({ error: 'unknown_action' }, 400)
})
