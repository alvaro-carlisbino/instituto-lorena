import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { enrichInboundWhatsappMediaAndAppendContext } from '../_shared/crmMediaEnrichment.ts'
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

function nowIso(): string {
  return new Date().toISOString()
}

function isWithinQuietHours(date: Date, startHour = 8, endHour = 20): boolean {
  const h = date.getHours()
  return h >= startHour && h < endHour
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
    if (normalized.direction !== 'in') {
      const lead = await upsertLeadByPhone(admin, {
        patientName: normalized.fromName,
        phone: normalized.fromPhone,
        summary: normalized.text.slice(0, 500),
        source: 'whatsapp',
        customFields: {
          provider: provider.name,
          externalMessageId: normalized.externalMessageId,
          direction: 'out',
        },
      })

      const sinceIso = new Date(Date.now() - 120 * 1000).toISOString()
      const { data: crmEchoRows } = await admin
        .from('interactions')
        .select('id')
        .eq('lead_id', lead.leadId)
        .eq('channel', 'whatsapp')
        .eq('direction', 'out')
        .eq('content', normalized.text)
        .gte('happened_at', sinceIso)
        .like('author', '%@%')
        .limit(1)

      const skipAsCrmEcho = Boolean(crmEchoRows && crmEchoRows.length > 0)

      const { data: outLeadRow } = await admin.from('leads').select('patient_name').eq('id', lead.leadId).maybeSingle()
      const outboundPatientLabel = String(outLeadRow?.patient_name ?? normalized.fromName ?? 'Lead')

      if (!skipAsCrmEcho) {
        await insertInteraction(admin, {
          leadId: lead.leadId,
          patientName: outboundPatientLabel,
          channel: 'whatsapp',
          direction: 'out',
          author: normalized.fromName || 'WhatsApp',
          content: normalized.text,
          happenedAt: normalized.happenedAt,
        })

        const outMedia = normalized.mediaItems ?? []
        if (outMedia.length > 0) {
          await admin.from('crm_media_items').insert(
            outMedia.map((item) => ({
              lead_id: lead.leadId,
              direction: 'out',
              media_type: item.type,
              mime_type: item.mimeType ?? null,
              external_media_id: item.externalMediaId ?? null,
              metadata: {
                caption: item.caption ?? '',
                provider: provider.name,
                externalMessageId: normalized.externalMessageId,
              },
            })),
          )
        }
      }

      const { data: outState } = await admin
        .from('crm_conversation_states')
        .select('owner_mode, ai_enabled')
        .eq('lead_id', lead.leadId)
        .maybeSingle()

      await admin.from('crm_conversation_states').upsert({
        lead_id: lead.leadId,
        owner_mode: String(outState?.owner_mode ?? 'auto'),
        ai_enabled: Boolean(outState?.ai_enabled ?? true),
        last_human_reply_at: nowIso(),
        updated_at: nowIso(),
      })

      await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', String(jobRow.id))

      return json({
        ok: true,
        leadId: lead.leadId,
        processed: skipAsCrmEcho ? 'outbound_skipped_crm_echo' : 'outbound_device',
        provider: provider.name,
      })
    }

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

    const inboundInteractionId = await insertInteraction(admin, {
      leadId: lead.leadId,
      patientName: normalized.fromName,
      channel: 'whatsapp',
      direction: 'in',
      author: normalized.fromName,
      content: normalized.text,
      happenedAt: normalized.happenedAt,
    })

    let mediaIntelForAi = ''
    const mediaItems = normalized.mediaItems ?? []
    if (mediaItems.length > 0) {
      const { data: insertedMedia, error: mediaInsertErr } = await admin
        .from('crm_media_items')
        .insert(
          mediaItems.map((item) => ({
            lead_id: lead.leadId,
            interaction_id: inboundInteractionId,
            direction: 'in',
            media_type: item.type,
            mime_type: item.mimeType ?? null,
            external_media_id: item.externalMediaId ?? null,
            metadata: {
              caption: item.caption ?? '',
              provider: provider.name,
              externalMessageId: normalized.externalMessageId,
            },
          })),
        )
        .select('id')
      if (!mediaInsertErr && insertedMedia?.length) {
        const mediaRowIds = insertedMedia.map((r) => String((r as { id: unknown }).id))
        mediaIntelForAi = await enrichInboundWhatsappMediaAndAppendContext({
          admin,
          providerName: provider.name,
          webhookRaw: normalized.raw,
          mediaRowIds,
        })
      }
    }

    const aiInboundUserText = [normalized.text, mediaIntelForAi].filter((s) => String(s).trim()).join('\n\n')

    const { data: state } = await admin
      .from('crm_conversation_states')
      .select('*')
      .eq('lead_id', lead.leadId)
      .maybeSingle()
    const { data: config } = await admin
      .from('crm_ai_configs')
      .select('*')
      .eq('id', 'default')
      .maybeSingle()

    const ownerMode = String(state?.owner_mode ?? config?.default_owner_mode ?? 'auto').toLowerCase()
    const aiEnabled = Boolean((state?.ai_enabled ?? true) && (config?.enabled ?? true))
    const maxPerHour = Number(config?.max_ai_replies_per_hour ?? 2)
    const minSecondsBetween = Number(config?.min_seconds_between_ai_replies ?? 240)
    const latestAiReplyAt = state?.last_ai_reply_at ? new Date(String(state.last_ai_reply_at)).getTime() : 0
    const elapsedSinceAi = latestAiReplyAt ? (Date.now() - latestAiReplyAt) / 1000 : Number.POSITIVE_INFINITY
    const withinWindow = isWithinQuietHours(new Date(), 8, 20)
    const shouldAiByMode = ownerMode === 'ai' || (ownerMode === 'auto' && withinWindow)

    const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: aiRepliesLastHour } = await admin
      .from('webhook_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'whatsapp-webhook')
      .like('note', 'ai_auto_reply:%')
      .gte('created_at', oneHourAgoIso)

    const canAutoReply =
      aiEnabled &&
      shouldAiByMode &&
      normalized.direction === 'in' &&
      elapsedSinceAi >= minSecondsBetween &&
      (aiRepliesLastHour ?? 0) < maxPerHour

    if (canAutoReply) {
      const aiMessages = [{ role: 'user', content: aiInboundUserText }]
      const aiCtx = { leadId: lead.leadId, focus: 'lead' }
      const aiPrompt = String(state?.prompt_override ?? config?.system_prompt ?? '').trim()
      const { data: aiResult } = await admin.functions.invoke('crm-ai-assistant', {
        body: {
          messages: aiMessages,
          context: aiCtx,
          promptOverride: aiPrompt || undefined,
        },
      })

      const aiObj = (aiResult && typeof aiResult === 'object' ? aiResult : {}) as Record<string, unknown>
      const aiReply = typeof aiObj.reply === 'string' ? aiObj.reply.trim() : ''
      if (aiReply) {
        const sent = await provider.sendMessage({
          to: normalized.fromPhone,
          text: aiReply,
          leadId: lead.leadId,
        })
        await insertInteraction(admin, {
          leadId: lead.leadId,
          patientName: normalized.fromName,
          channel: 'whatsapp',
          direction: 'out',
          author: 'Assistente IA',
          content: aiReply,
          happenedAt: nowIso(),
        })
        await admin
          .from('crm_conversation_states')
          .upsert({
            lead_id: lead.leadId,
            owner_mode: ownerMode,
            ai_enabled: aiEnabled,
            last_inbound_at: normalized.happenedAt,
            last_ai_reply_at: nowIso(),
            context_summary: `${aiInboundUserText.slice(0, 280)}\nIA: ${aiReply.slice(0, 220)}`.slice(0, 1200),
            updated_at: nowIso(),
          })
        await admin.from('webhook_jobs').insert({
          source: 'whatsapp-webhook',
          status: 'done',
          note: `ai_auto_reply:${provider.name}:${sent.externalMessageId}`.slice(0, 500),
        })
      }
    } else {
      await admin
        .from('crm_conversation_states')
        .upsert({
          lead_id: lead.leadId,
          owner_mode: ownerMode,
          ai_enabled: aiEnabled,
          last_inbound_at: normalized.happenedAt,
          updated_at: nowIso(),
        })
    }

    await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', String(jobRow.id))

    return json({
      ok: true,
      leadId: lead.leadId,
      status: lead.status,
      provider: provider.name,
      routing: canAutoReply ? 'ai_auto_reply_attempted' : 'manual_handoff',
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

