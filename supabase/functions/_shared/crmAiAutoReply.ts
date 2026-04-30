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
  const maxPerHour = Number(config?.max_ai_replies_per_hour ?? 2)
  const minSecondsBetween = Number(config?.min_seconds_between_ai_replies ?? 240)
  const latestAiReplyAt = state?.last_ai_reply_at ? new Date(String(state.last_ai_reply_at)).getTime() : 0
  const elapsedSinceAi = latestAiReplyAt ? (Date.now() - latestAiReplyAt) / 1000 : Number.POSITIVE_INFINITY
  const withinWindow = isWithinQuietHours(new Date(), 8, 20)
  const shouldAiByMode = ownerMode === 'ai' || (ownerMode === 'auto' && withinWindow)

  const aiRepliesLastHour = await countAiAutoRepliesLastHour(admin, options.rateLimitJobSources)

  const canAutoReply =
    aiEnabled &&
    shouldAiByMode &&
    options.directionIsInbound &&
    elapsedSinceAi >= minSecondsBetween &&
    aiRepliesLastHour < maxPerHour

  return { canAutoReply, ownerMode, aiEnabled }
}

export async function invokeCrmAiAssistantForLead(
  admin: SupabaseClient,
  leadId: string,
  aiInboundUserText: string,
  promptOverride: string,
): Promise<string> {
  const aiMessages = [{ role: 'user', content: aiInboundUserText }]
  const aiCtx = { leadId, focus: 'lead' }
  const { data: aiResult } = await admin.functions.invoke('crm-ai-assistant', {
    body: {
      messages: aiMessages,
      context: aiCtx,
      promptOverride: promptOverride || undefined,
    },
  })
  const aiObj = (aiResult && typeof aiResult === 'object' ? aiResult : {}) as Record<string, unknown>
  return typeof aiObj.reply === 'string' ? aiObj.reply.trim() : ''
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
