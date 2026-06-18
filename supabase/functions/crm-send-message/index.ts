import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from '../_shared/crm.ts'
import { getEvolutionProviderForLead, getOfficialProviderForLead } from '../_shared/whatsapp/evolutionConfig.ts'
import { getWapiProviderForLead } from '../_shared/whatsapp/wapiConfig.ts'
import type { WhatsappProvider } from '../_shared/whatsapp/types.ts'
import {
  pushManychatInstagramContent,
  pushManychatInstagramDmAfterReply,
  pushManychatWhatsappContent,
  pushManychatWhatsappDmAfterReply,
  readManychatPushConfigForTenantChannel,
  type ManychatContentBlock,
} from '../_shared/manychatPublicApi.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  // Chamadas server-to-server (cron de follow-up via admin.functions.invoke) chegam com a
  // própria service_role key no Authorization. auth.getUser() NÃO devolve usuário p/ um token
  // de service_role → dava 401 e os follow-ups de WhatsApp nunca saíam (sent:0). A plataforma
  // já validou o JWT (verify_jwt=true); aqui só liberamos o caminho de máquina confiável e
  // mantemos a exigência de usuário real para os envios vindos do painel.
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
  const isServiceRole = bearer.length > 0 && bearer === serviceRole
  let user: { email?: string | null } | null = null
  if (!isServiceRole) {
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: authData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !authData.user) return json({ error: 'unauthorized' }, 401)
    user = authData.user
  }

  let body: {
    leadId?: string
    to?: string
    text?: string
    channel?: string
    stickerWebpBase64?: string
    attachments?: Array<{ name?: string; mimeType?: string; base64?: string }>
    /**
     * URLs públicas a enviar como mídia. Em ManyChat, são acrescentadas ao texto da reply
     * (WhatsApp/Instagram renderizam preview). Em Evolution direto, é preferível usar
     * `attachments` com base64; URLs aqui são apenas anexadas ao texto para clicar.
     */
    mediaUrls?: Array<{ url: string; type?: 'image' | 'audio' | 'video' | 'document'; caption?: string }>
    /**
     * Override humano explícito após opt-out. Quando true, ignora `leads.opted_out_at`
     * e libera o envio (apenas via UI humana — IA tem checagem própria em crmAiAutoReply
     * e não passa por aqui). Registra interaction `system` de auditoria. Usuário precisa
     * confirmar no frontend ("assumo risco de ban").
     */
    manualOverride?: boolean
    /**
     * Origem do envio. `stage_automation` bloqueia automação para leads ManyChat fora
     * da janela 24h da Meta — o ManyChat aceita o sendFlow mas a Meta dropa em silêncio,
     * dando toast verde mentiroso. `followup_scheduler` é o cron de follow-up (já filtra
     * a janela do lado dele). Demais valores tratados como envio humano.
     */
    source?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const leadId = String(body.leadId ?? '').trim()
  const to = String(body.to ?? '').trim()
  const text = String(body.text ?? '').trim()
  const stickerWebpBase64 = typeof body.stickerWebpBase64 === 'string' ? body.stickerWebpBase64.trim() : ''
  const attachments = Array.isArray(body.attachments) ? body.attachments : []
  const mediaUrls = (Array.isArray(body.mediaUrls) ? body.mediaUrls : [])
    .map((m) => ({
      url: String(m?.url ?? '').trim(),
      type: m?.type ?? undefined,
      caption: typeof m?.caption === 'string' ? m.caption : undefined,
    }))
    .filter((m) => m.url.length > 0)

  if (!leadId) return json({ error: 'missing_fields', message: 'leadId obrigatório' }, 400)

  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .select('id, patient_name, phone, whatsapp_instance_id, custom_fields, source, tenant_id, opted_out_at')
    .eq('id', leadId)
    .maybeSingle()
  if (leadErr || !lead) return json({ error: 'lead_not_found' }, 404)

  const row = lead as {
    id: string;
    patient_name: string;
    phone: string;
    whatsapp_instance_id: string | null;
    tenant_id: string;
    opted_out_at: string | null;
    custom_fields: Record<string, unknown>;
    source: string;
  }

  // Guardrail anti-banimento: bloqueia outbound se paciente optou por sair.
  // LGPD art. 18 IV + proteção contra denúncias no WhatsApp.
  // Override humano explícito (`manualOverride: true`) permite envio com auditoria —
  // operador assume risco de ban. IA continua bloqueada pois nem passa por aqui.
  const manualOverride = Boolean(body.manualOverride)
  if (row.opted_out_at && !manualOverride) {
    return json(
      {
        error: 'lead_opted_out',
        message: 'Este paciente solicitou parar de receber mensagens. Confirme o override em LeadDetail ou clique "Enviar mesmo assim" para assumir o risco de ban.',
        opted_out_at: row.opted_out_at,
      },
      403,
    )
  }
  if (row.opted_out_at && manualOverride) {
    try {
      await insertInteraction(admin, {
        leadId: row.id,
        patientName: row.patient_name,
        channel: 'system',
        direction: 'system',
        author: user?.email || 'Operador',
        content: `Override humano após opt-out (${new Date(row.opted_out_at).toISOString()}). Operador assumiu risco de ban.`,
        tenantId: row.tenant_id,
      })
    } catch (e) {
      console.warn('[crm-send-message] override audit interaction failed:', e instanceof Error ? e.message : String(e))
    }
  }

  const effectiveTo = to || String(row.phone ?? '').trim()
  const customFieldsChannel = String(
    (row.custom_fields as Record<string, unknown> | null)?.channel ?? '',
  ).toLowerCase()
  const bodyChannel = String(body.channel ?? '').toLowerCase()
  // Detecta envio via ManyChat: telefone sintético, canal explícito Instagram,
  // source meta_instagram/meta_whatsapp ou custom_fields.channel sinalizando ManyChat.
  const isManychat =
    effectiveTo.startsWith('888001') ||
    bodyChannel === 'instagram' ||
    row.source === 'meta_instagram' ||
    row.source === 'meta_whatsapp' ||
    customFieldsChannel === 'whatsapp' ||
    customFieldsChannel === 'instagram'

  if (isManychat) {
    // Automação de stage + ManyChat: bloqueia fora da janela 24h da Meta.
    // ManyChat retorna `status:success` no sendFlow mesmo quando a Meta dropa a entrega
    // silenciosamente — frontend mostraria toast verde e paciente não receberia. Esse
    // bloqueio espelha a regra do `crm-followup-scheduler` (24h após last_inbound_at).
    if (String(body.source ?? '').trim() === 'stage_automation') {
      const { data: convState } = await admin
        .from('crm_conversation_states')
        .select('last_inbound_at')
        .eq('lead_id', leadId)
        .maybeSingle()
      const lastInboundIso = convState?.last_inbound_at ? String(convState.last_inbound_at) : null
      const lastInboundMs = lastInboundIso ? new Date(lastInboundIso).getTime() : 0
      const outOfWindow = !lastInboundMs || (Date.now() - lastInboundMs) > 24 * 3600 * 1000
      if (outOfWindow) {
        try {
          await insertInteraction(admin, {
            leadId: row.id,
            patientName: row.patient_name,
            channel: 'system',
            direction: 'system',
            author: 'Automação de etapa',
            content: lastInboundIso
              ? `Automação não enviada: paciente sem responder desde ${new Date(lastInboundIso).toISOString()} (>24h). Meta bloqueia DM fora da janela e o ManyChat entrega "ok" mentiroso. Reativar exige resposta do paciente ou template aprovado pela Meta.`
              : 'Automação não enviada: paciente nunca respondeu via ManyChat. Meta bloqueia DM sem janela 24h aberta.',
            tenantId: row.tenant_id,
          })
        } catch (e) {
          console.warn('[crm-send-message] out_of_window audit interaction failed:', e instanceof Error ? e.message : String(e))
        }
        return json(
          {
            error: 'out_of_window',
            message:
              'Paciente sem responder há mais de 24h — Meta bloqueia DM fora da janela. Automação de etapa não foi disparada para evitar entrega silenciosamente perdida.',
            last_inbound_at: lastInboundIso,
          },
          403,
        )
      }
    }

    const subscriberId = String(
      (row.custom_fields as Record<string, unknown> | null)?.manychat_subscriber_id ?? '',
    ).trim()
    if (!subscriberId) {
      // Sem subscriber ManyChat: se o telefone é sintético, não há canal alternativo.
      if (!row.phone || row.phone.startsWith('888001')) {
        return json({ error: 'manychat_id_missing', message: 'Lead ManyChat sem subscriber ID' }, 400)
      }
    } else {
      // Decide o canal ManyChat (whatsapp vs instagram). Prioridade:
      // 1) body.channel explícito, 2) custom_fields.channel, 3) source do lead.
      const pushChannel =
        bodyChannel === 'whatsapp' || bodyChannel === 'instagram'
          ? bodyChannel
          : customFieldsChannel === 'whatsapp' || customFieldsChannel === 'instagram'
            ? customFieldsChannel
            : row.source === 'meta_whatsapp'
              ? 'whatsapp'
              : 'instagram'

      if (stickerWebpBase64) {
        return json(
          {
            error: 'sticker_not_supported',
            message: 'Figurinhas WebP só pelo WhatsApp direto. No ManyChat use texto ou fluxo.',
          },
          400,
        )
      }
      // Estratégia:
      // • Se há mídia → tenta /fb/sending/sendContent (blocos nativos image/audio/video/file).
      //   Requer plano Pro do ManyChat; se falhar (plano, janela, payload), caímos para o
      //   fluxo legado (URL concatenada no texto + setCustomField+sendFlow).
      // • Sem mídia → segue direto pelo fluxo legado de texto.
      const mediaUrlsBlock = mediaUrls.length > 0 ? mediaUrls.map((m) => m.url).join('\n') : ''
      const replyText = text && mediaUrlsBlock
        ? `${text}\n\n${mediaUrlsBlock}`
        : text || mediaUrlsBlock
      if (!replyText) {
        return json(
          {
            error: 'missing_fields',
            message: 'Envie texto ou pelo menos uma URL em mediaUrls para envios via ManyChat.',
          },
          400,
        )
      }
      const mcCfg = await readManychatPushConfigForTenantChannel(admin, row.tenant_id, pushChannel)
      if (!mcCfg) return json({ error: 'manychat_not_configured' }, 500)

      if (mediaUrls.length > 0) {
        const blocks: ManychatContentBlock[] = mediaUrls.map((m) => ({
          type: (m.type === 'document' ? 'file' : (m.type ?? 'image')) as 'image' | 'audio' | 'video' | 'file',
          url: m.url,
          caption: m.caption,
        }))
        if (text) blocks.unshift({ type: 'text', text })

        const contentArgs = {
          apiKey: mcCfg.apiKey,
          subscriberId,
          blocks,
          messageTag: mcCfg.messageTag || undefined,
        }
        const contentRes =
          pushChannel === 'whatsapp'
            ? await pushManychatWhatsappContent(contentArgs)
            : await pushManychatInstagramContent(contentArgs)

        if (contentRes.ok) {
          const outboundInteractionId = await insertInteraction(admin, {
            leadId: row.id,
            patientName: row.patient_name,
            channel: pushChannel === 'whatsapp' ? 'whatsapp' : 'meta',
            direction: 'out',
            author: user?.email || 'Consultor',
            content: text || mediaUrls.map((m) => m.url).join('\n'),
            happenedAt: nowIso(),
          })
          try {
            await admin.from('crm_media_items').insert(
              mediaUrls.map((m) => ({
                lead_id: row.id,
                interaction_id: outboundInteractionId,
                direction: 'out',
                media_type: m.type ?? 'document',
                storage_path: m.url,
                metadata: {
                  source: 'crm_send_message_manychat_send_content',
                  caption: m.caption ?? null,
                },
              })),
            )
          } catch (e) {
            console.warn('[crm-send-message] manychat sendContent media insert failed:', e instanceof Error ? e.message : String(e))
          }
          return json({
            ok: true,
            provider: `manychat_${pushChannel}`,
            mode: 'send_content',
            interaction_id: outboundInteractionId,
          })
        }
        console.warn('[crm-send-message] manychat sendContent failed, falling back to text+url', JSON.stringify({
          leadId: row.id,
          pushChannel,
          error: contentRes.error,
        }))
      }

      const pushArgs = {
        apiKey: mcCfg.apiKey,
        subscriberId,
        replyText,
        fieldId: mcCfg.fieldId,
        flowNs: mcCfg.flowNs,
        messageTag: mcCfg.messageTag || undefined,
      }
      const push =
        pushChannel === 'whatsapp'
          ? await pushManychatWhatsappDmAfterReply(pushArgs)
          : await pushManychatInstagramDmAfterReply(pushArgs)

      if (!push.ok) {
        console.warn('[crm-send-message] manychat_push_failed', JSON.stringify({
          leadId: row.id,
          pushChannel,
          subscriberId,
          set_field_ok: push.set_field_ok,
          send_flow_ok: push.send_flow_ok,
          send_flow_status: push.send_flow_status,
          error: push.error,
        }))
        const errMsg = String(push.error ?? '')
        const failedAfterFallback = push.send_flow_status === 'failed_after_humanagent_fallback'
        const friendly = failedAfterFallback
          ? `Paciente fora da janela de 7 dias do ${pushChannel === 'whatsapp' ? 'WhatsApp' : 'Instagram'} (Meta). Tentamos enviar com HUMAN_AGENT e também falhou — só dá pra responder depois que a paciente voltar a escrever.`
          : /Validation|24|window|policy|human_agent|HUMAN_AGENT/i.test(errMsg)
            ? `Paciente fora da janela de 24h da Meta. A mensagem ficou pendente; ela precisa responder qualquer coisa para reabrir a janela. (Detalhe técnico: ${errMsg})`
            : errMsg
        return json(
          {
            error: 'manychat_push_failed',
            message: friendly,
            push_channel: pushChannel,
            set_field_ok: push.set_field_ok,
            send_flow_ok: push.send_flow_ok,
            send_flow_status: push.send_flow_status,
            raw_error: errMsg,
          },
          500,
        )
      }

      const outboundInteractionId = await insertInteraction(admin, {
        leadId: row.id,
        patientName: row.patient_name,
        channel: pushChannel === 'whatsapp' ? 'whatsapp' : 'meta',
        direction: 'out',
        author: user?.email || 'Consultor',
        content: replyText,
        happenedAt: nowIso(),
      })

      if (mediaUrls.length > 0) {
        try {
          await admin.from('crm_media_items').insert(
            mediaUrls.map((m) => ({
              lead_id: row.id,
              interaction_id: outboundInteractionId,
              direction: 'out',
              media_type: m.type ?? 'document',
              storage_path: m.url,
              metadata: {
                source: 'crm_send_message_manychat',
                caption: m.caption ?? null,
              },
            })),
          )
        } catch (e) {
          console.warn('[crm-send-message] manychat outbound media insert failed:', e instanceof Error ? e.message : String(e))
        }
      }

      return json({
        ok: true,
        provider: `manychat_${pushChannel}`,
        status: 'delivered',
        media_count: mediaUrls.length,
      })
    }
  }

  // --- WhatsApp Path ---
  // Roteamento por linha: o channel_provider da instância vinculada ao lead
  // sobrescreve a env WHATSAPP_PROVIDER (que segue sendo o default global).
  // Permite W-API conviver com Evolution/Official no mesmo tenant.
  let instanceChannelProvider: string | null = null
  if (row.whatsapp_instance_id) {
    const { data: instRow } = await admin
      .from('whatsapp_channel_instances')
      .select('channel_provider')
      .eq('id', row.whatsapp_instance_id)
      .maybeSingle()
    instanceChannelProvider = String(
      (instRow as { channel_provider?: string } | null)?.channel_provider ?? '',
    ).toLowerCase() || null
  }
  const waProvider =
    instanceChannelProvider ||
    (Deno.env.get('WHATSAPP_PROVIDER') ?? 'evolution').trim().toLowerCase()
  let provider: WhatsappProvider
  try {
    if (waProvider === 'wapi') {
      provider = await getWapiProviderForLead(admin, row.whatsapp_instance_id)
    } else if (waProvider === 'official') {
      provider = await getOfficialProviderForLead(admin, row.whatsapp_instance_id)
    } else {
      provider = await getEvolutionProviderForLead(admin, row.whatsapp_instance_id)
    }
  } catch (e) {
    return json({ error: 'provider_not_configured', message: e instanceof Error ? e.message : String(e) }, 500)
  }

  try {
    const hourlyCap = Math.max(
      30,
      Math.min(2000, Number(Deno.env.get('CRM_SEND_MESSAGE_HOURLY_CAP') ?? '180')),
    )
    const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: outboundLastHour } = await admin
      .from('webhook_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'whatsapp-webhook')
      .like('note', 'outbound:%')
      .gte('created_at', oneHourAgoIso)
    if ((outboundLastHour ?? 0) > hourlyCap) {
      return json(
        {
          error: 'rate_limited',
          message:
            'Limite horário de envios WhatsApp atingido. Aguarde ou ajuste CRM_SEND_MESSAGE_HOURLY_CAP (Edge Functions → Secrets). Para Instagram via ManyChat use sendFlow + record_outbound.',
        },
        429,
      )
    }

    const manualGapSeconds = Math.max(
      0,
      Math.min(600, Number(Deno.env.get('CRM_MANUAL_SEND_MIN_GAP_SECONDS') ?? '10')),
    )
    const { data: state } = await admin
      .from('crm_conversation_states')
      .select('last_human_reply_at, ai_enabled')
      .eq('lead_id', leadId)
      .maybeSingle()
    const lastHumanAt = state?.last_human_reply_at ? new Date(String(state.last_human_reply_at)).getTime() : 0
    if (
      manualGapSeconds > 0 &&
      lastHumanAt > 0 &&
      (Date.now() - lastHumanAt) / 1000 < manualGapSeconds
    ) {
      return json(
        {
          error: 'cooldown',
          message: `Aguarde ${manualGapSeconds}s entre envios manuais neste lead (ou defina CRM_MANUAL_SEND_MIN_GAP_SECONDS=0 para desativar).`,
        },
        429,
      )
    }

    if (!stickerWebpBase64 && !text.trim()) {
      if (attachments.length === 0) {
        return json({ error: 'missing_fields', message: 'Envie texto ou figurinha WebP.' }, 400)
      }
      return json(
        { error: 'missing_fields', message: 'Texto obrigatório ao enviar anexos (figurinha não conta como anexo).' },
        400,
      )
    }

    let sent = await provider.sendMessage({
      to: effectiveTo,
      text,
      leadId,
      stickerWebpBase64: stickerWebpBase64 || undefined,
    })
    let externalMessageId = sent.externalMessageId
    if (stickerWebpBase64 && text.trim()) {
      const textSent = await provider.sendMessage({
        to: effectiveTo,
        text,
        leadId,
      })
      externalMessageId = `${sent.externalMessageId}|${textSent.externalMessageId}`.slice(0, 240)
    }
    const outboundContent = stickerWebpBase64
      ? text
        ? `${text}\n🎭 Figurinha enviada`
        : '🎭 Figurinha enviada'
      : text
    await insertInteraction(admin, {
      leadId: String(lead.id),
      patientName: String(lead.patient_name ?? 'Lead'),
      channel: 'whatsapp',
      direction: 'out',
      author: user?.email ?? 'Operador',
      content: outboundContent,
      externalMessageId,
    })
    const mediaRows: Array<{
      lead_id: string
      direction: 'out'
      media_type: string
      mime_type: string
      metadata: Record<string, unknown>
    }> = []
    if (stickerWebpBase64) {
      mediaRows.push({
        lead_id: leadId,
        direction: 'out',
        media_type: 'image',
        mime_type: 'image/webp',
        metadata: {
          name: 'figurinha.webp',
          size_base64: stickerWebpBase64.length,
          outbound_mode: 'sticker_webp',
        },
      })
    }
    if (attachments.length > 0) {
      mediaRows.push(
        ...attachments.map((file) => ({
          lead_id: leadId,
          direction: 'out' as const,
          media_type: String(file.mimeType ?? '').startsWith('audio/')
            ? 'audio'
            : String(file.mimeType ?? '').startsWith('image/')
              ? 'image'
              : 'document',
          mime_type: String(file.mimeType ?? ''),
          metadata: {
            name: String(file.name ?? 'arquivo'),
            size_base64: String(file.base64 ?? '').length,
            outbound_mode: 'manual_attachment',
          },
        })),
      )
    }
    if (mediaRows.length > 0) {
      await admin.from('crm_media_items').insert(mediaRows)
    }

    await admin.from('webhook_jobs').insert({
      source: 'whatsapp-webhook',
      status: 'done',
      note: `outbound:${provider.name}:${externalMessageId}`.slice(0, 500),
    })
    const preservedAiEnabled =
      state?.ai_enabled !== undefined && state?.ai_enabled !== null ? Boolean(state.ai_enabled) : true

    await admin.from('crm_conversation_states').upsert({
      lead_id: leadId,
      owner_mode: 'human',
      ai_enabled: preservedAiEnabled,
      last_human_reply_at: nowIso(),
      updated_at: nowIso(),
    })

    return json({
      ok: true,
      provider: provider.name,
      externalMessageId,
      status: sent.status,
    })
  } catch (e) {
    await admin.from('webhook_jobs').insert({
      source: 'whatsapp-webhook',
      status: 'retry',
      note: `outbound_error:${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    })
    return json({ error: 'send_failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }
})

