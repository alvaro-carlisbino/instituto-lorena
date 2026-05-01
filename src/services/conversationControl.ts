import { supabase } from '@/lib/supabaseClient'

export type ConversationOwnerMode = 'human' | 'ai' | 'auto'

export type ConversationState = {
  lead_id: string
  owner_mode: ConversationOwnerMode
  ai_enabled: boolean
  prompt_override?: string | null
  context_summary?: string | null
  last_inbound_at?: string | null
  last_ai_reply_at?: string | null
  last_human_reply_at?: string | null
}

export type AiConfig = {
  enabled: boolean
  default_owner_mode: ConversationOwnerMode
  system_prompt: string
  max_ai_replies_per_hour: number
  min_seconds_between_ai_replies: number
  /** `HH:mm` ou `HH:mm:ss` — opcional; vindo de `crm_ai_configs` */
  business_hours_start?: string | null
  business_hours_end?: string | null
}

async function invokeControl(body: Record<string, unknown>) {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.functions.invoke('crm-conversation-control', { body })
  if (error) throw new Error(error.message || 'Falha ao conectar com controle de conversa.')
  const parsed = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (parsed.ok !== true) throw new Error(String(parsed.error ?? 'Falha na operação.'))
  return parsed
}

export async function getConversationState(leadId: string): Promise<ConversationState> {
  const parsed = await invokeControl({ action: 'get_state', leadId })
  return parsed.state as ConversationState
}

export async function setConversationMode(leadId: string, ownerMode: ConversationOwnerMode): Promise<ConversationState> {
  const parsed = await invokeControl({ action: 'set_mode', leadId, ownerMode })
  return parsed.state as ConversationState
}

export async function getAiConfig(): Promise<AiConfig | null> {
  const parsed = await invokeControl({ action: 'get_config' })
  return (parsed.config ?? null) as AiConfig | null
}

export type ForceAiReplyResult = {
  ok: true
  replied: boolean
  channel?: string
  error?: string
  message?: string
  replyPreview?: string | null
  handoffSuggested?: boolean
  manychat_push?: Record<string, unknown>
}

/** Reenvia resposta da IA com base na última mensagem de entrada (WhatsApp ou Meta). */
export async function forceAiReply(leadId: string): Promise<ForceAiReplyResult> {
  const parsed = await invokeControl({ action: 'force_ai_reply', leadId })
  return parsed as ForceAiReplyResult
}

export async function saveAiConfig(payload: {
  enabled: boolean
  defaultOwnerMode: ConversationOwnerMode
  systemPrompt: string
  maxAiRepliesPerHour: number
  minSecondsBetweenAiReplies: number
}): Promise<AiConfig> {
  const parsed = await invokeControl({
    action: 'set_config',
    enabled: payload.enabled,
    defaultOwnerMode: payload.defaultOwnerMode,
    systemPrompt: payload.systemPrompt,
    maxAiRepliesPerHour: payload.maxAiRepliesPerHour,
    minSecondsBetweenAiReplies: payload.minSecondsBetweenAiReplies,
  })
  return parsed.config as AiConfig
}

