import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

import { insertInteraction } from './crm.ts'
import type { WhatsappProvider } from './whatsapp/types.ts'

/** Mesma convenção do fluxo n8n ManyChat (triagem → consultor humano). */
export const MANYCHAT_HANDOFF_MARKER = '[PRONTO_PARA_CONSULTOR]'

export function stripManychatHandoffMarker(reply: string): { clean: string; handoffSuggested: boolean } {
  const has = reply.includes(MANYCHAT_HANDOFF_MARKER)
  const clean = reply.split(MANYCHAT_HANDOFF_MARKER).join('').trim()
  return { clean, handoffSuggested: has }
}

const TRIAGE_MAPPING: Record<string, { pipelineId: string; stageId: string }> = {
  '1': { pipelineId: 'pipeline-tratamento-capilar', stageId: 'tc-triagem' },
  '2': { pipelineId: 'pipeline-tratamento-capilar', stageId: 'tc-triagem' },
  '3': { pipelineId: 'pipeline-clinica', stageId: 'triagem' },
  '4': { pipelineId: 'pipeline-clinica', stageId: 'triagem' },
  '5': { pipelineId: 'pipeline-tratamento-capilar', stageId: 'tc-triagem' },
}

const INITIAL_TRIAGE_MESSAGE_TEMPLATE = `Olá, {name}! Boa tarde, tudo bem? Seja muito bem-vindo ao Instituto Lorena Visentainer. 💆

Eu sou o assistente virtual da clínica e vou realizar o seu primeiro atendimento para que, em instantes, a nossa consultora Dandara assuma a nossa conversa.

Para começarmos da melhor forma, seria uma consulta para Transplante Capilar ou Consulta Clínica? Por favor, digite o número da opção desejada:

1. Transplante Capilar Masculino
2. Transplante Capilar Feminino
3. Consulta Clínica Masculino
4. Consulta Clínica Feminino
5. Transplante de Sobrancelha`

export function isWithinQuietHours(date: Date, startHour = 8, endHour = 20): boolean {
  const h = date.getHours()
  return h >= startHour && h < endHour
}

export function nowIso(): string {
  return new Date().toISOString()
}

export async function countAiAutoRepliesLastHour(
  admin: SupabaseClient,
  sources: string[],
): Promise<number> {
  if (sources.length === 0) return 0
  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await admin
    .from('webhook_jobs')
    .select('id', { count: 'exact', head: true })
    .in('source', sources)
    .like('note', 'ai_auto_reply:%')
    .gte('created_at', oneHourAgoIso)
  return count ?? 0
}

export type CrmAiAutoReplyGate = {
  canAutoReply: boolean
  ownerMode: string
  aiEnabled: boolean
  /** Preenchido quando `canAutoReply` é false — códigos estáveis para suporte e automações. */
  skipReasons: string[]
  /** Dica curta para humanos (ManyChat / logs). */
  skipHint?: string
}

