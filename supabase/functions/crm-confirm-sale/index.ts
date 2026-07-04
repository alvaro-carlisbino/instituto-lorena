import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from '../_shared/crm.ts'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import { PAGBANK_KITS, normalizeKitKey } from '../_shared/pagbank.ts'
import { REDE_KITS, resolveRedeKit } from '../_shared/rede.ts'
import { formatBRLCents, incrementCouponUse, quoteCoupon } from '../_shared/coupons.ts'
import { blingCreateSaleOrder } from '../_shared/bling.ts'
import { autoShipToCart } from '../_shared/melhorEnvio.ts'
import { sendSaleReceiptToGroup } from '../_shared/saleReceipt.ts'

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

  // CARRINHO: produtos cadastrados no Bling (id + nome + qty + preço). Cada um vira uma linha.
  const cartItems = Array.isArray(p.items)
    ? (p.items as Array<Record<string, unknown>>).map((it) => ({
        id: String(it.id ?? '').trim(),
        nome: String(it.nome ?? 'Produto').slice(0, 120),
        qty: Math.max(1, Math.round(Number(it.qty ?? 1)) || 1),
        precoCents: Math.max(0, Math.round(Number(it.precoCents ?? 0))),
      })).filter((it) => it.id && it.precoCents > 0)
    : []

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
  } else if (cartItems.length) {
    baseCents = cartItems.reduce((s, it) => s + it.qty * it.precoCents, 0)
    const nomes = cartItems.map((i) => (i.qty > 1 ? `${i.qty}× ${i.nome}` : i.nome)).join(', ')
    label = (cartItems.length === 1 ? nomes : `Carrinho: ${nomes}`).slice(0, 120)
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

  // TRAVA ANTI-DUPLICIDADE: mesma venda (lead + valor) confirmada nos últimos 2 min não
  // gera segundo registro/pedido (evita o duplo-clique que criou 2 pedidos no Bling).
  {
    const since = new Date(Date.now() - 120_000).toISOString()
    const dupQ = isCard
      ? admin.from('rede_payments').select('id').eq('tenant_id', tenantId).eq('lead_id', leadId).eq('amount_cents', totalCents).eq('status', 'paid').gte('paid_at', since)
      : admin.from('pagbank_checkouts').select('checkout_id').eq('tenant_id', tenantId).eq('lead_id', leadId).eq('amount_cents', totalCents).eq('status', 'paid').gte('paid_at', since)
    const { data: dup } = await dupQ.limit(1)
    if (dup && dup.length) {
      return json({ ok: true, duplicate: true, leadId, amountCents: totalCents, message: 'Venda idêntica já registrada há instantes — não dupliquei.' })
    }
  }

  // 1) Registra o pagamento PAGO (entra no BI: pagbank_checkouts / rede_payments).
  const manualPayId = shortId()
  try {
    if (isCard) {
      await admin.from('rede_payments').insert({
        id: manualPayId, tenant_id: tenantId, lead_id: leadId, amount_cents: totalCents,
        description: freightCents > 0 ? `${label} + frete` : label, installments, status: 'paid', paid_at: new Date().toISOString(),
        coupon_code: coupon.applied ? coupon.code : null, discount_cents: coupon.discountCents,
      })
    } else {
      await admin.from('pagbank_checkouts').insert({
        checkout_id: manualPayId, tenant_id: tenantId, lead_id: leadId, reference_id: `lead:${leadId}`,
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
    try {
      const cad = (lead.custom_fields?.cadastro ?? {}) as Record<string, string>
      // Kit conhecido → pedido por kit (frascos). Venda AVULSA → pedido com 1 item descrito
      // (ex.: "Tricopill + Shampoo") pelo valor — assim TODA venda confirmada entra no Bling.
      const out = await blingCreateSaleOrder(admin, tenantId, {
        kit: kitKey ?? '', amountCents: productCents,
        // Carrinho → 1 linha por produto cadastrado no Bling; kit → produto do kit; senão avulso.
        items: cartItems.length ? cartItems : undefined,
        description: kitKey || cartItems.length ? undefined : label,
        customerName, phone: lead.phone ? String(lead.phone) : undefined,
        cpf: cad.cpf, email: cad.email, dataNascimento: cad.dataNascimento, sexo: cad.sexo,
        entrega: (lead.custom_fields?.entrega as {
          cep?: string; numero?: string; complemento?: string
          bairro?: string; logradouro?: string; cidade?: string; uf?: string; delivery_mode?: string
        }) ?? undefined,
      })
      blingOrderId = out.orderId
      blingNote = kitKey
        ? `Pedido criado no Bling (#${out.orderId ?? '?'}, ${out.bottles} frascos).`
        : cartItems.length
        ? `Pedido criado no Bling (#${out.orderId ?? '?'}) com ${cartItems.length} produto(s) do catálogo.`
        : `Pedido AVULSO criado no Bling (#${out.orderId ?? '?'}): ${label}. Confira os itens/estoque no Bling.`
    } catch (e) {
      blingNote = `Falha ao criar pedido no Bling: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`
    }
    try {
      await insertInteraction(admin, {
        leadId, patientName: customerName, channel: 'system', direction: 'system', author: 'Bling',
        content: `📦 ${blingNote}`, tenantId,
      })
    } catch { /* ignore */ }
  }

  // 4b) Envio automático no Melhor Envio (CARRINHO; best-effort, nunca quebra a venda).
  let shipNote: string | null = null
  try {
    const ship = await autoShipToCart(admin, tenantId, {
      lead: { id: leadId, patient_name: lead.patient_name, phone: lead.phone, custom_fields: lead.custom_fields },
      kit: kitKey,
      productName: label,
      productValueCents: productCents,
    })
    if (ship.ok) shipNote = `📦 Envio no carrinho do Melhor Envio (#${ship.cartId}). Finalize a compra no painel.`
    else if (ship.skipped) {
      const motivo: Record<string, string> = {
        retirada_clinica: 'Retirada na clínica (sem envio).',
        entrega_local_maringa: 'Entrega local da equipe (sem etiqueta dos Correios).',
        maringa_entrega_interna: 'Maringá = entrega interna (sem etiqueta).',
        sem_cep: 'sem CEP capturado — gere o envio manualmente.',
        sem_numero: 'sem número do endereço — gere o envio manualmente.',
        sem_rua: 'endereço sem rua — gere o envio manualmente.',
        me_nao_configurado: 'Melhor Envio não configurado.',
        cep_nao_resolvido: 'CEP não encontrado — confira e gere manualmente.',
      }
      shipNote = `📦 Envio NÃO gerado: ${motivo[ship.reason ?? ''] ?? ship.reason}`
    } else {
      shipNote = `📦 Envio não gerado (${ship.reason}${ship.error ? ': ' + ship.error.slice(0, 120) : ''}). Gere manualmente.`
    }
    await insertInteraction(admin, {
      leadId, patientName: customerName, channel: 'system', direction: 'system', author: 'Melhor Envio', content: shipNote, tenantId,
    })
  } catch { /* nunca derruba a venda */ }

  // 4c) Comprovante da venda no grupo do financeiro (best-effort).
  {
    const cad = (lead.custom_fields?.cadastro ?? {}) as Record<string, string>
    await sendSaleReceiptToGroup(admin, {
      tenantId,
      paymentId: manualPayId,
      gateway: 'Confirmação manual (painel)',
      method: isCard ? 'card' : method === 'other' ? 'other' : 'pix',
      installments: isCard ? installments : undefined,
      amountCents: totalCents,
      freightCents,
      discountCents: coupon.discountCents,
      couponCode: coupon.applied ? coupon.code : null,
      produto: label,
      blingOrderId,
      buyer: {
        name: customerName,
        cpf: cad.cpf,
        phone: lead.phone,
        email: cad.email,
        entrega: (lead.custom_fields?.entrega as Record<string, unknown>) ?? null,
      },
      origem: `Confirmação manual por ${user.email || 'atendente'}`,
    })
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
    blingOrderId, blingNote: blingNote || null, shipNote,
  })
})
