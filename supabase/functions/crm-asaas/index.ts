import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { asaasPing, createAsaasCardIntent, createAsaasPix, readAsaasConfig } from '../_shared/asaas.ts'

// Asaas — ações autenticadas do CRM (gateway único cartão + Pix).
//  get_config     -> { configured, env }
//  set_config     -> grava { apiKey?, env?, webhookToken?, base_url? }
//  test           -> testa a credencial (GET /myAccount)
//  generate_card  -> cria cobrança de cartão e devolve /pagar/<id>
//  generate_pix   -> cria cobrança Pix e devolve copia-e-cola + QR (imagem base64)

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
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
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
    const cfg = await readAsaasConfig(admin, tenantId)
    return json({ ok: true, configured: cfg != null, env: cfg?.env ?? 'sandbox' })
  }

  if (action === 'set_config') {
    const { data } = await admin.from('tenant_integrations').select('asaas').eq('tenant_id', tenantId).maybeSingle()
    const cur = ((data as { asaas?: Record<string, unknown> } | null)?.asaas ?? {}) as Record<string, unknown>
    const next = { ...cur }
    for (const k of ['apiKey', 'env', 'webhookToken', 'base_url'] as const) {
      if (payload[k] !== undefined) next[k] = String(payload[k] ?? '').trim()
    }
    await admin.from('tenant_integrations').upsert({ tenant_id: tenantId, asaas: next })
    return json({ ok: true })
  }

  if (action === 'test') {
    const cfg = await readAsaasConfig(admin, tenantId)
    if (!cfg) return json({ ok: false, error: 'asaas_nao_configurado', message: 'Preencha a API Key do Asaas primeiro.' }, 400)
    const r = await asaasPing(cfg)
    return json({ ok: r.ok, message: r.detail, env: cfg.env })
  }

  const customer = {
    name: payload.customerName != null ? String(payload.customerName).trim() : undefined,
    cpf: payload.cpf != null ? String(payload.cpf) : undefined,
    phone: payload.phone != null ? String(payload.phone) : undefined,
    email: payload.email != null ? String(payload.email) : undefined,
  }

  if (action === 'generate_card') {
    const appBaseUrl = String(payload.appBaseUrl ?? '').trim()
    if (!appBaseUrl) return json({ ok: false, error: 'missing_app_base_url' }, 400)
    try {
      const out = await createAsaasCardIntent(admin, {
        tenantId,
        amountCents: Math.round(Number(payload.amountCents ?? 0)),
        description: String(payload.description ?? 'Pagamento'),
        leadId: payload.leadId != null ? String(payload.leadId) : undefined,
        // Sem escolha explícita no painel → undefined: o link nasce com o parcelamento
        // máximo da config (antes ia 1 e o checkout travava "sem parcelamento").
        installments: payload.installments != null ? Number(payload.installments) : undefined,
        appBaseUrl,
        couponCode: payload.couponCode != null ? String(payload.couponCode) : undefined,
        freightCents: payload.freightCents != null ? Number(payload.freightCents) : undefined,
        kit: payload.kit != null ? String(payload.kit) : undefined,
        customer,
      })
      return json({ ok: true, payLink: out.url, id: out.id, amountCents: out.amountCents })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const status = msg.startsWith('asaas_nao_configurado') || msg.startsWith('asaas_valor') ? 400 : 502
      return json({ ok: false, error: 'asaas_card_failed', message: msg }, status)
    }
  }

  if (action === 'generate_pix') {
    try {
      const out = await createAsaasPix(admin, {
        tenantId,
        amountCents: Math.round(Number(payload.amountCents ?? 0)),
        description: String(payload.description ?? 'Pagamento'),
        leadId: payload.leadId != null ? String(payload.leadId) : undefined,
        couponCode: payload.couponCode != null ? String(payload.couponCode) : undefined,
        freightCents: payload.freightCents != null ? Number(payload.freightCents) : undefined,
        kit: payload.kit != null ? String(payload.kit) : undefined,
        customer,
      })
      return json({ ok: true, id: out.id, qrText: out.qrText, qrImageUrl: out.qrImageUrl, amountCents: out.amountCents })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const status = msg.startsWith('asaas_nao_configurado') || msg.startsWith('asaas_valor') ? 400 : 502
      return json({ ok: false, error: 'asaas_pix_failed', message: msg }, status)
    }
  }

  return json({ error: 'unknown_action' }, 400)
})
