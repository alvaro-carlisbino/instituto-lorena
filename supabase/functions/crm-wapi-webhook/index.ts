import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  disableAiOnHandoff,
  evaluateCrmAiAutoReplyGate,
  nowIso,
  runWhatsappAiAutoReply,
  upsertConversationStateInboundOnly,
} from '../_shared/crmAiAutoReply.ts'
import { insertInteraction, upsertLeadByPhone } from '../_shared/crm.ts'
import { captureCadastroForLead } from '../_shared/cadastroExtract.ts'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import { captureNpsInboundResponse } from '../_shared/npsCapture.ts'
import { applyOptOutToLead, isOptOutMessage } from '../_shared/optOutDetect.ts'
import {
  createWapiProviderForRow,
  loadWhatsappInstanceByWapiId,
} from '../_shared/whatsapp/wapiConfig.ts'
import { extractInboundMedia, isMediaOnlyMarker, WapiProvider } from '../_shared/whatsapp/wapi.ts'
import { enrichMediaRowsFromBase64 } from '../_shared/manychatMediaEnrich.ts'

// Webhook próprio da W-API. Roda em paralelo ao crm-whatsapp-webhook (Evolution/Official).
// Cada linha em whatsapp_channel_instances com channel_provider='wapi' tem token e
// instanceId próprios — o tenant é resolvido a partir do payload da W-API (campo
// instanceId) batendo com `wapi_instance_id` da row.
//
// URL pública esperada (Supabase Edge):
//   https://<project>.supabase.co/functions/v1/crm-wapi-webhook
// Cadastre no painel da W-API como webhook de "Mensagens recebidas".

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

/** Roda uma tarefa após o webhook responder (não bloqueia a entrega do W-API). */
function scheduleBackground(task: Promise<void>): void {
  const safe = task.catch((e) => console.warn('[wapi-webhook] bg task:', e instanceof Error ? e.message : String(e)))
  try {
    const wu = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil
    if (typeof wu === 'function') {
      wu(safe)
      return
    }
  } catch {
    /* ignore */
  }
  void safe
}

