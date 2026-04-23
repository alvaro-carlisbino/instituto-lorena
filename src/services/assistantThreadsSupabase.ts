import { supabase } from '@/lib/supabaseClient'

import type { CrmAiAssistantContext } from '@/services/crmAiAssistant'

export type AssistantThreadRow = {
  id: string
  title: string
  context: Record<string, unknown>
  model: string | null
  created_at: string
  updated_at: string
}

export type AssistantMessageRow = {
  id: string
  thread_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

function contextToJson(ctx: CrmAiAssistantContext): Record<string, unknown> {
  return {
    leadId: ctx.leadId ?? null,
    weekStartIso: ctx.weekStartIso ?? null,
    focus: ctx.focus ?? null,
  }
}

export async function listAssistantThreads(limit = 50): Promise<AssistantThreadRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('crm_assistant_threads')
    .select('id, title, context, model, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.warn('listAssistantThreads', error.message)
    return []
  }
  return (data ?? []) as AssistantThreadRow[]
}

export async function listAssistantMessages(threadId: string): Promise<AssistantMessageRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('crm_assistant_messages')
    .select('id, thread_id, role, content, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  if (error) {
    console.warn('listAssistantMessages', error.message)
    return []
  }
  return (data ?? []) as AssistantMessageRow[]
}

export async function insertAssistantThread(params: {
  title: string
  context: CrmAiAssistantContext
  model: string
}): Promise<string | null> {
  if (!supabase) return null
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('crm_assistant_threads')
    .insert({
      auth_user_id: user.id,
      title: params.title.slice(0, 200),
      context: contextToJson(params.context),
      model: params.model,
    })
    .select('id')
    .single()

  if (error || !data?.id) {
    console.warn('insertAssistantThread', error?.message)
    return null
  }
  return data.id as string
}

export async function insertAssistantMessage(
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('crm_assistant_messages').insert({
    thread_id: threadId,
    role,
    content: content.slice(0, 120_000),
  })
  if (error) {
    console.warn('insertAssistantMessage', error.message)
    return false
  }
  return true
}

export async function touchAssistantThread(
  threadId: string,
  updates: { title?: string; context?: CrmAiAssistantContext; model?: string },
): Promise<void> {
  if (!supabase) return
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (updates.title != null) row.title = updates.title.slice(0, 200)
  if (updates.context != null) row.context = contextToJson(updates.context)
  if (updates.model != null) row.model = updates.model
  const { error } = await supabase.from('crm_assistant_threads').update(row).eq('id', threadId)
  if (error) console.warn('touchAssistantThread', error.message)
}

export async function deleteAssistantThread(threadId: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('crm_assistant_threads').delete().eq('id', threadId)
  if (error) {
    console.warn('deleteAssistantThread', error.message)
    return false
  }
  return true
}
