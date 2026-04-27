import { supabase } from '@/lib/supabaseClient'

import type { AppInboxItem } from '@/mocks/crmMock'

function mapRow(r: Record<string, unknown>): AppInboxItem {
  return {
    id: String(r.id),
    kind: String(r.kind ?? 'info'),
    title: String(r.title),
    body: String(r.body),
    readAt: r.read_at != null ? String(r.read_at) : null,
    createdAt: String(r.created_at ?? ''),
    metadata: (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Record<string, unknown>,
  }
}

export async function fetchInboxForCurrentUser(limit = 30): Promise<AppInboxItem[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('app_inbox_notifications')
    .select('id, kind, title, body, read_at, created_at, metadata')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export async function markInboxItemRead(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase
    .from('app_inbox_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
