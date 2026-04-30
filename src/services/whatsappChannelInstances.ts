import { supabase } from '@/lib/supabaseClient'

export type WaOnLineChange = 'keep_stage' | 'use_entry'

export type WhatsappChannelInstance = {
  id: string
  label: string
  evolutionInstanceName: string
  phoneE164: string | null
  active: boolean
  sortOrder: number
  entryPipelineId: string | null
  entryStageId: string | null
  defaultOwnerId: string | null
  onLineChange: WaOnLineChange
}

function mapRow(r: Record<string, unknown>): WhatsappChannelInstance {
  const o = String(r.on_line_change ?? 'keep_stage')
  const onLine: WaOnLineChange = o === 'use_entry' ? 'use_entry' : 'keep_stage'
  return {
    id: String(r.id),
    label: String(r.label),
    evolutionInstanceName: String(r.evolution_instance_name),
    phoneE164: r.phone_e164 != null && String(r.phone_e164) ? String(r.phone_e164) : null,
    active: r.active !== false,
    sortOrder: typeof r.sort_order === 'number' ? r.sort_order : Number(r.sort_order) || 0,
    entryPipelineId: r.entry_pipeline_id != null && String(r.entry_pipeline_id) ? String(r.entry_pipeline_id) : null,
    entryStageId: r.entry_stage_id != null && String(r.entry_stage_id) ? String(r.entry_stage_id) : null,
    defaultOwnerId: r.default_owner_id != null && String(r.default_owner_id) ? String(r.default_owner_id) : null,
    onLineChange: onLine,
  }
}

export async function fetchWhatsappChannelInstances(): Promise<WhatsappChannelInstance[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('whatsapp_channel_instances')
    .select(
      'id, label, evolution_instance_name, phone_e164, active, sort_order, entry_pipeline_id, entry_stage_id, default_owner_id, on_line_change',
    )
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
  entryPipelineId?: string | null
  entryStageId?: string | null
  defaultOwnerId?: string | null
  onLineChange?: WaOnLineChange
}): Promise<void> {
  if (!supabase) throw new Error('Não configurado')
  const { error } = await supabase.from('whatsapp_channel_instances').upsert({
    id: row.id,
    label: row.label,
    evolution_instance_name: row.evolutionInstanceName,
    phone_e164: row.phoneE164 ?? null,
    active: row.active !== false,
    sort_order: row.sortOrder ?? 0,
    entry_pipeline_id: row.entryPipelineId ?? null,
    entry_stage_id: row.entryStageId ?? null,
    default_owner_id: row.defaultOwnerId ?? null,
    on_line_change: row.onLineChange ?? 'keep_stage',
  })
  if (error) throw new Error(error.message)
}

export async function deleteWhatsappChannelInstance(id: string): Promise<void> {
  if (!supabase) throw new Error('Não configurado')
  const { error } = await supabase.from('whatsapp_channel_instances').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export type ConfigureWebhookResult = {
  ok: boolean
  message: string
  webhookUrl?: string
}

/**
 * Calls Evolution API via the edge function to register the Supabase
 * webhook URL on the given instance. Requires admin role.
 */
export async function configureEvolutionWebhook(instanceId: string): Promise<ConfigureWebhookResult> {
  if (!supabase) return { ok: false, message: 'Supabase não configurado.' }
  const { data, error } = await supabase.functions.invoke('crm-evolution-connection', {
    body: { action: 'configure_webhook', instanceId },
  })
  const p = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  if (error && !('ok' in p)) {
    return { ok: false, message: String(error.message || 'Erro ao configurar webhook.') }
  }
  return {
    ok: p.ok === true,
    message: String(p.message || (p.ok ? 'Webhook configurado.' : 'Falha na configuração.')),
    webhookUrl: typeof p.webhook_url === 'string' ? p.webhook_url : undefined,
  }
}

