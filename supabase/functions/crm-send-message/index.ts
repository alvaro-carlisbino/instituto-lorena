import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from '../_shared/crm.ts'
import { getEvolutionProviderForLead, getOfficialProviderForLead } from '../_shared/whatsapp/evolutionConfig.ts'
import type { WhatsappProvider } from '../_shared/whatsapp/types.ts'
import { pushManychatInstagramDmAfterReply, readManychatPushConfigFromEnv } from '../_shared/manychatPublicApi.ts'

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
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  let body: {
    leadId?: string
    to?: string
    text?: string
    channel?: string
    stickerWebpBase64?: string
    attachments?: Array<{ name?: string; mimeType?: string; base64?: string }>
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

  if (!leadId) return json({ error: 'missing_fields', message: 'leadId obrigatório' }, 400)

  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .select('id, patient_name, phone, whatsapp_instance_id, custom_fields, source')
    .eq('id', leadId)
    .maybeSingle()
  if (leadErr || !lead) return json({ error: 'lead_not_found' }, 404)

  const row = lead as { 
    id: string; 
    patient_name: string; 
    phone: string; 
    whatsapp_instance_id: string | null;
    custom_fields: Record<string, unknown>;
    source: string;
  }

  const effectiveTo = to || String(row.phone ?? '').trim()
  // Se explicitamente Instagram ou ManyChat (telefone sintético ou canal explícito)
  const isManychat =
    effectiveTo.startsWith('888001') || String(body.channel ?? '').toLowerCase() === 'instagram'

  // --- Instagram / ManyChat Path ---
  if (isManychat || row.source === 'meta_instagram') {
    const subscriberId = String(row.custom_fields?.manychat_subscriber_id ?? '').trim()
    if (!subscriberId) {
       // Fallback para WA se tiver telefone real, senão erro
       if (!row.phone || row.phone.startsWith('888001')) {
         return json({ error: 'manychat_id_missing', message: 'Lead de Instagram sem ID do ManyChat' }, 400)
       }
    } else {
      if (stickerWebpBase64) {
        return json(
          {
            error: 'sticker_not_supported',
            message: 'Figurinhas WebP só pelo WhatsApp. No Instagram/ManyChat use texto ou fluxo.',
          },
          400,
        )
      }
      if (!text) {
        return json({ error: 'missing_fields', message: 'Texto obrigatório para envio via ManyChat' }, 400)
      }
      const mcCfg = readManychatPushConfigFromEnv()
      if (!mcCfg) return json({ error: 'manychat_not_configured' }, 500)

      const push = await pushManychatInstagramDmAfterReply({
        apiKey: mcCfg.apiKey,
        subscriberId,
        replyText: text,
        fieldId: mcCfg.fieldId,
        flowNs: mcCfg.flowNs,
        messageTag: mcCfg.messageTag || undefined,
      })

      if (!push.ok) {
        return json({ error: 'manychat_push_failed', message: push.error }, 500)
      }

      await insertInteraction(admin, {
        leadId: row.id,
        patientName: row.patient_name,
        channel: 'meta',
        direction: 'out',
        author: user.email || 'Consultor',
        content: text,
        happenedAt: nowIso(),
      })

      return json({ ok: true, provider: 'manychat', status: 'delivered' })
    }
  }

  // --- WhatsApp Path ---
  const waProvider = (Deno.env.get('WHATSAPP_PROVIDER') ?? 'evolution').trim().toLowerCase()
  let provider: WhatsappProvider
  try {
    if (waProvider === 'official') {
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
      .select('last_human_reply_at')
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
      author: user.email ?? 'Operador',
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
    await admin.from('crm_conversation_states').upsert({
      lead_id: leadId,
      owner_mode: 'human',
      ai_enabled: true,
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

