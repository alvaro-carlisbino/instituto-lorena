import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { runManychatAiAutoReply, runWhatsappAiAutoReply } from '../_shared/crmAiAutoReply.ts'
import { pushManychatInstagramDmAfterReply, readManychatPushConfigFromEnv } from '../_shared/manychatPublicApi.ts'
import { getEvolutionProviderForLead, getOfficialProviderForLead } from '../_shared/whatsapp/evolutionConfig.ts'
import type { WhatsappProvider } from '../_shared/whatsapp/types.ts'

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

type Action = 'get_state' | 'set_mode' | 'get_config' | 'set_config' | 'force_ai_reply'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !serviceRole || !anon) return json({ error: 'server_misconfigured' }, 500)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  })
  const admin = createClient(supabaseUrl, serviceRole)

  const { data: authData, error: authErr } = await userClient.auth.getUser()
  if (authErr || !authData.user) return json({ error: 'unauthorized' }, 401)
  const authUserId = authData.user.id
  const userEmail = authData.user.email ?? ''

  const { data: me } = await admin.from('app_users').select('id, role, email').eq('auth_user_id', authUserId).maybeSingle()
  const role = String((me?.role as string | undefined) ?? 'sdr').toLowerCase()
  const canManageConfig = role === 'admin' || role === 'gestor'

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  const action = String(body.action ?? '').trim() as Action
  if (!action) return json({ error: 'missing_action' }, 400)

  if (action === 'get_state') {
    const leadId = String(body.leadId ?? '').trim()
    if (!leadId) return json({ error: 'missing_lead' }, 400)
    const { data, error } = await admin.from('crm_conversation_states').select('*').eq('lead_id', leadId).maybeSingle()
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, state: data ?? { lead_id: leadId, owner_mode: 'auto', ai_enabled: true } })
  }

  if (action === 'set_mode') {
    const leadId = String(body.leadId ?? '').trim()
    const ownerMode = String(body.ownerMode ?? '').trim().toLowerCase()
    if (!leadId || !['human', 'ai', 'auto'].includes(ownerMode)) return json({ error: 'invalid_payload' }, 400)

    const patch: Record<string, unknown> = {
      lead_id: leadId,
      owner_mode: ownerMode,
      updated_at: new Date().toISOString(),
    }
    if (ownerMode === 'human') patch.last_human_reply_at = new Date().toISOString()
    const { data, error } = await admin.from('crm_conversation_states').upsert(patch).select('*').single()
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, state: data })
  }

  if (action === 'get_config') {
    const { data, error } = await admin.from('crm_ai_configs').select('*').eq('id', 'default').maybeSingle()
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, config: data })
  }

  if (action === 'set_config') {
    if (!canManageConfig) return json({ error: 'forbidden' }, 403)
    const systemPrompt = String(body.systemPrompt ?? '')
    const enabled = Boolean(body.enabled ?? true)
    const defaultOwnerMode = String(body.defaultOwnerMode ?? 'auto').toLowerCase()
    if (!['human', 'ai', 'auto'].includes(defaultOwnerMode)) return json({ error: 'invalid_default_mode' }, 400)
    const maxAiRepliesPerHour = Number(body.maxAiRepliesPerHour ?? 400)
    const minSecondsBetweenAiReplies = Number(body.minSecondsBetweenAiReplies ?? 10)

    const payload = {
      id: 'default',
      enabled,
      system_prompt: systemPrompt.slice(0, 12000),
      default_owner_mode: defaultOwnerMode,
      /** Métrica / UI; o auto-reply já não bloqueia por este valor. */
      max_ai_replies_per_hour: Number.isFinite(maxAiRepliesPerHour) ? Math.max(1, Math.min(5000, maxAiRepliesPerHour)) : 400,
      /** 0 = sem cooldown entre respostas IA (além do atraso “a digitar” na Evolution). */
      min_seconds_between_ai_replies: Number.isFinite(minSecondsBetweenAiReplies)
        ? Math.max(0, Math.min(3600, minSecondsBetweenAiReplies))
        : 10,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await admin.from('crm_ai_configs').upsert(payload).select('*').single()
    if (error) return json({ error: error.message }, 400)
    await admin.from('audit_logs').insert({
      actor_id: (me?.id as string | undefined) ?? null,
      actor_email: userEmail || null,
      action: 'UPDATE',
      target_table: 'crm_ai_configs',
      target_id: 'default',
      metadata: { updated_by: userEmail || authUserId },
    })
    return json({ ok: true, config: data })
  }

  if (action === 'force_ai_reply') {
    const leadId = String(body.leadId ?? '').trim()
    if (!leadId) return json({ error: 'missing_lead' }, 400)

    const { data: canSee, error: rlsErr } = await userClient.from('leads').select('id').eq('id', leadId).maybeSingle()
    if (rlsErr) return json({ error: rlsErr.message }, 400)
    if (!canSee) return json({ error: 'forbidden', message: 'Sem acesso a este lead.' }, 403)

    const { data: lead, error: leadErr } = await admin
      .from('leads')
      .select('id, patient_name, phone, source, whatsapp_instance_id, custom_fields')
      .eq('id', leadId)
      .maybeSingle()
    if (leadErr || !lead) return json({ error: 'lead_not_found' }, 404)

    const row = lead as {
      id: string
      patient_name: string
      phone: string | null
      source: string
      whatsapp_instance_id: string | null
      custom_fields: Record<string, unknown> | null
    }

    const { data: state } = await admin.from('crm_conversation_states').select('*').eq('lead_id', leadId).maybeSingle()
    const { data: config } = await admin.from('crm_ai_configs').select('*').eq('id', 'default').maybeSingle()
    const ownerMode = String(state?.owner_mode ?? config?.default_owner_mode ?? 'auto').toLowerCase()
    const aiEnabled = Boolean((state?.ai_enabled ?? true) && (config?.enabled ?? true))

    if (!aiEnabled) {
      return json({
        ok: true,
        replied: false,
        error: 'ai_disabled',
        message: 'IA desligada para este lead ou globalmente.',
      })
    }
    if (ownerMode === 'human') {
      return json({
        ok: true,
        replied: false,
        error: 'human_mode',
        message: 'Modo humano: altere para Misto ou IA para pedir resposta da IA.',
      })
    }

    const { data: lastInRows, error: inErr } = await admin
      .from('interactions')
      .select('id, channel, content, happened_at, author')
      .eq('lead_id', leadId)
      .eq('direction', 'in')
      .in('channel', ['whatsapp', 'meta'])
      .order('happened_at', { ascending: false })
      .limit(1)
    if (inErr) return json({ error: inErr.message }, 400)
    const lastIn = lastInRows?.[0] as
      | { channel: string; content: string; happened_at: string; author: string }
      | undefined
    if (!lastIn?.content?.trim()) {
      return json({
        ok: true,
        replied: false,
        error: 'no_inbound',
        message: 'Não há mensagem de entrada (WhatsApp/Meta) para contextualizar a IA.',
      })
    }

    const statePrompt = String(state?.prompt_override ?? config?.system_prompt ?? '').trim()
    const patientName = String(row.patient_name ?? 'Paciente')
    const aiInboundUserText = String(lastIn.content).trim()
    const inboundHappenedAt = String(lastIn.happened_at)

    if (lastIn.channel === 'whatsapp') {
      const to = String(row.phone ?? '').trim()
      if (!to) {
        return json({
          ok: true,
          replied: false,
          error: 'no_phone',
          message: 'Lead sem telefone para enviar WhatsApp.',
        })
      }
      const waProvider = (Deno.env.get('WHATSAPP_PROVIDER') ?? 'evolution').trim().toLowerCase()
      let sendProvider: WhatsappProvider
      try {
        if (waProvider === 'official') {
          sendProvider = await getOfficialProviderForLead(admin, row.whatsapp_instance_id)
        } else {
          sendProvider = await getEvolutionProviderForLead(admin, row.whatsapp_instance_id)
        }
      } catch (e) {
        return json({
          ok: true,
          replied: false,
          error: 'provider_not_configured',
          message: e instanceof Error ? e.message : String(e),
        })
      }

      const { replied, replyText } = await runWhatsappAiAutoReply(admin, {
        leadId,
        patientName,
        fromPhone: to,
        aiInboundUserText,
        inboundHappenedAt,
        ownerMode,
        aiEnabled,
        statePrompt,
        aiJobSource: 'crm-force-ai-reply',
        sendProvider,
        typingDelayMs: 800,
      })
      return json({
        ok: true,
        channel: 'whatsapp',
        replied,
        replyPreview: replied ? String(replyText ?? '').slice(0, 280) : null,
      })
    }

    if (lastIn.channel === 'meta') {
      const { replied, replyText, handoffSuggested } = await runManychatAiAutoReply(admin, {
        leadId,
        patientName,
        aiInboundUserText,
        inboundHappenedAt,
        ownerMode,
        aiEnabled,
        statePrompt,
        aiJobSource: 'crm-force-ai-reply',
      })
      const replyTrimmed = String(replyText ?? '').trim()
      let manychatPush: Record<string, unknown> = { attempted: false }

      if (replied && replyTrimmed) {
        const subscriberId = String(row.custom_fields?.manychat_subscriber_id ?? '').trim()
        const mcCfg = readManychatPushConfigFromEnv()
        if (!subscriberId) {
          manychatPush = { attempted: false, skipped_reason: 'no_manychat_subscriber_id' }
        } else if (!mcCfg) {
          manychatPush = { attempted: false, skipped_reason: 'no_manychat_api_key' }
        } else {
          const pushResult = await pushManychatInstagramDmAfterReply({
            apiKey: mcCfg.apiKey,
            subscriberId,
            replyText: replyTrimmed,
            fieldId: mcCfg.fieldId,
            flowNs: mcCfg.flowNs,
            messageTag: mcCfg.messageTag || undefined,
          })
          manychatPush = {
            attempted: true,
            ok: pushResult.ok,
            ...(pushResult.ok ? {} : { error: pushResult.error }),
          }
        }
      }

      return json({
        ok: true,
        channel: 'meta',
        replied,
        handoffSuggested: Boolean(handoffSuggested),
        replyPreview: replied ? replyTrimmed.slice(0, 280) : null,
        manychat_push: manychatPush,
      })
    }

    return json({
      ok: true,
      replied: false,
      error: 'unsupported_channel',
      message: String(lastIn.channel),
    })
  }

  return json({ error: 'unknown_action' }, 400)
})
