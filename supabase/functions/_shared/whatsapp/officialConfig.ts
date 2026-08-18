import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { OfficialWhatsappProvider } from './official.ts'

/**
 * Credenciais da linha na API oficial da Meta (Cloud API), lidas de
 * `whatsapp_channel_instances`. Espelha `wapiConfig.ts`.
 *
 * Token e app secret vazios caem no env global (`WHATSAPP_CLOUD_*`) — o que só é seguro
 * enquanto existir UMA WABA. Assim que a segunda linha oficial existir, preencher na linha:
 * senão a saída de um polo usa a WABA do outro. Ver [[feedback_polo_nao_mistura_nem_na_tela]].
 */
export type OfficialLineRow = {
  id: string
  tenant_id: string | null
  bot_kind: string | null
  meta_phone_number_id: string
  meta_waba_id: string
  meta_access_token: string
  meta_app_secret: string
}

const SELECT_COLS =
  'id, tenant_id, bot_kind, meta_phone_number_id, meta_waba_id, meta_access_token, meta_app_secret, channel_provider, active'

function rowToOfficial(data: Record<string, unknown>): OfficialLineRow | null {
  const phoneNumberId = String(data.meta_phone_number_id ?? '').trim()
  if (!phoneNumberId) return null
  return {
    id: String(data.id),
    tenant_id: (data.tenant_id as string | null) ?? null,
    bot_kind: (data.bot_kind as string | null) ?? null,
    meta_phone_number_id: phoneNumberId,
    meta_waba_id: String(data.meta_waba_id ?? '').trim(),
    meta_access_token: String(data.meta_access_token ?? '').trim(),
    meta_app_secret: String(data.meta_app_secret ?? '').trim(),
  }
}

export function createOfficialProviderForRow(row: OfficialLineRow): OfficialWhatsappProvider {
  return new OfficialWhatsappProvider({
    phoneNumberId: row.meta_phone_number_id,
    accessToken: row.meta_access_token,
    appSecret: row.meta_app_secret,
    wabaId: row.meta_waba_id,
  })
}

/**
 * IDENTIDADE DA LINHA DE ENTRADA — de propósito NÃO filtra por `active`.
 *
 * O webhook da Meta só carrega `metadata.phone_number_id`; é o único jeito de saber por
 * onde a mensagem entrou. Desativar a linha no painel decide por onde as respostas SAEM
 * (`resolveOutboundProviderForLead`), não apaga de quem é a conversa que está chegando.
 * Mesmo raciocínio de `loadWhatsappInstanceByEvolutionName`.
 */
export async function loadOfficialLineByPhoneNumberId(
  admin: SupabaseClient,
  metaPhoneNumberId: string,
): Promise<OfficialLineRow | null> {
  const id = String(metaPhoneNumberId ?? '').trim()
  if (!id) return null
  const { data, error } = await admin
    .from('whatsapp_channel_instances')
    .select(SELECT_COLS)
    .eq('meta_phone_number_id', id)
    .eq('channel_provider', 'official')
    .maybeSingle()
  if (error || !data) return null
  return rowToOfficial(data as Record<string, unknown>)
}

export async function loadOfficialLineByRowId(
  admin: SupabaseClient,
  rowId: string,
): Promise<OfficialLineRow | null> {
  const id = String(rowId ?? '').trim()
  if (!id) return null
  const { data, error } = await admin
    .from('whatsapp_channel_instances')
    .select(SELECT_COLS)
    .eq('id', id)
    .eq('channel_provider', 'official')
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return rowToOfficial(data as Record<string, unknown>)
}

/**
 * Provider oficial para envio outbound a partir de `leads.whatsapp_instance_id`.
 *
 * Cai no env global quando a linha não existe ou não tem `meta_phone_number_id` — é o
 * comportamento que já existia antes de a credencial virar por linha, e mantém de pé o
 * caminho de quem configurou só por variável de ambiente.
 */
export async function getOfficialProviderForLead(
  admin: SupabaseClient,
  leadWhatsappInstanceId: string | null,
  tenantId?: string | null,
): Promise<OfficialWhatsappProvider> {
  if (leadWhatsappInstanceId) {
    const row = await loadOfficialLineByRowId(admin, leadWhatsappInstanceId)
    if (row) return createOfficialProviderForRow(row)
  }
  if (tenantId) {
    const { data } = await admin
      .from('whatsapp_channel_instances')
      .select(SELECT_COLS)
      .eq('tenant_id', tenantId)
      .eq('channel_provider', 'official')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    const row = data ? rowToOfficial(data as Record<string, unknown>) : null
    if (row) return createOfficialProviderForRow(row)
  }
  return new OfficialWhatsappProvider()
}
