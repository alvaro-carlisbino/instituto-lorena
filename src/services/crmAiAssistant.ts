import { FunctionsHttpError } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabaseClient'

/** Rota da página do assistente (navegação e paleta ⌘K). */
export const CRM_ASSISTANT_PATH = '/assistente'

export type CrmAiChatRole = 'user' | 'assistant'

export type CrmAiChatMessage = {
  role: CrmAiChatRole
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

export type CrmAiAssistantFocus = 'analytics' | 'lead' | 'general'

export type CrmAiAssistantContext = {
  leadId?: string
  weekStartIso?: string
  focus?: CrmAiAssistantFocus
}

export type CrmAiAssistantResult =
  | { ok: true; reply: string; model: string }
  | { ok: false; error: string; detail?: string }

function detailFromPayload(p: Record<string, unknown>): string | undefined {
  const parts: string[] = []
  if (typeof p.message === 'string' && p.message.trim()) parts.push(p.message.trim())
  if (typeof p.hint === 'string' && p.hint.trim()) parts.push(p.hint.trim())
  return parts.length ? parts.join('\n\n') : undefined
}

/**
 * Edge Function `crm-ai-assistant`: snapshot CRM via RLS (JWT) + GLM (Z.ai), secret ZAI_API_KEY.
 */
export async function invokeCrmAiAssistant(params: {
  messages: CrmAiChatMessage[]
  model: GlmModelId
  context?: CrmAiAssistantContext
}): Promise<CrmAiAssistantResult> {
  if (!supabase) {
    return { ok: false, error: 'Supabase não configurado.' }
  }

  const { data, error } = await supabase.functions.invoke('crm-ai-assistant', {
    body: {
      messages: params.messages,
      model: params.model,
      context: params.context ?? {},
    },
  })

  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : null

  /** Corpo JSON quando a função devolve 4xx/5xx (invoke coloca em `error.context`). */
  async function jsonFromHttpError(err: unknown): Promise<Record<string, unknown> | null> {
    if (!(err instanceof FunctionsHttpError)) return null
    try {
      const j = await err.context.clone().json()
      return j && typeof j === 'object' ? (j as Record<string, unknown>) : null
    } catch {
      try {
        const t = await err.context.clone().text()
        return t ? { message: t } : null
      } catch {
        return null
      }
    }
  }

  if (payload?.ok === false) {
    return {
      ok: false,
      error: String(payload.error ?? 'Erro no servidor'),
      detail: detailFromPayload(payload),
    }
  }

  if (payload && 'error' in payload && payload.ok !== true) {
    return {
      ok: false,
      error: String(payload.error ?? 'Erro no servidor'),
      detail: detailFromPayload(payload),
    }
  }

  if (error) {
    const fromBody = await jsonFromHttpError(error)
    let detail: string | undefined
    if (fromBody) {
      detail = detailFromPayload(fromBody)
      if (!detail && typeof fromBody.error === 'string') detail = fromBody.error
    }
    return {
      ok: false,
      error: error.message || 'Falha ao chamar o assistente.',
      detail,
    }
  }

  if (payload?.ok === true && typeof payload.reply === 'string') {
    const reply = payload.reply.trim()
    if (!reply) return { ok: false, error: 'Resposta vazia do modelo.' }
    return { ok: true, reply, model: String(payload.model ?? params.model) }
  }

  if (data && typeof data === 'object' && 'reply' in data) {
    const d = data as { reply?: string; model?: string }
    const reply = String(d.reply ?? '').trim()
    if (!reply) return { ok: false, error: 'Resposta vazia do modelo.' }
    return { ok: true, reply, model: String(d.model ?? params.model) }
  }

  return { ok: false, error: 'Resposta inesperada do servidor.' }
}
