import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import type { WhatsappProvider } from './types.ts'
import { getEvolutionProviderForLead } from './evolutionConfig.ts'
import { getOfficialProviderForLead } from './officialConfig.ts'
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
  /** 'clinic' | 'sales' — o polo da linha que vai sair. */
  botKind: string | null
  /** Linha do outro polo foi ignorada; o id descartado fica aqui para auditoria. */
  crossTenantInstanceIgnored: string | null
  /** Linha desativada no painel foi ignorada; o id descartado fica aqui para auditoria. */
  inactiveInstanceIgnored: string | null
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
 *
 * GUARDA DE LINHA DESLIGADA: a linha vinculada ao lead só vale se estiver `active`.
 * Antes, desativar a instância no painel só afetava quem NÃO tinha vínculo — o filtro
 * `active` existia apenas na escolha do padrão. Quem já estava fixado continuava saindo
 * por ela. Foi o caso da linha "SDR" (Evolution): morta há 45 dias, devolvendo 530, e
 * ainda assim era o `sort_order = 0` do tenant e o vínculo de 88 leads da clínica.
 * Desligar a linha no painel agora TIRA ela do ar de verdade, para os dois casos.
 *
 * GUARDA DE POLO: a linha vinculada ao lead só vale se for do MESMO tenant do lead.
 * Quem é paciente da clínica E cliente do Tricopill acaba com `whatsapp_instance_id`
 * apontando para a linha de vendas (foi por lá que a pessoa escreveu por último), e em
 * 11/ago/26 dois lembretes de cirurgia saíram nessa conversa. A pessoa segue o polo, a
 * conversa segue a linha: linha do outro polo é descartada aqui, e o envio cai na linha
 * do próprio tenant. Ver [[crm_conversa_segue_a_linha]].
 */
export async function resolveOutboundProviderForLead(
  admin: SupabaseClient,
  lead: OutboundLeadRef,
  opts?: { bindDefault?: boolean },
): Promise<ResolvedOutboundProvider> {
  let effectiveInstanceId: string | null = lead.whatsapp_instance_id
  let channelProvider: string | null = null
  let botKind: string | null = null
  let crossTenantInstanceIgnored: string | null = null
  let inactiveInstanceIgnored: string | null = null

  if (effectiveInstanceId) {
    const { data: instRow } = await admin
      .from('whatsapp_channel_instances')
      .select('channel_provider, tenant_id, bot_kind, active')
      .eq('id', effectiveInstanceId)
      .maybeSingle()
    const inst = instRow as
      | { channel_provider?: string; tenant_id?: string; bot_kind?: string; active?: boolean }
      | null
    if (inst && lead.tenant_id && inst.tenant_id && inst.tenant_id !== lead.tenant_id) {
      // Linha do outro polo. Não sai por aqui: cai no default do próprio tenant.
      crossTenantInstanceIgnored = effectiveInstanceId
      console.warn(
        `[resolveOutboundProvider] linha de outro polo ignorada: lead ${lead.id} (${lead.tenant_id}) apontava para ${effectiveInstanceId} (${inst.tenant_id})`,
      )
      effectiveInstanceId = null
    } else if (inst && inst.active === false) {
      // Desligar a linha no painel tem que TIRAR ela do ar. Sem isso, desativar a
      // instância não adiantava nada para os leads já fixados nela: o vínculo antigo
      // continuava mandando (é o caso dos 88 leads presos na linha SDR morta).
      inactiveInstanceIgnored = effectiveInstanceId
      console.warn(
        `[resolveOutboundProvider] linha inativa ignorada: lead ${lead.id} apontava para ${effectiveInstanceId}`,
      )
      effectiveInstanceId = null
    } else {
      channelProvider = String(inst?.channel_provider ?? '').toLowerCase() || null
      botKind = String(inst?.bot_kind ?? '').toLowerCase() || null
    }
  }

  if (!effectiveInstanceId) {
    const { data: defRow } = await admin
      .from('whatsapp_channel_instances')
      .select('id, channel_provider, bot_kind')
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
      botKind = String((defRow as { bot_kind?: string }).bot_kind ?? '').toLowerCase() || null
      // Só amarra a linha no lead quando ela foi escolhida por ausência de vínculo.
      // Se descartamos a linha (outro polo ou desativada), o vínculo original fica de pé:
      // ele conta onde a pessoa conversa, e sobrescrever aqui apagaria essa informação.
      // No caso da linha desativada isso também é reversível: religar a instância no
      // painel devolve as conversas para ela, em vez de exigir remendo no banco.
      if (opts?.bindDefault !== false && !crossTenantInstanceIgnored && !inactiveInstanceIgnored) {
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
    provider = await getOfficialProviderForLead(admin, effectiveInstanceId, lead.tenant_id)
  } else {
    provider = await getEvolutionProviderForLead(admin, effectiveInstanceId, lead.tenant_id)
  }

  return {
    provider,
    instanceId: effectiveInstanceId,
    channelProvider: waProvider,
    botKind,
    crossTenantInstanceIgnored,
    inactiveInstanceIgnored,
  }
}
