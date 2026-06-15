import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from '../_shared/crm.ts'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import { PAGBANK_KITS, normalizeKitKey } from '../_shared/pagbank.ts'
import { REDE_KITS, resolveRedeKit } from '../_shared/rede.ts'
import { formatBRLCents, incrementCouponUse, quoteCoupon } from '../_shared/coupons.ts'
import { blingCreateSaleOrder } from '../_shared/bling.ts'

// Confirmação MANUAL de venda pela atendente (quando o cliente paga via link/Pix
// e a venda fecha fora do webhook automático — ex.: ambiente sandbox).
// Marca o lead como Pago, registra o pagamento (entra no BI), cria o pedido no
// Bling (opcional) e notifica o time. Espelha o que o webhook de pagamento faria.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
function shortId(): string {
  return 'manual-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12)
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

  let p: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    p = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  const leadId = String(p.leadId ?? '').trim()
  if (!leadId) return json({ error: 'missing_lead' }, 400)
  const method = String(p.paymentMethod ?? 'pix').toLowerCase() // pix | card | other
  const isCard = method === 'card' || method === 'cartao' || method === 'cartão'
  const createBling = p.createBlingOrder !== false // default true

  const { data: leadRow } = await admin
    .from('leads')
    .select('id, patient_name, phone, custom_fields, tenant_id, pipeline_id')
    .eq('id', leadId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!leadRow) return json({ error: 'lead_not_found' }, 404)
  const lead = leadRow as {
    id: string; patient_name?: string; phone?: string
    custom_fields?: Record<string, unknown>; tenant_id?: string; pipeline_id?: string
  }

  // Resolve valor + kit. Kit usa preço Pix (PAGBANK_KITS, 5% off) ou cartão (REDE_KITS, cheio).
  let baseCents = 0
  let kitKey: string | null = null
  let label = ''
  if (p.kit) {
    const key = normalizeKitKey(String(p.kit))
    if (!key) return json({ error: 'invalid_kit' }, 400)
    const kit = isCard ? (resolveRedeKit(key) ?? null) : (PAGBANK_KITS[key] ? { label: PAGBANK_KITS[key].label, amountCents: PAGBANK_KITS[key].amountCents } : null)
    if (!kit) return json({ error: 'invalid_kit' }, 400)
    baseCents = kit.amountCents
    label = kit.label
    kitKey = key
  } else {
    baseCents = Math.round(Number(p.amountCents ?? 0))
    label = String(p.description ?? 'Venda avulsa').slice(0, 120) || 'Venda avulsa'
  }
  if (!Number.isFinite(baseCents) || baseCents < 100) return json({ error: 'invalid_amount' }, 400)

  // Cupom (opcional).
  const coupon = await quoteCoupon(admin, tenantId, p.couponCode != null ? String(p.couponCode) : null, baseCents)
  const productCents = coupon.finalCents
  // Frete cobrado à parte. Total recebido = produto + frete.
  const freightCents = Math.max(0, Math.round(Number(p.freightCents ?? 0)))
  const totalCents = productCents + freightCents
  const installments = Math.max(1, Math.min(12, Number(p.installments ?? 1) || 1))
  const customerName = String(
    (lead.custom_fields?.cadastro as Record<string, string> | undefined)?.nomeCompleto || lead.patient_name || 'Cliente Tricopill',
  ).slice(0, 60)

  // 1) Registra o pagamento PAGO (entra no BI: pagbank_checkouts / rede_payments).
  try {
    if (isCard) {
      await admin.from('rede_payments').insert({
        id: shortId(), tenant_id: tenantId, lead_id: leadId, amount_cents: totalCents,
        description: freightCents > 0 ? `${label} + frete` : label, installments, status: 'paid', paid_at: new Date().toISOString(),
        coupon_code: coupon.applied ? coupon.code : null, discount_cents: coupon.discountCents,
      })
    } else {
      await admin.from('pagbank_checkouts').insert({
        checkout_id: shortId(), tenant_id: tenantId, lead_id: leadId, reference_id: `lead:${leadId}`,
        amount_cents: totalCents, kit: kitKey, pay_link: 'manual', status: 'paid',
        paid_at: new Date().toISOString(), coupon_code: coupon.applied ? coupon.code : null,
        discount_cents: coupon.discountCents,
      })
    }
  } catch (e) {
    return json({ error: 'record_failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
  if (coupon.applied) await incrementCouponUse(admin, tenantId, coupon.code)

  // 2) Move o lead para a etapa "Pago" (por nome, fallback do funil Tricopill).
  let pagoStageId = 'tricopill__vd-pago'
  if (lead.pipeline_id) {
    const { data: stage } = await admin
      .from('pipeline_stages').select('id').eq('pipeline_id', lead.pipeline_id).ilike('name', 'pago%').maybeSingle()
    if (stage?.id) pagoStageId = String(stage.id)
  }
  await admin.from('leads').update({ stage_id: pagoStageId, temperature: 'hot', updated_at: new Date().toISOString() }).eq('id', leadId)

  // 3) Registra a interação da venda.
  const couponTxt = coupon.applied ? ` (cupom ${coupon.code} -${formatBRLCents(coupon.discountCents)})` : ''
  const methodTxt = isCard ? `cartão ${installments}x` : method === 'other' ? 'outro' : 'Pix'
  const freightTxt = freightCents > 0
    ? ` Produto ${formatBRLCents(productCents)} + frete ${formatBRLCents(freightCents)} = ${formatBRLCents(totalCents)}.`
    : ''
  await insertInteraction(admin, {
    leadId, patientName: customerName, channel: 'system', direction: 'system', author: user.email || 'Atendente',
    content: `💰 Venda confirmada: ${label} — ${formatBRLCents(totalCents)}${couponTxt} via ${methodTxt}.${freightTxt}`,
    tenantId,
  })

  // 4) Pedido no Bling (opcional; só com kit conhecido p/ saber os frascos).
  let blingOrderId: string | null = null
  let blingNote = ''
  if (createBling) {
    if (!kitKey) {
      blingNote = 'Pedido no Bling não criado (venda avulsa sem kit — lance manualmente se precisar).'
    } else {
      try {
        const cad = (lead.custom_fields?.cadastro ?? {}) as Record<string, string>
        const out = await blingCreateSaleOrder(admin, tenantId, { kit: kitKey, amountCents: productCents, customerName, phone: lead.phone ? String(lead.phone) : undefined, cpf: cad.cpf, email: cad.email })
        blingOrderId = out.orderId
        blingNote = `Pedido criado no Bling (#${out.orderId ?? '?'}, ${out.bottles} frascos).`
      } catch (e) {
        blingNote = `Falha ao criar pedido no Bling: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`
      }
    }
    try {
      await insertInteraction(admin, {
        leadId, patientName: customerName, channel: 'system', direction: 'system', author: 'Bling',
        content: `📦 ${blingNote}`, tenantId,
      })
    } catch { /* ignore */ }
  }

  // 5) Notifica o time.
  try {
    await notifyAgents(admin, {
      leadId, kind: 'urgent', title: 'Venda confirmada 🎉',
      body: `${customerName} — ${formatBRLCents(totalCents)} (${methodTxt}). Confirmada por ${user.email || 'atendente'}.`,
      includeOwner: true, tenantId,
    })
  } catch { /* ignore */ }

  return json({
    ok: true, leadId, amountCents: totalCents, productCents, freightCents, discountCents: coupon.discountCents,
    couponCode: coupon.applied ? coupon.code : null, method: methodTxt, stage: pagoStageId,
    blingOrderId, blingNote: blingNote || null,
  })
})
