import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { finalizeAsaasPaid, finalizeSubscriptionCycle, parseAsaasWebhook, readAsaasConfig } from '../_shared/asaas.ts'

// Webhook do Asaas (público) — confirma pagamento de cartão, Pix E ciclos de ASSINATURA, e
// dispara o downstream (mover lead p/ "Pago", Bling, comprovante automático, Melhor Envio).
// Fonte única de verdade. Auth: header `asaas-access-token` deve bater com
// tenant_integrations.asaas.webhookToken (validado por polo). Idempotente via webhook_jobs.

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
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

  let payload: Record<string, unknown> = {}
  try {
    payload = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ ok: true, skipped: 'invalid_json' }, 200)
  }

  // ===== Gatilho MANUAL (operação): finaliza o downstream (Bling + comprovante + Melhor Envio +
  // mover p/ Pago) de uma cobrança JÁ paga que não passou pelo webhook — ex.: Pix pago fora do
  // gateway e reconciliado à mão. Guardado pelo webhookToken do polo. NÃO depende de evento Asaas.
  // Body: { manual_finalize: true, local_id: "<asaas_payments.id>" }
  if (payload.manual_finalize === true && typeof payload.local_id === 'string') {
    const localId = payload.local_id
    const { data: row } = await admin.from('asaas_payments').select('tenant_id').eq('id', localId).maybeSingle()
    if (!row) return json({ ok: false, error: 'payment_not_found' }, 200)
    const tenantId = String((row as { tenant_id?: string }).tenant_id ?? '')
    const cfg = await readAsaasConfig(admin, tenantId)
    const expected = cfg?.webhookToken ?? ''
    const got = req.headers.get('asaas-access-token') ?? ''
    if (!expected || got !== expected) return json({ ok: false, error: 'invalid_webhook_token' }, 401)
    try {
      await finalizeAsaasPaid(admin, localId)
    } catch (e) {
      return json({ ok: false, error: 'finalize_failed', detail: (e instanceof Error ? e.message : String(e)).slice(0, 300) }, 200)
    }
    return json({ ok: true, manual_finalized: localId }, 200)
  }

  const { event, asaasPaymentId, externalRef, subscriptionId, paid } = parseAsaasWebhook(payload)

  // Dedup. Assinatura: por PAGAMENTO (sem o evento) — assim CONFIRMED e RECEIVED do MESMO ciclo
  // processam só uma vez (não duplica envio). Avulso: por pagamento + evento (comportamento atual).
  const dedupKey = subscriptionId
    ? `asaas:subpay:${asaasPaymentId ?? externalRef ?? 'unknown'}`.slice(0, 480)
    : `asaas:${asaasPaymentId ?? externalRef ?? 'unknown'}:${event || 'na'}`.slice(0, 480)
  const { data: existing } = await admin
    .from('webhook_jobs')
    .select('id')
    .eq('source', 'asaas-webhook')
    .eq('note', dedupKey)
    .maybeSingle()
  if (existing?.id) return json({ ok: true, status: 'already_processed' }, 200)
  const { data: jobRow } = await admin
    .from('webhook_jobs')
    .insert({ source: 'asaas-webhook', status: 'processing', note: dedupKey })
    .select('id')
    .maybeSingle()
  const markDone = async () => {
    if (jobRow?.id) await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', String(jobRow.id))
  }
  const markRetry = async (msg: string) => {
    if (jobRow?.id) await admin.from('webhook_jobs').update({ status: 'retry', note: `${dedupKey} err:${msg.slice(0, 180)}` }).eq('id', String(jobRow.id))
  }

  if (!paid) {
    await markDone()
    return json({ ok: true, skipped: 'not_paid', event }, 200)
  }

  // ===== ASSINATURA: pagamento de um ciclo (tem subscription) =====
  if (subscriptionId) {
    const { data: sub } = await admin
      .from('asaas_subscriptions')
      .select('id, tenant_id')
      .eq('asaas_subscription_id', subscriptionId)
      .maybeSingle()
    if (!sub) {
      await markDone()
      return json({ ok: true, skipped: 'subscription_not_found' }, 200)
    }
    const tenantId = String((sub as { tenant_id?: string }).tenant_id ?? '')
    if (tenantId) {
      const cfg = await readAsaasConfig(admin, tenantId)
      const expected = cfg?.webhookToken ?? ''
      const got = req.headers.get('asaas-access-token') ?? ''
      if (expected && got !== expected) {
        await markDone()
        return json({ ok: false, error: 'invalid_webhook_token' }, 401)
      }
    }
    try {
      await finalizeSubscriptionCycle(admin, String((sub as { id: string }).id), asaasPaymentId)
    } catch (e) {
      await markRetry(e instanceof Error ? e.message : String(e))
      return json({ ok: false, error: 'finalize_subscription_failed' }, 200)
    }
    await markDone()
    return json({ ok: true, subscription_cycle: String((sub as { id: string }).id), event }, 200)
  }

  // ===== AVULSO (cartão/Pix): localiza a cobrança LOCAL =====
  let localId = ''
  if (asaasPaymentId) {
    const { data } = await admin.from('asaas_payments').select('id, tenant_id').eq('asaas_payment_id', asaasPaymentId).maybeSingle()
    if (data) localId = String((data as { id: string }).id)
  }
  if (!localId && externalRef?.startsWith('asaas_payment:')) {
    const cand = externalRef.slice('asaas_payment:'.length)
    const { data } = await admin.from('asaas_payments').select('id').eq('id', cand).maybeSingle()
    if (data) localId = String((data as { id: string }).id)
  }
  if (!localId) {
    await markDone()
    return json({ ok: true, skipped: 'payment_not_found' }, 200)
  }

  // Validação do token do webhook (por polo).
  const { data: row } = await admin.from('asaas_payments').select('tenant_id').eq('id', localId).maybeSingle()
  const tenantId = String((row as { tenant_id?: string } | null)?.tenant_id ?? '')
  if (tenantId) {
    const cfg = await readAsaasConfig(admin, tenantId)
    const expected = cfg?.webhookToken ?? ''
    const got = req.headers.get('asaas-access-token') ?? ''
    if (expected && got !== expected) {
      await markDone()
      return json({ ok: false, error: 'invalid_webhook_token' }, 401)
    }
  }

  try {
    await finalizeAsaasPaid(admin, localId)
  } catch (e) {
    await markRetry(e instanceof Error ? e.message : String(e))
    return json({ ok: false, error: 'finalize_failed' }, 200)
  }

  await markDone()
  return json({ ok: true, finalized: localId, event }, 200)
})
