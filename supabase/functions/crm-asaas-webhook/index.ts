import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { finalizeAsaasPaid, parseAsaasWebhook, readAsaasConfig } from '../_shared/asaas.ts'

// Webhook do Asaas (público) — confirma pagamento de cartão E Pix e dispara o downstream
// (mover lead p/ "Pago", Bling, comprovante automático, Melhor Envio). Fonte única de verdade.
// Auth: header `asaas-access-token` deve bater com tenant_integrations.asaas.webhookToken
// (validado por polo, depois de localizar a cobrança). Idempotente via webhook_jobs.

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

  const { event, asaasPaymentId, externalRef, paid } = parseAsaasWebhook(payload)

  // Dedup: mesmo (pagamento + evento) processa uma única vez.
  const dedupKey = `asaas:${asaasPaymentId ?? externalRef ?? 'unknown'}:${event || 'na'}`.slice(0, 480)
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

  if (!paid) {
    await markDone()
    return json({ ok: true, skipped: 'not_paid', event }, 200)
  }

  // Localiza a cobrança LOCAL: por asaas_payment_id (cartão e pix) ou pelo externalReference
  // `asaas_payment:<localId>` (cartão antes do webhook ter gravado o asaas_payment_id).
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

  // Validação do token do webhook (por polo). Se o polo tiver webhookToken configurado, exige
  // que o header bata; sem token configurado, aceita (best-effort) e segue.
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
    await admin.from('webhook_jobs').update({ status: 'retry', note: `${dedupKey} err:${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` }).eq('id', String(jobRow?.id ?? ''))
    return json({ ok: false, error: 'finalize_failed' }, 200)
  }

  await markDone()
  return json({ ok: true, finalized: localId, event }, 200)
})