export async function evaluateCrmAiAutoReplyGate(
  admin: SupabaseClient,
  leadId: string,
  options: {
    directionIsInbound: boolean
    rateLimitJobSources: string[]
  },
): Promise<CrmAiAutoReplyGate> {
  const { data: state } = await admin
    .from('crm_conversation_states')
    .select('*')
    .eq('lead_id', leadId)
    .maybeSingle()
  const { data: config } = await admin.from('crm_ai_configs').select('*').eq('id', 'default').maybeSingle()

  const ownerMode = String(state?.owner_mode ?? config?.default_owner_mode ?? 'auto').toLowerCase()
  const aiEnabled = Boolean((state?.ai_enabled ?? true) && (config?.enabled ?? true))
  const maxPerHour = Number(config?.max_ai_replies_per_hour ?? 20)
  const minSecondsBetween = Number(config?.min_seconds_between_ai_replies ?? 30)
  const latestAiReplyAt = state?.last_ai_reply_at ? new Date(String(state.last_ai_reply_at)).getTime() : 0
  const elapsedSinceAi = latestAiReplyAt ? (Date.now() - latestAiReplyAt) / 1000 : Number.POSITIVE_INFINITY

  // Parse business hours from config (format "HH:mm:ss")
  const startH = Number.parseInt(String(config?.business_hours_start ?? '08').split(':')[0], 10) || 8
  const endH = Number.parseInt(String(config?.business_hours_end ?? '20').split(':')[0], 10) || 20
  
  const withinWindow = isWithinQuietHours(new Date(), startH, endH)
  const shouldAiByMode = ownerMode === 'ai' || (ownerMode === 'auto' && withinWindow)

  const aiRepliesLastHour = await countAiAutoRepliesLastHour(admin, options.rateLimitJobSources)

  const skipReasons: string[] = []
  if (!aiEnabled) skipReasons.push('ai_disabled')
  if (!options.directionIsInbound) skipReasons.push('not_inbound')
  if (!shouldAiByMode) {
    if (ownerMode === 'human') skipReasons.push('owner_mode_human')
    else if (ownerMode === 'auto' && !withinWindow) skipReasons.push('outside_quiet_hours')
    else skipReasons.push(`owner_mode_${ownerMode || 'unknown'}`)
  }
  if (elapsedSinceAi < minSecondsBetween) {
    skipReasons.push('min_seconds_between_ai_replies')
  }
  if (aiRepliesLastHour >= maxPerHour) {
    skipReasons.push('max_ai_replies_per_hour')
  }

  const canAutoReply =
    aiEnabled &&
    shouldAiByMode &&
    options.directionIsInbound &&
    elapsedSinceAi >= minSecondsBetween &&
    aiRepliesLastHour < maxPerHour

  const hintParts: string[] = []
  if (skipReasons.includes('ai_disabled')) {
    hintParts.push('IA desligada em crm_ai_configs ou neste lead (crm_conversation_states.ai_enabled).')
  }
  if (skipReasons.includes('owner_mode_human')) {
    hintParts.push('Modo de atendimento = humano: só a equipa responde.')
  }
  if (skipReasons.includes('outside_quiet_hours')) {
    hintParts.push(
      'Modo auto fora da janela 8h–20h (hora do servidor da Edge Function, normalmente UTC). Ajusta default_owner_mode para "ai" ou alarga horários no código se precisares.',
    )
  }
  if (skipReasons.includes('min_seconds_between_ai_replies')) {
    hintParts.push(
      `Aguarda ${Math.ceil(minSecondsBetween - elapsedSinceAi)}s ou reduz min_seconds_between_ai_replies em crm_ai_configs (atual mínimo ${minSecondsBetween}s entre respostas IA).`,
    )
  }
  if (skipReasons.includes('max_ai_replies_per_hour')) {
    hintParts.push(
      `Limite de ${maxPerHour} respostas IA na última hora (whatsapp + manychat). Aumenta max_ai_replies_per_hour em crm_ai_configs ou espera.`,
    )
  }

  return {
    canAutoReply,
    ownerMode,
    aiEnabled,
    skipReasons: canAutoReply ? [] : skipReasons,
    skipHint: canAutoReply ? undefined : hintParts.join(' '),
  }
}

export async function invokeCrmAiAssistantForLead(
  admin: SupabaseClient,
  leadId: string,
  aiInboundUserText: string,
  promptOverride: string,
): Promise<string> {
  const aiMessages = [{ role: 'user', content: aiInboundUserText }]
  const aiCtx = { leadId, focus: 'lead' }
  const internalSecret = (Deno.env.get('CRM_AI_INTERNAL_SECRET') ?? '').trim()
  const headers =
    internalSecret.length >= 16 ? { 'x-crm-ai-internal-secret': internalSecret } : undefined

  const { data: aiResult, error: invokeErr } = await admin.functions.invoke('crm-ai-assistant', {
    body: {
      messages: aiMessages,
      context: aiCtx,
      promptOverride: promptOverride || undefined,
    },
    ...(headers ? { headers } : {}),
  })
  if (invokeErr) {
    console.warn('invokeCrmAiAssistantForLead:', invokeErr.message)
  }
  const aiObj = (aiResult && typeof aiResult === 'object' ? aiResult : {}) as Record<string, unknown>
  let reply = typeof aiObj.reply === 'string' ? aiObj.reply.trim() : ''

  // Clean up potential leak of internal reasoning/meta-talk
  // 1. Remove numbered steps like "1. Analyze the Request:" or "1. *Analyze the Request:*"
  reply = reply.replace(/^(?:\d+\.\s+\*?Analyze[\s\S]*?)(?:\n\n|\n[A-Z\xC0-\xDF]|$)/gi, '').trim()
  // 2. Remove thinking tags
  reply = reply.replace(/<(thinking|thought|reasoning)>[\s\S]*?<\/\1>/gi, '').trim()
  // 3. Remove Markdown thinking blocks
  reply = reply.replace(/```(?:thinking|thought|reasoning)[\s\S]*?```/gi, '').trim()

  return reply
}

