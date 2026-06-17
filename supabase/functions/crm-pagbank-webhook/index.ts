import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction, recordAutoReceipt } from '../_shared/crm.ts'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import { parsePagBankNotification } from '../_shared/pagbank.ts'
import { incrementCouponUse } from '../_shared/coupons.ts'
import { blingCreateSaleOrder } from '../_shared/bling.ts'
import { autoShipToCart } from '../_shared/melhorEnvio.ts'

// Webhook de pagamento do PagBank. Quando o pagamento confirma, move o lead para a
// etapa "Pago" do funil e registra a venda. Idempotente via webhook_jobs. Só age
// quando consegue mapear para um checkout que NÓS geramos (reference_id "lead:<id>"
// ou linha em pagbank_checkouts) — payloads sem correspondência são ignorados.

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

  let payload: unknown
  try {
    const raw = await req.text()
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ ok: true, skipped: 'invalid_json' }, 200)
  }

  const { referenceId, leadId: refLeadId, paid, status, ids } = parsePagBankNotification(payload)

  // Dedup: mesma notificação (mesmo id/ref + status) processa só uma vez.
  const dedupKey = `pagbank:${(ids[0] ?? referenceId ?? 'unknown')}:${status ?? 'na'}`.slice(0, 480)
  const { data: existing } = await admin
    .from('webhook_jobs')
    .select('id')
    .eq('source', 'pagbank-webhook')
    .eq('note', dedupKey)
    .maybeSingle()
  if (existing?.id) return json({ ok: true, status: 'already_processed' }, 200)
  const { data: jobRow } = await admin
    .from('webhook_jobs')
    .insert({ source: 'pagbank-webhook', status: 'processing', note: dedupKey })
    .select('id')
    .maybeSingle()
  const markDone = async () => {
    if (jobRow?.id) await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', String(jobRow.id))
  }

  if (!paid) {
    await markDone()
    return json({ ok: true, skipped: 'not_paid', status }, 200)
  }

  const nowIso = new Date().toISOString()

  // 1) Marca o checkout como PAGO — independente de existir lead (links avulsos
  //    têm lead_id sintético "manual-..."). Casa por reference_id ou checkout id.
  let markedPaid = false
  let paidLeadId = ''
  let paidCheckoutId = ''
  let paidTenantId = ''
  let paidAmountCents = 0
  // Transição real not-paid -> paid (via `.neq('status','paid')`): só aqui contamos
  // o cupom, pra não somar duas vezes em notificações repetidas (PAID, AVAILABLE...).
  const redeemCoupon = async (data: Record<string, unknown> | null) => {
    if (!data) return
    markedPaid = true
    paidLeadId = String((data as { lead_id?: string }).lead_id ?? '')
    paidCheckoutId = String((data as { checkout_id?: string }).checkout_id ?? '')
    paidTenantId = String((data as { tenant_id?: string }).tenant_id ?? '')
    paidAmountCents = Number((data as { amount_cents?: number }).amount_cents ?? 0)
    const code = (data as { coupon_code?: string }).coupon_code
    const tenant = paidTenantId
    if (code) await incrementCouponUse(admin, tenant, code)
  }
  if (referenceId) {
    const { data } = await admin
      .from('pagbank_checkouts')
      .update({ status: 'paid', paid_at: nowIso })
      .eq('reference_id', referenceId)
      .neq('status', 'paid')
      .select('lead_id, tenant_id, coupon_code, checkout_id, amount_cents')
      .maybeSingle()
    await redeemCoupon(data as Record<string, unknown> | null)
  }
  if (!markedPaid) {
    for (const id of ids) {
      const { data } = await admin
        .from('pagbank_checkouts')
        .update({ status: 'paid', paid_at: nowIso })
        .eq('checkout_id', id)
        .neq('status', 'paid')
        .select('lead_id, tenant_id, coupon_code, checkout_id, amount_cents')
        .maybeSingle()
      if (data) {
        await redeemCoupon(data as Record<string, unknown>)
        break
      }
    }
  }
  // Fallback: nenhuma transição (notificação repetida ou já paga). Recupera o lead
  // por reference_id só para o restante do fluxo (idempotente) não perder o lead.
  if (!paidLeadId && referenceId) {
    const { data } = await admin
      .from('pagbank_checkouts')
      .select('lead_id')
      .eq('reference_id', referenceId)
      .maybeSingle()
    if (data) paidLeadId = String((data as { lead_id?: string }).lead_id ?? '')
  }

  // Comprovante AUTOMÁTICO do Pix (PagBank) — grava a prova da transação na 1ª confirmação,
  // INCLUSIVE para links avulsos (sem lead real). Idempotente. Nunca perdemos o recebimento.
  if (markedPaid && paidCheckoutId && paidTenantId) {
    await recordAutoReceipt(admin, {
      tenantId: paidTenantId,
      paymentId: paidCheckoutId,
      paymentMethod: 'pix',
      amountCents: paidAmountCents,
      note: 'Comprovante automático PagBank (Pix confirmado).',
      autoData: {
        gateway: 'pagbank',
        reference_id: referenceId ?? null,
        transaction_ids: ids,
        status: status ?? null,
        paid_at: nowIso,
      },
    })
  }

  // 2) Lead REAL (ignora ids sintéticos "manual-" dos links avulsos).
  const candidate =
    refLeadId && !refLeadId.startsWith('manual-')
      ? refLeadId
      : paidLeadId && !paidLeadId.startsWith('manual-')
        ? paidLeadId
        : ''
  if (!candidate) {
    await markDone()
    return json({ ok: true, marked_paid: markedPaid, lead: 'avulso_ou_sem_lead' }, 200)
  }
  const leadId = candidate

  const { data: lead } = await admin
    .from('leads')
    .select('id, patient_name, pipeline_id, tenant_id, phone, custom_fields')
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) {
    await markDone()
    return json({ ok: true, marked_paid: markedPaid, skipped: 'lead_not_found' }, 200)
  }
  const l = lead as {
    id: string; patient_name?: string; pipeline_id?: string; tenant_id?: string; phone?: string
    custom_fields?: { cadastro?: Record<string, string> }
  }
  const tenantId = String(l.tenant_id ?? '')

  // Etapa "Pago" do funil do lead (por nome), com fallback ao funil de vendas do Tricopill.
  let pagoStageId = 'tricopill__vd-pago'
  if (l.pipeline_id) {
    const { data: stage } = await admin
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', l.pipeline_id)
      .ilike('name', 'pago%')
      .maybeSingle()
    if (stage?.id) pagoStageId = String(stage.id)
  }

  await admin
    .from('leads')
    .update({ stage_id: pagoStageId, temperature: 'hot', updated_at: nowIso })
    .eq('id', leadId)

  try {
    await insertInteraction(admin, {
      leadId,
      patientName: String(l.patient_name ?? 'Cliente'),
      channel: 'system',
      direction: 'system',
      author: 'PagBank',
      content: '💳 Pagamento confirmado (PagBank). Lead movido para "Pago".',
      tenantId: tenantId || undefined,
    })
  } catch {
    // ignore
  }

  try {
    await notifyAgents(admin, {
      leadId,
      kind: 'urgent',
      title: 'Pagamento confirmado 🎉',
      body: `${l.patient_name ?? 'Cliente'} pagou — venda fechada no Tricopill.`,
      includeOwner: true,
      tenantId: tenantId || undefined,
    })
  } catch {
    // ignore
  }

  // Pedido automático no Bling (best-effort; só roda se auto_order_enabled e o lead tem kit).
  // IDEMPOTÊNCIA: só na 1ª confirmação (markedPaid) — webhooks repetidos do PagBank (AUTORIZADO
  // depois PAGO) não recriam pedido nem reemitem NF-e. (Eventos idênticos já caem no dedup acima.)
  if (tenantId && markedPaid) {
    try {
      const { data: blingRow } = await admin
        .from('tenant_integrations')
        .select('bling')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      const blingCfg = ((blingRow as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
      if (blingCfg.auto_order_enabled === true) {
        const { data: chk } = await admin
          .from('pagbank_checkouts')
          .select('kit, amount_cents')
          .eq('lead_id', leadId)
          .eq('status', 'paid')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const kit = (chk as { kit?: string } | null)?.kit
        if (kit) {
          try {
            const cad = (l.custom_fields?.cadastro ?? {}) as Record<string, string>
            const out = await blingCreateSaleOrder(admin, tenantId, {
              kit: String(kit),
              amountCents: Number((chk as { amount_cents?: number }).amount_cents ?? 0),
              customerName: String(cad.nomeCompleto || l.patient_name || 'Cliente Tricopill').trim(),
              phone: l.phone ? String(l.phone) : undefined,
              cpf: cad.cpf,
              email: cad.email,
              dataNascimento: cad.dataNascimento,
              sexo: cad.sexo,
              entrega: ((l.custom_fields as Record<string, unknown> | undefined)?.entrega as {
                cep?: string; numero?: string; complemento?: string
                bairro?: string; logradouro?: string; cidade?: string; uf?: string; delivery_mode?: string
              }) ?? undefined,
            })
            await insertInteraction(admin, {
              leadId,
              patientName: String(l.patient_name ?? 'Cliente'),
              channel: 'system',
              direction: 'system',
              author: 'Bling',
              content: `📦 Pedido criado no Bling (#${out.orderId ?? '?'}, ${out.bottles} frascos).`,
              tenantId,
            })
          } catch (e) {
            await insertInteraction(admin, {
              leadId,
              patientName: String(l.patient_name ?? 'Cliente'),
              channel: 'system',
              direction: 'system',
              author: 'Bling',
              content: `⚠️ Não foi possível criar o pedido no Bling automaticamente: ${(e instanceof Error ? e.message : String(e)).slice(0, 180)}`,
              tenantId,
            })
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  // Envio automático no Melhor Envio (CARRINHO; best-effort, nunca quebra o webhook).
  if (tenantId) {
    try {
      const { data: chkShip } = await admin
        .from('pagbank_checkouts')
        .select('kit, amount_cents')
        .eq('lead_id', leadId)
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const kitShip = (chkShip as { kit?: string } | null)?.kit
      const ship = await autoShipToCart(admin, tenantId, {
        lead: { id: leadId, patient_name: l.patient_name, phone: l.phone, custom_fields: l.custom_fields },
        kit: kitShip ?? null,
        productName: kitShip ? `Tricopill (${kitShip})` : 'Tricopill',
        productValueCents: Number((chkShip as { amount_cents?: number } | null)?.amount_cents ?? 0),
      })
      if (ship.ok || ship.skipped || ship.reason) {
        const txt = ship.ok
          ? `📦 Envio no carrinho do Melhor Envio (#${ship.cartId}). Finalize a compra no painel.`
          : `📦 Envio NÃO gerado automaticamente (${ship.reason}). Gere pelo botão se for entrega.`
        await insertInteraction(admin, {
          leadId, patientName: String(l.patient_name ?? 'Cliente'), channel: 'system', direction: 'system', author: 'Melhor Envio', content: txt, tenantId,
        })
      }
    } catch {
      // best-effort: envio nunca derruba o webhook de pagamento
    }
  }

  await markDone()
  return json({ ok: true, leadId, stage: pagoStageId }, 200)
})
