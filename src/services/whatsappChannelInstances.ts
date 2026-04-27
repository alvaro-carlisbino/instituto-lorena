import { supabase } from '@/lib/supabaseClient'

export type WhatsappChannelInstance = {
  id: string
  label: string
  evolutionInstanceName: string
  phoneE164: string | null
  active: boolean
  sortOrder: number
}

function mapRow(r: Record<string, unknown>): WhatsappChannelInstance {
  return {
    id: String(r.id),
    label: String(r.label),
    evolutionInstanceName: String(r.evolution_instance_name),
    phoneE164: r.phone_e164 != null && String(r.phone_e164) ? String(r.phone_e164) : null,
    active: r.active !== false,
    sortOrder: typeof r.sort_order === 'number' ? r.sort_order : Number(r.sort_order) || 0,
  }
}

export async function fetchWhatsappChannelInstances(): Promise<WhatsappChannelInstance[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('whatsapp_channel_instances')
    .select('id, label, evolution_instance_name, phone_e164, active, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export async function upsertWhatsappChannelInstance(row: {
  id: string
  label: string
  evolutionInstanceName: string
  phoneE164?: string | null
  active?: boolean
  sortOrder?: number
}): Promise<void> {
  if (!supabase) throw new Error('Não configurado')
  const { error } = await supabase.from('whatsapp_channel_instances').upsert({
    id: row.id,
    label: row.label,
    evolution_instance_name: row.evolutionInstanceName,
    phone_e164: row.phoneE164 ?? null,
    active: row.active !== false,
    sort_order: row.sortOrder ?? 0,
  })
  if (error) throw new Error(error.message)
}

export async function deleteWhatsappChannelInstance(id: string): Promise<void> {
  if (!supabase) throw new Error('Não configurado')
  const { error } = await supabase.from('whatsapp_channel_instances').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