export async function upsertConversationStateInboundOnly(
  admin: SupabaseClient,
  options: {
    leadId: string
    ownerMode: string
    aiEnabled: boolean
    inboundHappenedAt: string
  },
): Promise<void> {
  await admin.from('crm_conversation_states').upsert({
    lead_id: options.leadId,
    owner_mode: options.ownerMode,
    ai_enabled: options.aiEnabled,
    last_inbound_at: options.inboundHappenedAt,
    updated_at: nowIso(),
  })
}

export async function runWhatsappAiAutoReply(
  admin: SupabaseClient,
  options: {
    leadId: string
    patientName: string
    fromPhone: string
    aiInboundUserText: string
    inboundHappenedAt: string
    ownerMode: string
    aiEnabled: boolean
    statePrompt: string
    aiJobSource: string
    sendProvider: WhatsappProvider
  },
): Promise<{ replied: boolean; replyText?: string }> {
  // --- Triage Logic ---
  const { data: lead } = await admin
    .from('leads')
    .select('pipeline_id, stage_id')
    .eq('id', options.leadId)
    .maybeSingle()

  if (lead) {
    const isEntry = lead.stage_id === 'novo' || lead.stage_id === 'tc-novo'
    if (isEntry) {
      const normalized = options.aiInboundUserText.trim()
      if (TRIAGE_MAPPING[normalized]) {
        const target = TRIAGE_MAPPING[normalized]
        await admin
          .from('leads')
          .update({
            pipeline_id: target.pipelineId,
            stage_id: target.stageId,
            updated_at: nowIso(),
          })
          .eq('id', options.leadId)
        
        // Lead moved. AI will now generate a response based on the NEW stage in the snapshot.
      } else {
        // Not a valid option yet. Check if we should send the initial question.
        const { data: state } = await admin
          .from('crm_conversation_states')
          .select('last_ai_reply_at')
          .eq('lead_id', options.leadId)
          .maybeSingle()

        if (!state?.last_ai_reply_at) {
          const welcome = INITIAL_TRIAGE_MESSAGE_TEMPLATE.replace('{name}', options.patientName)
          
          const sent = await options.sendProvider.sendMessage({
            to: options.fromPhone,
            text: welcome,
            leadId: options.leadId,
          })
          
          await insertInteraction(admin, {
            leadId: options.leadId,
            patientName: options.patientName,
            channel: 'whatsapp',
            direction: 'out',
            author: 'Assistente IA',
            content: welcome,
            happenedAt: nowIso(),
            externalMessageId: sent.externalMessageId,
          })

          await admin.from('crm_conversation_states').upsert({
            lead_id: options.leadId,
            owner_mode: options.ownerMode,
            ai_enabled: options.aiEnabled,
            last_inbound_at: options.inboundHappenedAt,
            last_ai_reply_at: nowIso(),
            updated_at: nowIso(),
          })

          return { replied: true, replyText: welcome }
        }
      }
    }
  }
  // --- End Triage Logic ---

  const aiReply = await invokeCrmAiAssistantForLead(
    admin,
    options.leadId,
    options.aiInboundUserText,
    options.statePrompt,
  )
  if (!aiReply) {
    await upsertConversationStateInboundOnly(admin, {
      leadId: options.leadId,
      ownerMode: options.ownerMode,
      aiEnabled: options.aiEnabled,
      inboundHappenedAt: options.inboundHappenedAt,
    })
    return { replied: false }
  }

  const sent = await options.sendProvider.sendMessage({
    to: options.fromPhone,
    text: aiReply,
    leadId: options.leadId,
  })
  await insertInteraction(admin, {
    leadId: options.leadId,
    patientName: options.patientName,
    channel: 'whatsapp',
    direction: 'out',
    author: 'Assistente IA',
    content: aiReply,
    happenedAt: nowIso(),
    externalMessageId: sent.externalMessageId,
  })
  await admin.from('crm_conversation_states').upsert({
    lead_id: options.leadId,
    owner_mode: options.ownerMode,
    ai_enabled: options.aiEnabled,
    last_inbound_at: options.inboundHappenedAt,
    last_ai_reply_at: nowIso(),
    context_summary: `${options.aiInboundUserText.slice(0, 280)}\nIA: ${aiReply.slice(0, 220)}`.slice(0, 1200),
    updated_at: nowIso(),
  })
  await admin.from('webhook_jobs').insert({
    source: options.aiJobSource,
    status: 'done',
    note: `ai_auto_reply:${sent.provider}:${sent.externalMessageId}`.slice(0, 500),
  })
  return { replied: true, replyText: aiReply }
}

