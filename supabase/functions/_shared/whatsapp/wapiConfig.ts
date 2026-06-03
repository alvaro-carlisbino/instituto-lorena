import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { WapiProvider } from './wapi.ts'
import type { WhatsappProvider } from './types.ts'

export type WapiInstanceRow = {
  id: string
  wapi_instance_id: string
  wapi_token: string
  wapi_base_url: string | null
  wapi_webhook_secret: string | null
  tenant_id: string | null
}

const SELECT_COLS =
  'id, wapi_instance_id, wapi_token, wapi_base_url, wapi_webhook_secret, tenant_id, channel_provider, active'

function rowToWapi(data: Record<string, unknown>): WapiInstanceRow | null {
  const wapiInstanceId = String(data.wapi_instance_id ?? '').trim()
  const token = String(data.wapi_token ?? '').trim()
  if (!wapiInstanceId || !token) return null
  return {
    id: String(data.id),
    wapi_instance_id: wapiInstanceId,
    wapi_token: token,
    wapi_base_url: (data.wapi_base_url as string | null) ?? null,
    wapi_webhook_secret: (data.wapi_webhook_secret as string | null) ?? null,
    tenant_id: (data.tenant_id as string | null) ?? null,
  }
}

/**
 * Lookup pelo id da instância no painel da W-API. Usado pelo webhook entrante
 * pra descobrir tenant + token de envio.
 */
export async function loadWhatsappInstanceByWapiId(
  admin: SupabaseClient,
  wapiInstanceId: string,
): Promise<WapiInstanceRow | null> {
  const id = wapiInstanceId.trim()
  if (!id) return null
  const { data, error } = await admin
    .from('whatsapp_channel_instances')
    .select(SELECT_COLS)
    .eq('wapi_instance_id', id)
    .eq('channel_provider', 'wapi')
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return rowToWapi(data as Record<string, unknown>)
}

/**
 * Carrega a linha W-API associada ao id do row em whatsapp_channel_instances
 * (caminho usado pelo crm-send-message quando o lead já tem whatsapp_instance_id).
 */
export async function loadWapiInstanceByRowId(
  admin: SupabaseClient,
  rowId: string,
): Promise<WapiInstanceRow | null> {
  const id = rowId.trim()
  if (!id) return null
  const { data, error } = await admin
    .from('whatsapp_channel_instances')
    .select(SELECT_COLS)
    .eq('id', id)
    .eq('channel_provider', 'wapi')
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return rowToWapi(data as Record<string, unknown>)
}

export function createWapiProviderForRow(row: WapiInstanceRow): WhatsappProvider {
  return new WapiProvider({
    baseUrl: (row.wapi_base_url ?? '').trim(),
    token: row.wapi_token,
    instanceId: row.wapi_instance_id,
    webhookSecret: (row.wapi_webhook_secret ?? '').trim(),
  })
}

/**
 * Provider W-API para envio outbound a partir de `leads.whatsapp_instance_id`.
 * Diferente do Evolution, não há fallback "instância default da env" — se a linha
 * não existir ou não tiver credenciais válidas, lança erro pra fail-fast.
 */
export async function getWapiProviderForLead(
  admin: SupabaseClient,
  leadWhatsappInstanceId: string | null,
): Promise<WhatsappProvider> {
  if (!leadWhatsappInstanceId) throw new Error('wapi_requires_instance_id')
  const row = await loadWapiInstanceByRowId(admin, leadWhatsappInstanceId)
  if (!row) throw new Error('wapi_instance_not_found_or_inactive')
  return createWapiProviderForRow(row)
}
