import { supabase } from '@/lib/supabaseClient'

export type WaOnLineChange = 'keep_stage' | 'use_entry'

export type ChannelProvider = 'evolution' | 'manychat' | 'wapi'

export type WhatsappChannelInstance = {
  id: string
  label: string
  channelProvider: ChannelProvider
  evolutionInstanceName: string | null
  manychatInstanceKey: string | null
  wapiInstanceId: string | null
  wapiToken: string | null
  wapiBaseUrl: string | null
  wapiWebhookSecret: string | null
  aiSystemPrompt: string
  phoneE164: string | null
  active: boolean
  sortOrder: number
  entryPipelineId: string | null
  entryStageId: string | null
  defaultOwnerId: string | null
  onLineChange: WaOnLineChange
}

function strOrNull(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s ? s : null
}

function mapRow(r: Record<string, unknown>): WhatsappChannelInstance {
  const o = String(r.on_line_change ?? 'keep_stage')
  const onLine: WaOnLineChange = o === 'use_entry' ? 'use_entry' : 'keep_stage'
  const cp = String(r.channel_provider ?? 'evolution').toLowerCase()
  const channelProvider: ChannelProvider =
    cp === 'manychat' ? 'manychat' : cp === 'wapi' ? 'wapi' : 'evolution'
  return {
    id: String(r.id),
    label: String(r.label),
    channelProvider,
    evolutionInstanceName: strOrNull(r.evolution_instance_name),
    manychatInstanceKey: strOrNull(r.manychat_instance_key),
    wapiInstanceId: strOrNull(r.wapi_instance_id),
    wapiToken: strOrNull(r.wapi_token),
    wapiBaseUrl: strOrNull(r.wapi_base_url),
    wapiWebhookSecret: strOrNull(r.wapi_webhook_secret),
    aiSystemPrompt: String(r.ai_system_prompt ?? ''),
    phoneE164: strOrNull(r.phone_e164),
    active: r.active !== false,
    sortOrder: typeof r.sort_order === 'number' ? r.sort_order : Number(r.sort_order) || 0,
    entryPipelineId: strOrNull(r.entry_pipeline_id),
    entryStageId: strOrNull(r.entry_stage_id),
    defaultOwnerId: strOrNull(r.default_owner_id),
    onLineChange: onLine,
  }
}

const SELECT_COLS =
  'id, label, channel_provider, evolution_instance_name, manychat_instance_key, wapi_instance_id, wapi_token, wapi_base_url, wapi_webhook_secret, ai_system_prompt, phone_e164, active, sort_order, entry_pipeline_id, entry_stage_id, default_owner_id, on_line_change'

export async function fetchWhatsappChannelInstances(): Promise<WhatsappChannelInstance[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('whatsapp_channel_instances')
    .select(SELECT_COLS)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export async function upsertWhatsappChannelInstance(row: {
  id: string
  label: string
  channelProvider?: ChannelProvider
  evolutionInstanceName?: string | null
  manychatInstanceKey?: string | null
  wapiInstanceId?: string | null
  wapiToken?: string | null
  wapiBaseUrl?: string | null
  wapiWebhookSecret?: string | null
  aiSystemPrompt?: string
  phoneE164?: string | null
  active?: boolean
  sortOrder?: number
  entryPipelineId?: string | null
  entryStageId?: string | null
  defaultOwnerId?: string | null
  onLineChange?: WaOnLineChange
}): Promise<void> {
  if (!supabase) throw new Error('Não configurado')
  const channelProvider = row.channelProvider ?? 'evolution'
  // Mantém só credenciais do provider escolhido — evita lixo cruzado em linhas que
  // já tinham campos preenchidos (ex.: linha convertida de manychat pra wapi).
  const evo =
    channelProvider === 'evolution'
      ? (row.evolutionInstanceName != null && String(row.evolutionInstanceName).trim()
          ? String(row.evolutionInstanceName).trim()
          : null)
      : null
  const mcKey =
    channelProvider === 'manychat' && row.manychatInstanceKey != null && String(row.manychatInstanceKey).trim()
      ? String(row.manychatInstanceKey).trim()
      : null
  const wapiId =
    channelProvider === 'wapi' && row.wapiInstanceId != null && String(row.wapiInstanceId).trim()
      ? String(row.wapiInstanceId).trim()
      : null
  const wapiToken =
    channelProvider === 'wapi' && row.wapiToken != null && String(row.wapiToken).trim()
      ? String(row.wapiToken).trim()
      : null
  const wapiBaseUrl =
    channelProvider === 'wapi' && row.wapiBaseUrl != null && String(row.wapiBaseUrl).trim()
      ? String(row.wapiBaseUrl).trim()
      : null
  const wapiSecret =
    channelProvider === 'wapi' && row.wapiWebhookSecret != null && String(row.wapiWebhookSecret).trim()
      ? String(row.wapiWebhookSecret).trim()
      : null
  const { error } = await supabase.from('whatsapp_channel_instances').upsert({
    id: row.id,
    label: row.label,
    channel_provider: channelProvider,
    evolution_instance_name: evo,
    manychat_instance_key: mcKey,
    wapi_instance_id: wapiId,
    wapi_token: wapiToken,
    wapi_base_url: wapiBaseUrl,
    wapi_webhook_secret: wapiSecret,
    ai_system_prompt: row.aiSystemPrompt ?? '',
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

