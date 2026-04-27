import { isSameLocalDayInTimezone } from '@/lib/sameLocalDayInTimezone'
import { supabase } from '@/lib/supabaseClient'

export type LeadWaLineEvent = {
  id: string
  fromInstanceId: string | null
  toInstanceId: string
  createdAt: string
}

function mapRow(r: Record<string, unknown>): LeadWaLineEvent {
  return {
    id: String(r.id),
    fromInstanceId:
      r.from_instance_id != null && String(r.from_instance_id) ? String(r.from_instance_id) : null,
    toInstanceId: String(r.to_instance_id),
    createdAt: String(r.created_at),
  }
}

export async function fetchLeadWaLineEvents(leadId: string): Promise<LeadWaLineEvent[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('lead_wa_line_events')
    .select('id, from_instance_id, to_instance_id, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export async function fetchHandoffEventCountForTodayInTimezone(
  timeZone: string,
  nowRef: Date = new Date(),
): Promise<number> {
  if (!supabase) return 0
  const start = new Date(nowRef)
  start.setDate(start.getDate() - 1)
  const { data, error } = await supabase
    .from('lead_wa_line_events')
    .select('id, created_at')
    .gte('created_at', start.toISOString())
    .limit(500)
  if (error) return 0
  return (data ?? []).filter((r) => isSameLocalDayInTimezone(String((r as { created_at: string }).created_at), timeZone, nowRef))
    .length
}
