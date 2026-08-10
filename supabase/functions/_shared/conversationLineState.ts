import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * `owner_mode` / `ai_enabled` por (lead, LINHA do WhatsApp).
 *
 * A regra "a conversa segue a linha, a pessoa segue o polo" (20260810180848) fez a mesma
 * pessoa reaproveitar um único card nos dois polos. Só que quem responde continuava sendo
 * decidido por LEAD: a atendente da clínica assumia o atendimento na mão em julho, e isso
 * calava o bot de vendas do Tricopill em agosto — o cliente pedia preço na linha de vendas
 * e ninguém respondia.
 *
 * Aqui a decisão é por linha. Ausência de registro significa "ninguém decidiu nada nesta
 * linha ainda", e vale o default de `crm_ai_configs` (IA responde). Ver a migration
 * 20260810220000_estado_da_conversa_por_linha.sql.
 *
 * A tabela antiga (`crm_conversation_states`) continua sendo escrita por quem já escrevia:
 * é o que o painel mostra, e é onde vivem buffer de burst, trava de resposta e timestamps.
 */

export type LineConversationMode = {
  ownerMode: string
  aiEnabled: boolean
  lastHumanReplyAt: string | null
}

/** Linha da conversa: a explícita (webhook sabe por onde entrou) ou a última do lead. */
export async function resolveLeadLineId(
  admin: SupabaseClient,
  leadId: string,
  explicitInstanceId?: string | null,
): Promise<string | null> {
  const explicit = String(explicitInstanceId ?? '').trim()
  if (explicit) return explicit
  const { data } = await admin
    .from('leads')
    .select('whatsapp_instance_id')
    .eq('id', leadId)
    .maybeSingle()
  const fromLead = String(
    (data as { whatsapp_instance_id?: string | null } | null)?.whatsapp_instance_id ?? '',
  ).trim()
  return fromLead || null
}

/** null = nenhuma decisão tomada nesta linha (o caller cai no default da config). */
export async function loadLineConversationMode(
  admin: SupabaseClient,
  leadId: string,
  instanceId: string,
): Promise<LineConversationMode | null> {
  if (!instanceId) return null
  const { data } = await admin
    .from('crm_conversation_line_states')
    .select('owner_mode, ai_enabled, last_human_reply_at')
    .eq('lead_id', leadId)
    .eq('whatsapp_instance_id', instanceId)
    .maybeSingle()
  if (!data) return null
  const row = data as Record<string, unknown>
  return {
    ownerMode: String(row.owner_mode ?? 'auto').toLowerCase(),
    aiEnabled: row.ai_enabled === null || row.ai_enabled === undefined ? true : Boolean(row.ai_enabled),
    lastHumanReplyAt: row.last_human_reply_at ? String(row.last_human_reply_at) : null,
  }
}

/**
 * Grava a decisão NA LINHA. Best-effort de propósito: se isto falhar, o comportamento cai
 * no de antes (estado por lead) em vez de derrubar o envio ou o handoff.
 */
export async function setLineConversationMode(
  admin: SupabaseClient,
  input: {
    leadId: string
    /** Linha por onde a conversa está acontecendo. Sem isto, usa a linha atual do lead. */
    instanceId?: string | null
    ownerMode?: string
    aiEnabled?: boolean
    lastHumanReplyAt?: string
  },
): Promise<void> {
  try {
    const instanceId = await resolveLeadLineId(admin, input.leadId, input.instanceId)
    if (!instanceId) return

    const { data: inst } = await admin
      .from('whatsapp_channel_instances')
      .select('tenant_id')
      .eq('id', instanceId)
      .maybeSingle()
    const tenantId = String((inst as { tenant_id?: string | null } | null)?.tenant_id ?? '').trim()
    if (!tenantId) return

    const now = new Date().toISOString()
    const { data: current } = await admin
      .from('crm_conversation_line_states')
      .select('owner_mode, ai_enabled, last_human_reply_at')
      .eq('lead_id', input.leadId)
      .eq('whatsapp_instance_id', instanceId)
      .maybeSingle()
    const cur = (current ?? {}) as Record<string, unknown>

    await admin.from('crm_conversation_line_states').upsert({
      lead_id: input.leadId,
      whatsapp_instance_id: instanceId,
      tenant_id: tenantId,
      owner_mode: input.ownerMode ?? String(cur.owner_mode ?? 'auto'),
      ai_enabled: input.aiEnabled ?? (cur.ai_enabled === undefined || cur.ai_enabled === null ? true : Boolean(cur.ai_enabled)),
      last_human_reply_at: input.lastHumanReplyAt ?? (cur.last_human_reply_at ? String(cur.last_human_reply_at) : null),
      updated_at: now,
    })
  } catch (e) {
    console.warn('[conversationLineState] setLineConversationMode:', e instanceof Error ? e.message : String(e))
  }
}