export async function runManychatAiAutoReply(
  admin: SupabaseClient,
  options: {
    leadId: string
    patientName: string
    aiInboundUserText: string
    inboundHappenedAt: string
    ownerMode: string
    aiEnabled: boolean
    statePrompt: string
    aiJobSource: string
  },
): Promise<{ replied: boolean; replyText?: string; handoffSuggested?: boolean }> {
  // --- Triage Logic ---
  const { data: lead } = await admin
    .from('leads')
    .select('pipeline_id, stage_id')
    .eq('id', options.leadId)
    .maybeSingle()

  if (lead) {
    const isEntry = lead.stage_id === 'novo' || lead.stage_id === 'tc-novo'
    if (isEntry) {
      const normalized = options.aiInboundUserText.trim()
      if (TRIAGE_MAPPING[normalized]) {
        const target = TRIAGE_MAPPING[normalized]
        await admin
          .from('leads')
          .update({
            pipeline_id: target.pipelineId,
            stage_id: target.stageId,
            updated_at: nowIso(),
          })
          .eq('id', options.leadId)
        
        // Lead moved. AI will now generate a response based on the NEW stage in the snapshot.
      } else {
        // Not a valid option yet. Check if we should send the initial question.
        const { data: state } = await admin
          .from('crm_conversation_states')
          .select('last_ai_reply_at')
          .eq('lead_id', options.leadId)
          .maybeSingle()

        if (!state?.last_ai_reply_at) {
          const welcome = INITIAL_TRIAGE_MESSAGE_TEMPLATE.replace('{name}', options.patientName)
          
          await insertInteraction(admin, {
            leadId: options.leadId,
            patientName: options.patientName,
            channel: 'meta',
            direction: 'out',
            author: 'Assistente IA',
            content: welcome,
            happenedAt: nowIso(),
          })

          await admin.from('crm_conversation_states').upsert({
            lead_id: options.leadId,
            owner_mode: options.ownerMode,
            ai_enabled: options.aiEnabled,
            last_inbound_at: options.inboundHappenedAt,
            last_ai_reply_at: nowIso(),
            updated_at: nowIso(),
          })

          return { replied: true, replyText: welcome }
        }
      }
    }
  }
  // --- End Triage Logic ---

  const aiReplyRaw = await invokeCrmAiAssistantForLead(
    admin,
    options.leadId,
    options.aiInboundUserText,
    options.statePrompt,
  )
  if (!aiReplyRaw) {
    await upsertConversationStateInboundOnly(admin, {
      leadId: options.leadId,
      ownerMode: options.ownerMode,
      aiEnabled: options.aiEnabled,
      inboundHappenedAt: options.inboundHappenedAt,
    })
    return { replied: false }
  }

  const { clean: aiReply, handoffSuggested } = stripManychatHandoffMarker(aiReplyRaw)
  if (!aiReply) {
    await upsertConversationStateInboundOnly(admin, {
      leadId: options.leadId,
      ownerMode: options.ownerMode,
      aiEnabled: options.aiEnabled,
      inboundHappenedAt: options.inboundHappenedAt,
    })
    return { replied: false, handoffSuggested: handoffSuggested || false }
  }

  await insertInteraction(admin, {
    leadId: options.leadId,
    patientName: options.patientName,
    channel: 'meta',
    direction: 'out',
    author: 'Assistente IA',
    content: aiReply,
    happenedAt: nowIso(),
  })
  await admin.from('crm_conversation_states').upsert({
    lead_id: options.leadId,
    owner_mode: options.ownerMode,
    ai_enabled: options.aiEnabled,
    last_inbound_at: options.inboundHappenedAt,
    last_ai_reply_at: nowIso(),
    context_summary: `${options.aiInboundUserText.slice(0, 280)}\nIA: ${aiReply.slice(0, 220)}`.slice(0, 1200),
    updated_at: nowIso(),
  })
  await admin.from('webhook_jobs').insert({
    source: options.aiJobSource,
    status: 'done',
    note: `ai_auto_reply:manychat:${options.leadId}`.slice(0, 500),
  })
  return { replied: true, replyText: aiReply, handoffSuggested }
}
