import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  evaluateCrmAiAutoReplyGate,
  nowIso,
  runManychatAiAutoReply,
  stripManychatHandoffMarker,
  upsertConversationStateInboundOnly,
} from '../_shared/crmAiAutoReply.ts'
import {
  findLeadIdByManychatSubscriberId,
  findRealWhatsappLeadByName,
  insertInteraction,
  mergeLeadDropIntoKeep,
  promoteManychatLeadToRealPhone,
  syntheticPhoneFromManychatSubscriberId,
  upsertLeadByPhone,
} from '../_shared/crm.ts'
import {
  pushManychatInstagramDmAfterReply,
  pushManychatWhatsappDmAfterReply,
  readManychatPushConfigForChannel,
} from '../_shared/manychatPublicApi.ts'
import { resolveWhatsappLineInstanceId, sanitizeCrmInstanceKey } from '../_shared/manychatInstanceResolve.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-manychat-crm-secret',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

async function ensureManychatLeadId(
  admin: ReturnType<typeof createClient>,
  input: { subscriberId: string; userName: string; text: string; phone?: string },
): Promise<string> {
  const sid = input.subscriberId.trim()
  const digits = input.phone ? digitsOnly(input.phone) : ''
  if (digits.length >= 10) {
    const { leadId } = await promoteManychatLeadToRealPhone(admin, {
      subscriberId: sid,
      patientName: input.userName || 'Lead Instagram',
      realPhoneDigits: digits,
      summary: input.text.slice(0, 500),
    })
    return leadId
  }

  const lead = await upsertLeadByPhone(admin, {
    patientName: input.userName || 'Lead Instagram',
    phone: syntheticPhoneFromManychatSubscriberId(sid),
    summary: input.text.slice(0, 500),
    source: 'meta_instagram',
    customFields: {
      manychat_subscriber_id: sid,
      channel: 'instagram',
    },
  })

  // Cross-channel merge: Instagram message from someone already known via WhatsApp
  if (lead.status === 'created' && input.userName) {
    const waLeadId = await findRealWhatsappLeadByName(admin, input.userName)
    if (waLeadId) {
      await mergeLeadDropIntoKeep(admin, waLeadId, lead.leadId)
      try {
        await insertInteraction(admin, {
          leadId: waLeadId,
          patientName: input.userName,
          channel: 'system',
          direction: 'system',
          author: 'CRM',
          content: 'Lead do Instagram vinculado ao WhatsApp por nome idêntico.',
          happenedAt: nowIso(),
        })
      } catch { /* ignore */ }
      return waLeadId
    }
  }

  return lead.leadId
}

type AdminClient = ReturnType<typeof createClient>

type ManychatPipelineCtx = {
  jobRowId: string
  dedupKey: string
  subscriberId: string
  userName: string
  text: string
  phoneOpt?: string
  aiInboundUserText: string
  skipManychatPush: boolean
  channel?: string
  /** Linha CRM (`whatsapp_channel_instances`) para prompt IA por instância. */
  whatsappLineInstanceId: string | null
}

type ManychatPipelineResult = {
  leadId: string
  reply: string
  handoff_suggested: boolean
  routing: string
  manychat_push: Record<string, unknown>
  ai_skip_reasons?: string[]
  hint?: string | null
}

function scheduleEdgeBackground(task: Promise<void>): void {
  try {
    const wu = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil
    if (typeof wu === 'function') {
      wu(task)
      return
    }
  } catch {
    /* ignore */
  }
  void task
}

/**
 * Resposta `queued` só faz sentido quando há config para enviar DM via API ManyChat **neste canal**
 * (`MANYCHAT_API_KEY` + field + flow; WhatsApp reusa por omissão os mesmos secrets que Instagram).
 * Sem isso, devolve-se modo síncrono com `reply` no JSON (ManyChat mapeia no passo seguinte).
 * `manychat_sync: true` força síncrono; `manychat_async: true` só entra em fila se o push estiver configurado.
 */
function isManychatAsyncAck(body: Record<string, unknown>): boolean {
  if (body.manychat_sync === true || String(body.manychat_sync ?? '').trim().toLowerCase() === 'true') {
    return false
  }
  const channelRaw = String(body.channel ?? '').trim().toLowerCase()
  const pushCfg = readManychatPushConfigForChannel(channelRaw)

  const forcedAsync =
    body.manychat_async === true || String(body.manychat_async ?? '').trim().toLowerCase() === 'true'
  if (forcedAsync) {
    return pushCfg !== null
  }
  const v = (Deno.env.get('MANYCHAT_ASYNC_ACK') ?? '').trim().toLowerCase()
  if (v === 'false' || v === '0' || v === 'sync') return false
  if (v === 'true' || v === '1') {
    return pushCfg !== null
  }
  return pushCfg !== null
}