function extractWapiInstanceIdFromPayload(payload: Record<string, unknown>): string {
  const candidates: unknown[] = [
    (payload as Record<string, unknown>).instanceid,
    (payload as Record<string, unknown>).instanceId,
    (payload as Record<string, unknown>).instance_id,
    ((payload as Record<string, unknown>).data as Record<string, unknown> | undefined)?.instanceId,
    ((payload as Record<string, unknown>).data as Record<string, unknown> | undefined)?.instance_id,
    ((payload as Record<string, unknown>).instance as Record<string, unknown> | undefined)?.id,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return ''
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

  // Resolve a linha via instanceId do payload. Sem isso não dá pra saber tenant nem token.
  const payloadInstanceId = extractWapiInstanceIdFromPayload(payload)
  if (!payloadInstanceId) {
    console.warn('[wapi-webhook] payload sem instanceId. Verificar formato real da W-API:', JSON.stringify(payload).slice(0, 400))
    return json({ ok: true, skipped: 'no_instance_id_in_payload' }, 202)
  }

  const instanceRow = await loadWhatsappInstanceByWapiId(admin, payloadInstanceId)
  if (!instanceRow) {
    return json({ ok: true, skipped: 'instance_not_registered', wapi_instance_id: payloadInstanceId }, 202)
  }

  const provider = createWapiProviderForRow(instanceRow)

  const sigOk = provider.validateWebhookSignature(rawBody, req.headers)
  if (!(await Promise.resolve(sigOk))) {
    return json({ error: 'unauthorized' }, 401)
  }

  const normalized = provider.normalizeInbound(payload, req.headers)
  if (!normalized) {
    console.log('[wapi-webhook] event skipped:', String(payload.event ?? 'unknown'), JSON.stringify(payload).slice(0, 200))
    return json({ ok: true, skipped: 'event_not_supported' }, 202)
  }

  const tenantId = instanceRow.tenant_id ? String(instanceRow.tenant_id) : undefined
  const wInstanceId = instanceRow.id
  // Bot de VENDAS (Tricopill) NUNCA se desliga sozinho: ignora o handoff "triagem finalizada"
  // (regra da clínica). Aqui a IA continua atendendo até a venda fechar.
  const isSalesBot = String(instanceRow.bot_kind ?? '').toLowerCase() === 'sales'

  const dedupKey = `event:wapi:${payloadInstanceId}:${normalized.externalMessageId}`
  const { data: existing } = await admin
    .from('webhook_jobs')
    .select('id')
    .eq('source', 'wapi-webhook')
    .eq('note', dedupKey)
    .maybeSingle()
  if (existing?.id) return json({ ok: true, status: 'already_processed' }, 200)

  const { data: jobRow, error: jobInsertError } = await admin
    .from('webhook_jobs')
    .insert({
      source: 'wapi-webhook',
      status: 'processing',
      note: dedupKey,
    })
    .select('id')
    .single()
  if (jobInsertError) return json({ error: jobInsertError.message }, 400)

  try {
    // Outbound (mensagem enviada do dispositivo / painel da W-API):
    // só registra eco e atualiza last_human_reply_at — não dispara IA.
    if (normalized.direction !== 'in') {
      const lead = await upsertLeadByPhone(admin, {
        patientName: normalized.fromName,
        phone: normalized.fromPhone,
        summary: normalized.text.slice(0, 500),
        source: 'whatsapp',
        whatsappInstanceId: wInstanceId,
        customFields: {
          provider: 'wapi',
          externalMessageId: normalized.externalMessageId,
          direction: 'out',
        },
        tenantId,
      })

      const { data: existingInt } = await admin
        .from('interactions')
        .select('id')
        .eq('lead_id', lead.leadId)
        .eq('external_message_id', normalized.externalMessageId)
        .maybeSingle()
      const skipAsCrmEcho = Boolean(existingInt?.id)

      if (!skipAsCrmEcho) {
        await insertInteraction(admin, {
          leadId: lead.leadId,
          patientName: normalized.fromName,
          channel: 'whatsapp',
          direction: 'out',
          author: normalized.fromName || 'WhatsApp',
          content: normalized.text,
          happenedAt: normalized.happenedAt,
          externalMessageId: normalized.externalMessageId,
        })
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
        provider: 'wapi',
      })
    }

    // Inbound.
    const lead = await upsertLeadByPhone(admin, {
      patientName: normalized.fromName,
      phone: normalized.fromPhone,
      summary: normalized.text.slice(0, 500),
      source: 'whatsapp',
      whatsappInstanceId: wInstanceId,
      customFields: {
        provider: 'wapi',
        externalMessageId: normalized.externalMessageId,
      },
      tenantId,
    })

    if (isOptOutMessage(normalized.text)) {
      await applyOptOutToLead(admin, lead.leadId, 'whatsapp_inbound_opt_out')
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
      tenantId,
    })

    // MÍDIA inbound (imagem/áudio/vídeo/documento): baixa+descriptografa do W-API e grava
    // em crm_media_items pra renderizar no chat (mesmo destino visual do ManyChat).
    // Roda em BACKGROUND (não atrasa a resposta do webhook) com timeout generoso + RETRY:
    // o fileLink do W-API EXPIRA, então um timeout na 1ª tentativa perdia a mídia pra sempre
    // (era o caso dos áudios "sumindo" — só ficava o placeholder "🎤 Áudio").
    try {
      const med = extractInboundMedia(normalized.raw as Record<string, unknown>)
      if (med && provider instanceof WapiProvider) {
        const wapiProvider = provider
        const messageId = normalized.externalMessageId
        const leadIdForMedia = lead.leadId
        scheduleBackground((async () => {
          let dl = await wapiProvider.downloadMedia(messageId, med.mediaType, med.media)
          // Retry do zero (o POST refaz o fileLink) em timeout / erro transitório (5xx).
          for (
            let attempt = 1;
            attempt <= 2 && !dl.ok && /timed out|exception|http_5\d\d|media_url_http_5\d\d/i.test(dl.debug);
            attempt++
          ) {
            await new Promise((r) => setTimeout(r, 1500 * attempt))
            dl = await wapiProvider.downloadMedia(messageId, med.mediaType, med.media)
          }
          await admin.from('webhook_jobs').insert({
            source: 'wapi-media-debug',
            status: dl.ok ? 'done' : 'error',
            note: `${med.mediaType}:${messageId}:${dl.debug}`.slice(0, 490),
          })
          if (dl.ok && dl.base64) {
            const { data: insertedMedia } = await admin
              .from('crm_media_items')
              .insert({
                lead_id: leadIdForMedia,
                interaction_id: inboundInteractionId,
                tenant_id: tenantId,
                direction: 'in',
                media_type: med.mediaType,
                mime_type: dl.mimeType ?? null,
                media_base64: dl.base64,
                metadata: { source: 'wapi', caption: med.caption || null },
              })
              .select('id')
              .single()
            // Enriquece (OCR/transcrição) p/ a IA enxergar a mídia — mesmo pipeline do ManyChat,
            // best-effort (não derruba o background task se o OCR/ASR falhar).
            if (insertedMedia?.id) {
              try {
                await enrichMediaRowsFromBase64(admin, { rowIds: [String(insertedMedia.id)] })
              } catch (e) {
                console.warn('[wapi-webhook] media enrich failed:', e instanceof Error ? e.message : String(e))
              }
            }
            // Cutuca o realtime de `leads` p/ o chat exibir a mídia na hora (sem esperar o poll de 12s).
            await admin.from('leads').update({ updated_at: new Date().toISOString() }).eq('id', leadIdForMedia)
          } else {
            // Não perde a mídia: enfileira p/ o worker (crm-wapi-media-retry) tentar de novo
            // FORA da requisição — o áudio do W-API costuma estourar o timeout aqui na hora.
            await admin.from('crm_media_retry_jobs').insert({
              tenant_id: tenantId ?? null,
              lead_id: leadIdForMedia,
              interaction_id: inboundInteractionId,
              whatsapp_instance_id: wInstanceId,
              message_id: messageId,
              media_type: med.mediaType,
              media: med.media,
              caption: med.caption || null,
              last_error: `${dl.debug}`.slice(0, 300),
            })
          }
        })())
      }
    } catch (e) {
      console.warn('[wapi-webhook] inbound media failed:', e instanceof Error ? e.message : String(e))
    }

    // Captura passiva de dados de cadastro p/ agendar na Shosp sem digitação.
    try {
      await captureCadastroForLead(admin, lead.leadId, normalized.text)
    } catch {
      // best-effort
    }

    // Interrompe follow-up ativo (mesma regra do crm-whatsapp-webhook).
    await admin
      .from('crm_lead_followup_state')
      .update({ status: 'interrupted', updated_at: new Date().toISOString() })
      .eq('lead_id', lead.leadId)
      .eq('status', 'active')

    const { data: leadBefore } = await admin
      .from('leads')
      .select('conversation_status')
      .eq('id', lead.leadId)
      .maybeSingle()
    const statusBefore = String((leadBefore as { conversation_status?: string | null } | null)?.conversation_status ?? '') as
      | 'new'
      | 'ai_triaging'
      | 'waiting_human'
      | 'human_active'
      | ''

    // Captura NPS antes de dispatchar IA (mesmo curto-circuito do webhook Evolution).
    const npsResult = await captureNpsInboundResponse(admin, {
      leadId: lead.leadId,
      inboundText: normalized.text,
      patientName: normalized.fromName,
      tenantId,
    })
    if (npsResult.captured) {
      try {
        const sent = await provider.sendMessage({
          to: normalized.fromPhone,
          text: npsResult.thankYouText,
          leadId: lead.leadId,
        })
        await insertInteraction(admin, {
          leadId: lead.leadId,
          patientName: normalized.fromName,
          channel: 'whatsapp',
          direction: 'out',
          author: 'NPS (IA)',
          content: npsResult.thankYouText,
          externalMessageId: sent.externalMessageId,
          tenantId,
        })
      } catch (e) {
        console.warn('[wapi-webhook] nps thankyou send failed:', e instanceof Error ? e.message : String(e))
      }
      await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', String(jobRow.id))
      return json({
        ok: true,
        routing: 'nps_response_captured',
        score: npsResult.score,
        dispatchId: npsResult.dispatchId,
      })
    }

    const { data: state } = await admin
      .from('crm_conversation_states')
      .select('*')
      .eq('lead_id', lead.leadId)
      .maybeSingle()
    // crm_ai_configs tem PK (tenant_id, id): escopar por tenant da linha/lead.
    const { data: config } = tenantId
      ? await admin.from('crm_ai_configs').select('*').eq('id', 'default').eq('tenant_id', tenantId).maybeSingle()
      : { data: null }
    const statePrompt = String(state?.prompt_override ?? config?.system_prompt ?? '').trim()

    const gate = await evaluateCrmAiAutoReplyGate(admin, lead.leadId, {
      directionIsInbound: true,
    })

    // Só mídia, sem legenda (texto = "📷 Imagem" etc.): a IA não "vê" o conteúdo, então
    // NÃO responde (em vez de dizer "não consigo ver"). A mídia já fica no chat; a próxima
    // mensagem de texto do cliente dispara a IA normalmente.
    const mediaOnly = isMediaOnlyMarker(normalized.text)

    let routing: string
    if (mediaOnly) {
      await admin
        .from('leads')
        .update({ updated_at: new Date().toISOString(), last_interaction_at: new Date().toISOString() })
        .eq('id', lead.leadId)
      routing = 'media_only_no_reply'
    } else if (gate.canAutoReply) {
      const { replied, burstPending, handoffSuggested } = await runWhatsappAiAutoReply(admin, {
        leadId: lead.leadId,
        patientName: normalized.fromName,
        fromPhone: normalized.fromPhone,
        aiInboundUserText: normalized.text,
        inboundHappenedAt: normalized.happenedAt,
        ownerMode: gate.ownerMode,
        aiEnabled: gate.aiEnabled,
        statePrompt,
        aiJobSource: 'wapi-webhook',
        sendProvider: provider,
        keepAiOn: isSalesBot,
      })

      if (handoffSuggested && !isSalesBot) {
        await admin.from('leads').update({
          updated_at: new Date().toISOString(),
          last_interaction_at: new Date().toISOString(),
          conversation_status: 'waiting_human',
        }).eq('id', lead.leadId)
        await disableAiOnHandoff(admin, lead.leadId)
        await notifyAgents(admin, {
          leadId: lead.leadId,
          kind: 'handoff',
          title: 'Triagem Finalizada',
          body: `A IA terminou a triagem de ${normalized.fromName}. Pronto para assumir!`,
          includeOwner: true,
          tenantId,
        })
      } else if (replied) {
        await admin.from('leads').update({ conversation_status: 'ai_triaging' }).eq('id', lead.leadId)
      } else if (statusBefore === 'waiting_human' || statusBefore === 'human_active') {
        await notifyAgents(admin, {
          leadId: lead.leadId,
          kind: 'urgent',
          title: 'Nova mensagem do paciente',
          body: `${normalized.fromName} enviou uma nova mensagem e aguarda resposta.`,
          includeOwner: true,
          dedupeKey: 'unanswered_inbound',
          dedupeWindowMinutes: 3,
          tenantId,
        })
      }

      await admin.from('leads').update({
        updated_at: new Date().toISOString(),
        last_interaction_at: new Date().toISOString(),
      }).eq('id', lead.leadId)

      routing = replied
        ? 'ai_auto_reply_attempted'
        : burstPending
          ? 'ai_inbound_burst_pending'
          : 'manual_handoff'
    } else {
      await upsertConversationStateInboundOnly(admin, {
        leadId: lead.leadId,
        ownerMode: gate.ownerMode,
        aiEnabled: gate.aiEnabled,
        inboundHappenedAt: normalized.happenedAt,
      })

      const isFirstHumanTouch = statusBefore === '' || statusBefore === 'new'
      if (isFirstHumanTouch) {
        await admin.from('leads').update({
          updated_at: new Date().toISOString(),
          last_interaction_at: new Date().toISOString(),
          conversation_status: 'waiting_human',
        }).eq('id', lead.leadId)
      }

      await notifyAgents(admin, {
        leadId: lead.leadId,
        kind: isFirstHumanTouch ? 'handoff' : 'urgent',
        title: isFirstHumanTouch ? 'Novo lead aguardando' : 'Nova mensagem do paciente',
        body: `${normalized.fromName} ${isFirstHumanTouch ? 'iniciou uma conversa' : 'enviou uma nova mensagem'} e aguarda atendimento.`,
        includeOwner: true,
        dedupeKey: 'unanswered_inbound',
        dedupeWindowMinutes: isFirstHumanTouch ? 0 : 3,
        tenantId,
      })

      routing = 'manual_handoff'
    }

    await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', String(jobRow.id))

    return json({
      ok: true,
      leadId: lead.leadId,
      status: lead.status,
      provider: 'wapi',
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
