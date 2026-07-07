import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import type { WhatsappProvider } from './types.ts'
import { getEvolutionProviderForLead, getOfficialProviderForLead } from './evolutionConfig.ts'
import { getWapiProviderForLead } from './wapiConfig.ts'

export type OutboundLeadRef = {
  id: string
  whatsapp_instance_id: string | null
  tenant_id: string
}

export type ResolvedOutboundProvider = {
  provider: WhatsappProvider
  instanceId: string | null
  /** Provider efetivo: 'wapi' | 'official' | 'evolution'. */
  channelProvider: string
}

/**
 * Escolhe o provider de ENVIO outbound de um lead de forma consistente em todo
 * o CRM (crm-send-message, crm-conversation-control, crm-nps-dispatch, ...).
 *
 * Regra: o `channel_provider` da instância vinculada ao lead manda. Quando o lead
 * NÃO tem `whatsapp_instance_id` (ex.: pedido do site cria lead 'manual' sem linha),
 * usamos a instância padrão ATIVA do PRÓPRIO tenant — nunca o default global
 * 'evolution', que mandava o Tricopill (W-API) pela linha errada / Evolution fora do
 * ar (evolution_send_failed_530). A linha resolvida é amarrada no lead para os
 * próximos envios (a menos que bindDefault === false).
 */
export async function resolveOutboundProviderForLead(
  admin: SupabaseClient,
  lead: OutboundLeadRef,
  opts?: { bindDefault?: boolean },
): Promise<ResolvedOutboundProvider> {
  let effectiveInstanceId: string | null = lead.whatsapp_instance_id
  let channelProvider: string | null = null

  if (effectiveInstanceId) {
    const { data: instRow } = await admin
      .from('whatsapp_channel_instances')
      .select('channel_provider')
      .eq('id', effectiveInstanceId)
      .maybeSingle()
    channelProvider = String(
      (instRow as { channel_provider?: string } | null)?.channel_provider ?? '',
    ).toLowerCase() || null
  } else {
    const { data: defRow } = await admin
      .from('whatsapp_channel_instances')
      .select('id, channel_provider')
      .eq('tenant_id', lead.tenant_id)
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (defRow) {
      effectiveInstanceId = String((defRow as { id: string }).id)
      channelProvider = String(
        (defRow as { channel_provider?: string }).channel_provider ?? '',
      ).toLowerCase() || null
      if (opts?.bindDefault !== false) {
        try {
          await admin.from('leads').update({ whatsapp_instance_id: effectiveInstanceId }).eq('id', lead.id)
        } catch (e) {
          console.warn('[resolveOutboundProvider] bind default instance failed:', e instanceof Error ? e.message : String(e))
        }
      }
    }
  }

  const waProvider =
    channelProvider ||
    (Deno.env.get('WHATSAPP_PROVIDER') ?? 'evolution').trim().toLowerCase()

  let provider: WhatsappProvider
  if (waProvider === 'wapi') {
    provider = await getWapiProviderForLead(admin, effectiveInstanceId)
  } else if (waProvider === 'official') {
    provider = await getOfficialProviderForLead(admin, effectiveInstanceId)
  } else {
    provider = await getEvolutionProviderForLead(admin, effectiveInstanceId)
  }

  return { provider, instanceId: effectiveInstanceId, channelProvider: waProvider }
}
