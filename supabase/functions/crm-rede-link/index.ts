import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { checkRedePixStatus, createRedeIntent, createRedePix, readRedeConfig, testRedeTransaction } from '../_shared/rede.ts'

// e.Rede (cartão) — ações autenticadas do CRM.
//  get_config    -> { configured, env }
//  set_config    -> grava { pv?, token?, env?, base_url? }
//  generate_link -> cria cobrança e devolve a URL /pagar/<id> { amountCents, description?, leadId?, appBaseUrl }
//  test_tx       -> autoriza R$20 com cartão de teste (só sandbox) -> { ok, returnCode, message, tid }

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
    for (const k of ['pv', 'token', 'env', 'base_url'] as const) {
      if (payload[k] !== undefined) next[k] = String(payload[k] ?? '').trim()
    }
    await admin.from('tenant_integrations').upsert({ tenant_id: tenantId, rede: next })
    return json({ ok: true })
  }

  if (action === 'generate_link') {
    const amountCents = Math.round(Number(payload.amountCents ?? 0))
    const description = String(payload.description ?? 'Pagamento')
    const leadId = payload.leadId != null ? String(payload.leadId) : undefined
    const installments = payload.installments != null ? Number(payload.installments) : 1
    const freightCents = payload.freightCents != null ? Number(payload.freightCents) : undefined
    const couponCode = payload.couponCode != null ? String(payload.couponCode) : undefined
    const customerName = payload.customerName != null ? String(payload.customerName).trim() : ''
    const appBaseUrl = String(payload.appBaseUrl ?? '').trim()
    if (!appBaseUrl) return json({ ok: false, error: 'missing_app_base_url' }, 400)
    // Nome que vai pro intent (rede_payments.customer_name). Se o operador NÃO digitou, puxa do
    // lead — senão o pedido nascia sem comprador e aparecia como "Cliente" no painel/comprovante.
    let effectiveName = customerName
    let effectiveDoc: string | undefined
    // Nome completo digitado no link → grava em cadastro.nomeCompleto do lead, pra o pedido
    // no Bling (criado no pagamento) sair com o NOME COMPLETO certo, não o pushname parcial.
    if (leadId && customerName) {
      try {
        const { data: lr } = await admin.from('leads').select('custom_fields').eq('id', leadId).maybeSingle()
        const cf = ((lr as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>
        const cad = (cf.cadastro ?? {}) as Record<string, unknown>
        // Atualiza tb o patient_name → o lead passa a MOSTRAR o nome completo no CRM (não o pushname).
        await admin.from('leads').update({ patient_name: customerName, custom_fields: { ...cf, cadastro: { ...cad, nomeCompleto: customerName } } }).eq('id', leadId)
      } catch { /* best-effort */ }
    } else if (leadId && !customerName) {
      // Operador gerou o link sem digitar o nome, mas o lead já tem: hidrata nome + CPF do lead.
      try {
        const { data: lr } = await admin.from('leads').select('patient_name, custom_fields').eq('id', leadId).maybeSingle()
        const row = lr as { patient_name?: string; custom_fields?: { cadastro?: Record<string, string> } } | null
        const cad = (row?.custom_fields?.cadastro ?? {}) as Record<string, string>
        effectiveName = String(cad.nomeCompleto || row?.patient_name || '').trim()
        effectiveDoc = String(cad.cpf || '').replace(/\D/g, '') || undefined
      } catch { /* best-effort */ }
    }
    try {
      // `kit` opcional: link atrelado a kit do Bling → o pedido automático sai com os itens
      // certos (sem kit o pedido vai como avulso, com a descrição livre).
      const kit = payload.kit != null && String(payload.kit).trim() ? String(payload.kit).trim() : undefined
      const out = await createRedeIntent(admin, { tenantId, amountCents, description, leadId, installments, appBaseUrl, freightCents, couponCode, customerName: effectiveName || undefined, customerDoc: effectiveDoc, kit })
      return json({ ok: true, payLink: out.url, id: out.id, amountCents })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const status = msg.startsWith('rede_nao_configurado') || msg.startsWith('rede_valor') ? 400 : 502
      return json({ ok: false, error: 'rede_link_failed', message: msg }, status)
    }
  }

  if (action === 'generate_pix') {
    const amountCents = Math.round(Number(payload.amountCents ?? 0))
    const description = String(payload.description ?? 'Pagamento')
    const leadId = payload.leadId != null ? String(payload.leadId) : undefined
    const freightCents = payload.freightCents != null ? Number(payload.freightCents) : undefined
    const couponCode = payload.couponCode != null ? String(payload.couponCode) : undefined
    const customerName = payload.customerName != null ? String(payload.customerName).trim() : ''
    const customerDoc = payload.cpf != null ? String(payload.cpf) : (payload.customerDoc != null ? String(payload.customerDoc) : undefined)
    // Mesmo enriquecimento do link de cartão: nome completo digitado → cadastro do lead.
    if (leadId && customerName) {
      try {
        const { data: lr } = await admin.from('leads').select('custom_fields').eq('id', leadId).maybeSingle()
        const cf = ((lr as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>
        const cad = (cf.cadastro ?? {}) as Record<string, unknown>
        await admin.from('leads').update({ patient_name: customerName, custom_fields: { ...cf, cadastro: { ...cad, nomeCompleto: customerName } } }).eq('id', leadId)
      } catch { /* best-effort */ }
    }
    try {
      const kit = payload.kit != null && String(payload.kit).trim() ? String(payload.kit).trim() : undefined
      const out = await createRedePix(admin, { tenantId, amountCents, description, leadId, freightCents, couponCode, customerName: customerName || undefined, customerDoc, kit })
      return json({ ok: true, id: out.id, qrText: out.qrText, qrImage: out.qrImage, amountCents: out.amountCents })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const status = msg.startsWith('rede_nao_configurado') || msg.startsWith('rede_valor') ? 400 : 502
      return json({ ok: false, error: 'rede_pix_failed', message: msg }, status)
    }
  }

  if (action === 'check_pix') {
    const id = String(payload.id ?? '').trim()
    if (!id) return json({ ok: false, error: 'missing_id' }, 400)
    try {
      const out = await checkRedePixStatus(admin, id)
      return json({ ok: true, ...out })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const status = msg.startsWith('cobranca_nao_encontrada') ? 404 : msg.startsWith('rede_nao_configurado') ? 400 : 502
      return json({ ok: false, error: 'rede_check_failed', message: msg }, status)
    }
  }

  if (action === 'test_tx') {
    try {
      const out = await testRedeTransaction(admin, tenantId)
      return json({ ok: out.ok, returnCode: out.returnCode, message: out.message, tid: out.tid, env: out.env })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const status = msg.startsWith('rede_nao_configurado') || msg.startsWith('teste_so_em_sandbox') ? 400 : 502
      return json({ ok: false, error: 'rede_test_failed', message: msg }, status)
    }
  }

  return json({ error: 'unknown_action' }, 400)
})
