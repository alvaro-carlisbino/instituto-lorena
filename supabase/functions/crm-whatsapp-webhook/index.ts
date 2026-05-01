import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  evaluateCrmAiAutoReplyGate,
  nowIso,
  runWhatsappAiAutoReply,
  upsertConversationStateInboundOnly,
} from '../_shared/crmAiAutoReply.ts'
import { enrichInboundWhatsappMediaAndAppendContext } from '../_shared/crmMediaEnrichment.ts'
import { findSyntheticInstagramLeadByName, insertInteraction, mergeLeadDropIntoKeep, upsertLeadByPhone } from '../_shared/crm.ts'
import { WA_INSTAGRAM_MERGE_NOTICE_CONTENT } from '../_shared/waInstagramMergeNotice.ts'
import { getWhatsappProviderFromEnv } from '../_shared/whatsapp/provider.ts'
import { getWhatsappProviderForEvent, resolveWhatsappInstanceRowForProvider } from '../_shared/whatsapp/evolutionConfig.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-secret, x-hub-signature-256',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const envProvider = (Deno.env.get('WHATSAPP_PROVIDER') ?? 'evolution').trim().toLowerCase()

  if (req.method === 'GET' && envProvider === 'official') {
    const url = new URL(req.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    const verifyToken = (Deno.env.get('WHATSAPP_CLOUD_VERIFY_TOKEN') ?? '').trim()
    if (mode === 'subscribe' && token && verifyToken && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200, headers: cors })
    }
    return new Response('Forbidden', { status: 403, headers: cors })
  }

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

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

  const sigResult = provider.validateWebhookSignature(rawBody, req.headers)
  if (!(await Promise.resolve(sigResult))) {
    return json({ error: 'unauthorized' }, 401)
  }

  const normalized = provider.normalizeInbound(payload, req.headers)
  if (!normalized) return json({ ok: true, skipped: 'event_not_supported' }, 202)

  const wInstance = await resolveWhatsappInstanceRowForProvider(admin, {
    provider: envProvider,
    evolutionInstanceName: normalized.evolutionInstanceName ?? '',
    metaPhoneNumberId: normalized.metaPhoneNumberId ?? '',
  })
  const wInstanceId = wInstance?.id ?? null

  const instanceKey =
    envProvider === 'official'
      ? String(normalized.metaPhoneNumberId ?? wInstance?.meta_phone_number_id ?? 'default')
      : String(normalized.evolutionInstanceName ?? 'default')

  const dedupKey = `event:${provider.name}:${instanceKey}:${normalized.externalMessageId}`
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
        whatsappInstanceId: wInstanceId,
        customFields: {
          provider: provider.name,
          externalMessageId: normalized.externalMessageId,
          direction: 'out',
        },
      })

      const { data: existingInt } = await admin
        .from('interactions')
        .select('id')
        .eq('lead_id', lead.leadId)
        .eq('external_message_id', normalized.externalMessageId)
        .maybeSingle()

      const skipAsCrmEcho = Boolean(existingInt?.id)

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
          externalMessageId: normalized.externalMessageId,
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

    let lead = await upsertLeadByPhone(admin, {
      patientName: normalized.fromName,
      phone: normalized.fromPhone,
      summary: normalized.text.slice(0, 500),
      source: 'whatsapp',
      whatsappInstanceId: wInstanceId,
      customFields: {
        provider: provider.name,
        externalMessageId: normalized.externalMessageId,
      },
    })

    // Cross-channel merge: WhatsApp message from someone already known via Instagram
    // (their lead has a synthetic phone 888001... — no phone match possible until now)
    if (lead.status === 'created' && normalized.fromName) {
      const instagramLeadId = await findSyntheticInstagramLeadByName(admin, normalized.fromName)
      if (instagramLeadId) {
        // Keep Instagram lead (full history + subscriber_id), drop the new WhatsApp lead
        await mergeLeadDropIntoKeep(admin, instagramLeadId, lead.leadId)
        // Promote the Instagram lead with real phone + WhatsApp instance
        const realPhone = String(normalized.fromPhone ?? '').replace(/\D/g, '')
        await admin
          .from('leads')
          .update({
            phone: realPhone,
            source: 'whatsapp',
            ...(wInstanceId ? { whatsapp_instance_id: wInstanceId } : {}),
          })
          .eq('id', instagramLeadId)
        try {
          await insertInteraction(admin, {
            leadId: instagramLeadId,
            patientName: normalized.fromName,
            channel: 'system',
            direction: 'system',
            author: 'CRM',
            content: WA_INSTAGRAM_MERGE_NOTICE_CONTENT,
            happenedAt: new Date().toISOString(),
          })
        } catch { /* ignore */ }
        lead = { leadId: instagramLeadId, status: 'updated' }
      }
    }

    const inboundInteractionId = await insertInteraction(admin, {
      leadId: lead.leadId,
      patientName: normalized.fromName,
      channel: 'whatsapp',
      direction: 'in',
      author: normalized.fromName,
      content: normalized.text,
      happenedAt: normalized.happenedAt,
      externalMessageId: normalized.externalMessageId,
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
    const { data: config } = await admin.from('crm_ai_configs').select('*').eq('id', 'default').maybeSingle()

    const gate = await evaluateCrmAiAutoReplyGate(admin, lead.leadId, {
      directionIsInbound: normalized.direction === 'in',
    })

    const statePrompt = String(state?.prompt_override ?? config?.system_prompt ?? '').trim()

    let routing: string
    if (gate.canAutoReply) {
      const sendProvider = await getWhatsappProviderForEvent(admin, {
        evolutionInstanceName: normalized.evolutionInstanceName ?? '',
        provider: envProvider,
        metaPhoneNumberId: normalized.metaPhoneNumberId ?? '',
      })
      const { replied } = await runWhatsappAiAutoReply(admin, {
        leadId: lead.leadId,
        patientName: normalized.fromName,
        fromPhone: normalized.fromPhone,
        aiInboundUserText,
        inboundHappenedAt: normalized.happenedAt,
        ownerMode: gate.ownerMode,
        aiEnabled: gate.aiEnabled,
        statePrompt,
        aiJobSource: 'whatsapp-webhook',
        sendProvider,
      })
      routing = replied ? 'ai_auto_reply_attempted' : 'manual_handoff'
    } else {
      await upsertConversationStateInboundOnly(admin, {
        leadId: lead.leadId,
        ownerMode: gate.ownerMode,
        aiEnabled: gate.aiEnabled,
        inboundHappenedAt: normalized.happenedAt,
      })
      routing = 'manual_handoff'
    }

    await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', String(jobRow.id))

    return json({
      ok: true,
      leadId: lead.leadId,
      status: lead.status,
      provider: provider.name,
      routing,
      ...(!gate.canAutoReply
        ? {
            ai_skip_reasons: gate.skipReasons,
            hint: gate.skipHint ?? null,
          }
        : {}),
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
