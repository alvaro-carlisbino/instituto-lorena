import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction, upsertLeadByPhone } from '../_shared/crm.ts'
import { getWhatsappProviderFromEnv } from '../_shared/whatsapp/provider.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const rawBody = await req.text()
  let payload: Record<string, unknown>
  try {
    payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  let provider
  try {
    provider = getWhatsappProviderFromEnv()
  } catch (e) {
    return json({ error: 'provider_not_configured', message: e instanceof Error ? e.message : String(e) }, 500)
  }

  if (!provider.validateWebhookSignature(rawBody, req.headers)) {
    return json({ error: 'unauthorized' }, 401)
  }

  const normalized = provider.normalizeInbound(payload, req.headers)
  if (!normalized) return json({ ok: true, skipped: 'event_not_supported' }, 202)
  if (normalized.direction !== 'in') return json({ ok: true, skipped: 'outbound_echo' }, 202)

  const dedupKey = `event:${provider.name}:${normalized.externalMessageId}`
  const { data: existing } = await admin
    .from('webhook_jobs')
    .select('id')
    .eq('source', 'whatsapp-webhook')
    .eq('note', dedupKey)
    .maybeSingle()
  if (existing?.id) return json({ ok: true, status: 'already_processed' }, 200)

  const { data: jobRow, error: jobInsertError } = await admin
    .from('webhook_jobs')
    .insert({
      source: 'whatsapp-webhook',
      status: 'processing',
      note: dedupKey,
    })
    .select('id')
    .single()
  if (jobInsertError) return json({ error: jobInsertError.message }, 400)

  try {
    const lead = await upsertLeadByPhone(admin, {
      patientName: normalized.fromName,
      phone: normalized.fromPhone,
      summary: normalized.text.slice(0, 500),
      source: 'whatsapp',
      customFields: {
        provider: provider.name,
        externalMessageId: normalized.externalMessageId,
      },
    })

    await insertInteraction(admin, {
      leadId: lead.leadId,
      patientName: normalized.fromName,
      channel: 'whatsapp',
      direction: 'in',
      author: normalized.fromName,
      content: normalized.text,
      happenedAt: normalized.happenedAt,
    })

    try {
      await admin.functions.invoke('ai-triage', {
        body: {
          leadId: lead.leadId,
          patientName: normalized.fromName,
          text: normalized.text,
        },
      })
    } catch {
      // Triagem não deve bloquear ingestão.
    }

    await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', String(jobRow.id))

    return json({
      ok: true,
      leadId: lead.leadId,
      status: lead.status,
      provider: provider.name,
      triage: 'requested',
    })
  } catch (e) {
    await admin
      .from('webhook_jobs')
      .update({
        status: 'retry',
        note: `${dedupKey}|error:${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
      })
      .eq('id', String(jobRow.id))
    return json({ error: 'processing_failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})

