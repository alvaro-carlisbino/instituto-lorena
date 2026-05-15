import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const INSTANCE_KEY_RE = /^[a-zA-Z0-9_-]{1,128}$/

export function sanitizeCrmInstanceKey(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  if (!s || s.length > 128) return null
  if (!INSTANCE_KEY_RE.test(s)) return null
  return s
}

export async function resolveWhatsappLineInstanceId(
  admin: SupabaseClient,
  key: string,
): Promise<string | null> {
  const { data: byId } = await admin
    .from('whatsapp_channel_instances')
    .select('id')
    .eq('id', key)
    .maybeSingle()
  if (byId && typeof (byId as { id?: string }).id === 'string') {
    return String((byId as { id: string }).id)
  }

  const { data: byMc } = await admin
    .from('whatsapp_channel_instances')
    .select('id')
    .eq('manychat_instance_key', key)
    .eq('channel_provider', 'manychat')
    .maybeSingle()

  if (byMc && typeof (byMc as { id?: string }).id === 'string') {
    return String((byMc as { id: string }).id)
  }

  return null
}
