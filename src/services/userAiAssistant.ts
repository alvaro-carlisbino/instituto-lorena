import { supabase } from '@/lib/supabaseClient'

export type UserAiChatRole = 'user' | 'assistant'

export type UserAiChatMessage = {
  role: UserAiChatRole
  content: string
}

export const GLM_MODEL_OPTIONS = [
  { value: 'glm-4.7', label: 'GLM-4.7' },
  { value: 'glm-5.1', label: 'GLM-5.1' },
  { value: 'glm-4.6', label: 'GLM-4.6' },
  { value: 'glm-4.5', label: 'GLM-4.5' },
  { value: 'glm-4.5-air', label: 'GLM-4.5 Air' },
  { value: 'glm-4-flash', label: 'GLM-4 Flash' },
  { value: 'glm-4-plus', label: 'GLM-4 Plus' },
] as const

export type GlmModelId = (typeof GLM_MODEL_OPTIONS)[number]['value']

export type UserAiAssistantResult =
  | { ok: true; reply: string; model: string }
  | { ok: false; error: string; detail?: string }

/**
 * Chama a Edge Function `user-ai-assistant`, que usa a API Z.ai (GLM) com a chave em segredo no Supabase.
 */
export async function invokeUserAiAssistant(params: {
  messages: UserAiChatMessage[]
  model: GlmModelId
}): Promise<UserAiAssistantResult> {
  if (!supabase) {
    return { ok: false, error: 'Supabase não configurado.' }
  }

  const { data, error } = await supabase.functions.invoke('user-ai-assistant', {
    body: { messages: params.messages, model: params.model },
  })

  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : null

  if (payload && 'error' in payload) {
    return {
      ok: false,
      error: String(payload.error ?? 'Erro no servidor'),
      detail: typeof payload.message === 'string' ? payload.message : undefined,
    }
  }

  if (error) {
    return {
      ok: false,
      error: error.message || 'Falha ao chamar o assistente.',
      detail: typeof payload?.message === 'string' ? payload.message : undefined,
    }
  }

  if (data && typeof data === 'object' && 'reply' in data) {
    const d = data as { reply?: string; model?: string }
    const reply = String(d.reply ?? '').trim()
    if (!reply) return { ok: false, error: 'Resposta vazia do modelo.' }
    return { ok: true, reply, model: String(d.model ?? params.model) }
  }

  return { ok: false, error: 'Resposta inesperada do servidor.' }
}
