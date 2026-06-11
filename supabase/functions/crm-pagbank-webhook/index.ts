import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from '../_shared/crm.ts'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import { parsePagBankNotification } from '../_shared/pagbank.ts'

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

  // Resolve o lead: pela reference_id "lead:<id>" ou por pagbank_checkouts (checkout id).
  let leadId = refLeadId
  let checkoutRowId: string | null = null
  if (!leadId) {
    for (const id of ids) {
      const { data: row } = await admin
        .from('pagbank_checkouts')
        .select('checkout_id, lead_id')
        .eq('checkout_id', id)
        .maybeSingle()
      if (row?.lead_id) {
        leadId = String(row.lead_id)
        checkoutRowId = String(row.checkout_id)
        break
      }
    }
  }
  if (!leadId) {
    await markDone()
    return json({ ok: true, skipped: 'lead_not_resolved' }, 200)
  }

  const { data: lead } = await admin
    .from('leads')
    .select('id, patient_name, pipeline_id, tenant_id')
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) {
    await markDone()
    return json({ ok: true, skipped: 'lead_not_found' }, 200)
  }
  const l = lead as { id: string; patient_name?: string; pipeline_id?: string; tenant_id?: string }
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
    .update({ stage_id: pagoStageId, temperature: 'hot', updated_at: new Date().toISOString() })
    .eq('id', leadId)

  await admin
    .from('pagbank_checkouts')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq(checkoutRowId ? 'checkout_id' : 'lead_id', checkoutRowId ?? leadId)

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

  await markDone()
  return json({ ok: true, leadId, stage: pagoStageId }, 200)
})