async function runManychatMessagePipeline(
  admin: AdminClient,
  ctx: ManychatPipelineCtx,
): Promise<ManychatPipelineResult> {
  try {
    const leadId = await ensureManychatLeadId(admin, {
      subscriberId: ctx.subscriberId,
      userName: ctx.userName,
      text: ctx.text,
      phone: ctx.phoneOpt,
    })

    let waInstForAi: string | null = ctx.whatsappLineInstanceId
    if (waInstForAi) {
      await admin
        .from('leads')
        .update({ whatsapp_instance_id: waInstForAi, updated_at: nowIso() })
        .eq('id', leadId)
    } else {
      const { data: lr } = await admin.from('leads').select('whatsapp_instance_id').eq('id', leadId).maybeSingle()
      const w = lr?.whatsapp_instance_id
      if (w) waInstForAi = String(w)
    }

    await insertInteraction(admin, {
      leadId,
      patientName: ctx.userName,
      channel: 'meta',
      direction: 'in',
      author: ctx.userName,
      content: ctx.text,
      happenedAt: nowIso(),
    })

    const { data: state } = await admin
      .from('crm_conversation_states')
      .select('*')
      .eq('lead_id', leadId)
      .maybeSingle()
    const { data: config } = await admin.from('crm_ai_configs').select('*').eq('id', 'default').maybeSingle()
    const statePrompt = String(state?.prompt_override ?? config?.system_prompt ?? '').trim()

    const gate = await evaluateCrmAiAutoReplyGate(admin, leadId, {
      directionIsInbound: true,
    })

    let reply = ''
    let handoffSuggested = false
    if (gate.canAutoReply) {
      const { replyText, handoffSuggested: ho } = await runManychatAiAutoReply(admin, {
        leadId,
        patientName: ctx.userName,
        aiInboundUserText: ctx.aiInboundUserText,
        inboundHappenedAt: nowIso(),
        ownerMode: gate.ownerMode,
        aiEnabled: gate.aiEnabled,
        statePrompt,
        aiJobSource: 'manychat-webhook',
        whatsappInstanceId: waInstForAi,
      })
      reply = replyText ?? ''
      handoffSuggested = Boolean(ho)
    } else {
      await upsertConversationStateInboundOnly(admin, {
        leadId,
        ownerMode: gate.ownerMode,
        aiEnabled: gate.aiEnabled,
        inboundHappenedAt: nowIso(),
      })
    }

    let manychatPush: Record<string, unknown> = { attempted: false, skipped_reason: 'empty_reply' }
    const replyTrimmed = reply.trim()
    const pushDisabledEnv =
      (Deno.env.get('MANYCHAT_PUSH_DISABLED') ?? '').trim().toLowerCase() === 'true'

    if (pushDisabledEnv) {
      manychatPush = { attempted: false, skipped_reason: 'MANYCHAT_PUSH_DISABLED' }
    } else if (ctx.skipManychatPush) {
      manychatPush = { attempted: false, skipped_reason: 'manychat_skip_push' }
    } else if (replyTrimmed) {
      const isWa = ctx.channel === 'whatsapp' || ctx.channel === 'wa'
      const mcCfg = readManychatPushConfigForChannel(String(ctx.channel ?? ''))
      
      if (!mcCfg) {
        manychatPush = { attempted: false, skipped_reason: 'no_manychat_api_key_or_config_missing' }
      } else {
        const pushArgs = {
          apiKey: mcCfg.apiKey,
          subscriberId: ctx.subscriberId,
          replyText: replyTrimmed,
          fieldId: mcCfg.fieldId,
          flowNs: mcCfg.flowNs,
          messageTag: mcCfg.messageTag || undefined,
        }
        
        const pushResult = isWa 
          ? await pushManychatWhatsappDmAfterReply(pushArgs)
          : await pushManychatInstagramDmAfterReply(pushArgs)
          
        manychatPush = {
          attempted: true,
          ok: pushResult.ok,
          ...(pushResult.ok ? {} : { error: pushResult.error }),
        }
        if (!pushResult.ok) {
          console.warn('crm-manychat-webhook manychat_push:', pushResult.error)
        }
      }
    }

    await admin.from('webhook_jobs').update({ status: 'done' }).eq('id', ctx.jobRowId)

    const routing = gate.canAutoReply ? 'ai_auto_reply_attempted' : 'manual_handoff'
    return {
      leadId,
      reply,
      handoff_suggested: handoffSuggested,
      routing,
      manychat_push: manychatPush,
      ...(gate.canAutoReply
        ? {}
        : {
            ai_skip_reasons: gate.skipReasons,
            hint: gate.skipHint ?? null,
          }),
    }
  } catch (e) {
    await admin
      .from('webhook_jobs')
      .update({
        status: 'retry',
        note: `${ctx.dedupKey}|error:${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
      })
      .eq('id', ctx.jobRowId)
    throw e
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // A verificação de secret do ManyChat foi removida a pedido do usuário
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const action = String(body.action ?? 'message').trim().toLowerCase()
  const subscriberId = String(body.subscriber_id ?? '').trim()
  const leadIdParam = String(body.lead_id ?? '').trim()

  if (action === 'get_thread') {
    if (!subscriberId && !leadIdParam) {
      return json(
        { error: 'missing_identifiers', message: 'Para get_thread envia subscriber_id ou lead_id.' },
        400,
      )
    }
    let resolvedLeadId = leadIdParam
    if (!resolvedLeadId && subscriberId) {
      resolvedLeadId = (await findLeadIdByManychatSubscriberId(admin, subscriberId)) ?? ''
    }
    if (!resolvedLeadId) {
      return json({
        ok: true,
        leadId: null,
        interactions: [],
        status: 'no_lead',
        hint: 'Ainda não existe lead — chama action ingest (ou message) antes.',
        action: 'get_thread',
      })
    }
    const limitRaw = Number(body.limit)
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 40
    const { data: rows, error: threadError } = await admin
      .from('interactions')
      .select('id, channel, direction, author, content, happened_at')
      .eq('lead_id', resolvedLeadId)
      .order('happened_at', { ascending: true })
      .limit(limit)
    if (threadError) {
      return json({ error: 'get_thread_failed', message: threadError.message }, 500)
    }
    return json({
      ok: true,
      leadId: resolvedLeadId,
      status: 'ok',
      interactions: rows ?? [],
      action: 'get_thread',
    })
  }

  if (!subscriberId) return json({ error: 'missing_subscriber_id' }, 400)

  if (action === 'merge_phone') {
    const phone = String(body.phone ?? '').trim()
    const digits = digitsOnly(phone)
    if (digits.length < 10) {
      return json({ error: 'invalid_phone', message: 'Telefone deve ter pelo menos 10 dígitos' }, 400)
    }
    try {
      const userName = String(body.user_name ?? body.name ?? 'Lead Instagram').trim() || 'Lead Instagram'
      const summary = String(body.summary ?? body.text ?? '').trim().slice(0, 500)
      const { leadId, merged } = await promoteManychatLeadToRealPhone(admin, {
        subscriberId,
        patientName: userName,
        realPhoneDigits: digits,
        summary,
      })
      return json({ ok: true, leadId, merged, action: 'merge_phone' })
    } catch (e) {
      return json({ error: 'merge_failed', message: e instanceof Error ? e.message : String(e) }, 400)
    }
  }

  const text = String(body.text ?? body.message ?? '').trim()
  const replyOnly = String(body.reply ?? '').trim()
  if (!text && !(action === 'record_outbound' && replyOnly)) {
    return json({ error: 'missing_text' }, 400)
  }

  const contextAppend = String(body.context_append ?? body.user_context ?? '').trim()
  const aiInboundUserText = contextAppend ? `${text}\n\n---\n${contextAppend}` : text

  const userName = String(body.user_name ?? body.name ?? 'Lead Instagram').trim() || 'Lead Instagram'
  const phoneOpt = String(body.phone ?? '').trim() || undefined

  if (action === 'ingest') {
    try {
      const leadId = await ensureManychatLeadId(admin, {
        subscriberId,
        userName,
        text,
        phone: phoneOpt,
      })
      await insertInteraction(admin, {
        leadId,
        patientName: userName,
        channel: 'meta',
        direction: 'in',
        author: userName,
        content: text,
        happenedAt: nowIso(),
      })
      return json({
        ok: true,
        leadId,
        status: 'ingested',
        reply: '',
        handoff_suggested: false,
        routing: 'ingest_only',
      })
    } catch (e) {
      return json(
        { error: 'ingest_failed', message: e instanceof Error ? e.message : String(e) },
        500,
      )
    }
  }

  if (action === 'record_outbound') {
    const leadId = leadIdParam || (await findLeadIdByManychatSubscriberId(admin, subscriberId))
    if (!leadId) {
      return json(
        {
          error: 'lead_not_found',
          message: 'Não existe lead para este subscriber_id. Chame antes action ingest (ou merge_phone).',
        },
        400,
      )
    }
    const rawOutbound = String(body.reply ?? body.text ?? '').trim()
    if (!rawOutbound) return json({ error: 'missing_text' }, 400)
    const { clean: outboundText, handoffSuggested } = stripManychatHandoffMarker(rawOutbound)
    const author = String(body.author ?? 'Assistente IA').trim() || 'Assistente IA'
    try {
      await insertInteraction(admin, {
        leadId,
        patientName: userName,
        channel: 'meta',
        direction: 'out',
        author,
        content: outboundText || rawOutbound,
        happenedAt: nowIso(),
      })
      return json({
        ok: true,
        leadId,
        status: 'outbound_recorded',
        handoff_suggested: handoffSuggested,
        routing: 'record_outbound',
      })
    } catch (e) {
      return json(
        { error: 'record_outbound_failed', message: e instanceof Error ? e.message : String(e) },
        500,
      )
    }
  }

  const externalMessageId = String(body.external_message_id ?? body.message_id ?? '').trim() ||
    `mc-${subscriberId}-${crypto.randomUUID()}`

  const dedupKey = `manychat:${subscriberId}:${externalMessageId}`
  const { data: existing } = await admin
    .from('webhook_jobs')
    .select('id')
    .eq('source', 'manychat-webhook')
    .eq('note', dedupKey)
    .maybeSingle()
  if (existing?.id) {
    return json({
      ok: true,
      status: 'already_processed',
      reply: '',
      handoff_suggested: false,
      routing: 'dedupe_hit',
      hint:
        'Este external_message_id já foi processado uma vez — a IA não volta a correr. Usa um id único por mensagem (ex. {{message.id}} ou timestamp) ou outro external_message_id para testar de novo. O Supabase não chama a API do ManyChat: no fluxo ManyChat, depois do External Request, tens de ter um passo (Send Message / Flow) que envie o campo reply ao cliente.',
    })
  }

  const { data: jobRow, error: jobInsertError } = await admin
    .from('webhook_jobs')
    .insert({
      source: 'manychat-webhook',
      status: 'processing',
      note: dedupKey,
    })
    .select('id')
    .single()
  if (jobInsertError) return json({ error: jobInsertError.message }, 400)

  const skipManychatPush =
    body.manychat_skip_push === true ||
    String(body.manychat_skip_push ?? '').trim().toLowerCase() === 'true'

  const channelRaw = String(body.channel ?? '').trim().toLowerCase()

  const instanceKeyRaw = sanitizeCrmInstanceKey(body.crm_instance_key ?? body.whatsapp_instance_id)
  let whatsappLineInstanceId: string | null = null
  if (instanceKeyRaw) {
    whatsappLineInstanceId = await resolveWhatsappLineInstanceId(admin, instanceKeyRaw)
  }

  const pipelineCtx: ManychatPipelineCtx = {
    jobRowId: String(jobRow.id),
    dedupKey,
    subscriberId,
    userName,
    text,
    phoneOpt,
    aiInboundUserText,
    skipManychatPush,
    channel: channelRaw,
    whatsappLineInstanceId,
  }

  if (isManychatAsyncAck(body)) {
    scheduleEdgeBackground(
      runManychatMessagePipeline(admin, pipelineCtx).catch((err) => {
        console.error('crm-manychat-webhook async pipeline:', err)
      }),
    )
    return json({
      ok: true,
      accepted: true,
      routing: 'queued',
      external_message_id: externalMessageId,
      subscriber_id: subscriberId,
      reply: '',
      handoff_suggested: false,
      manychat_push: { attempted: false, skipped_reason: 'async_pending' },
      hint:
        'Modo fila: IA + envio DM via API ManyChat em segundo plano (evita timeout ~10s). Este JSON não inclui reply. Exige MANYCHAT_API_KEY e field/flow válidos para o canal (WhatsApp reusa por omissão MANYCHAT_DM_*). Sem push configurado o CRM responde sincronamente com reply; use manychat_sync: true ou não force manychat_async.',
    })
  }

  try {
    const r = await runManychatMessagePipeline(admin, pipelineCtx)
    return json({
      ok: true,
      leadId: r.leadId,
      reply: r.reply,
      handoff_suggested: r.handoff_suggested,
      routing: r.routing,
      manychat_push: r.manychat_push,
      ...(r.routing === 'manual_handoff'
        ? { ai_skip_reasons: r.ai_skip_reasons ?? [], hint: r.hint ?? null }
        : {}),
    })
  } catch (e) {
    return json({ error: 'processing_failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})
