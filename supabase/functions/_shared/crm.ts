import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  attributionForCustomFields,
  type LeadAttribution,
} from './attribution.ts'
import { notifyAgents } from './notifyAgents.ts'

export type LeadSource = 'meta_facebook' | 'meta_instagram' | 'meta_whatsapp' | 'whatsapp' | 'manual'
export type LeadTemperature = 'cold' | 'warm' | 'hot'

export type UpsertLeadInput = {
  patientName: string
  phone: string
  summary: string
  source: LeadSource
  ownerId?: string
  pipelineId?: string
  stageId?: string
  score?: number
  temperature?: LeadTemperature
  customFields?: Record<string, unknown>
  preferredLeadId?: string
  /** When set, ties the lead to a DB whatsapp_channel_instances row (multi-line). */
  whatsappInstanceId?: string | null
  /**
   * Atribuição de campanha (Meta Ads). Aplicada com regra "first-touch":
   * só grava na criação do lead ou se o lead ainda não tem atribuição — mensagens
   * seguintes não sobrescrevem (só a 1ª mensagem após o clique carrega o referral).
   */
  attribution?: LeadAttribution | null
  /**
   * tenant_id explícito. Quando omitido, o trigger BEFORE INSERT em leads cai no
   * fallback `instituto-lorena`. Edge functions multi-tenant aware devem sempre
   * passar este campo — o tenant é resolvido a partir do payload do webhook.
   */
  tenantId?: string
}

export type UpsertLeadResult = {
  leadId: string
  status: 'created' | 'updated'
}

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

function normalizePhone(value: string): string {
  return digitsOnly(value)
}

// Variantes de telefone BR p/ dedup de lead: com/sem código do país (+55) e com/sem
// o 9º dígito do celular. O site grava "44999161834" (sem 55); o WhatsApp manda
// "554499161834" (com 55, sem o 9). Sem isso, o inbound não acha o lead do pedido e
// DUPLICA o contato (caso Eder 07/jul). Mantém o DDD fixo → risco de colisão desprezível.
function brPhoneVariants(raw: string): string[] {
  let d = digitsOnly(raw)
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  if (d.length < 10) return d ? [d] : []
  const ddd = d.slice(0, 2)
  const num = d.slice(2)
  const cores = new Set<string>([ddd + num])
  if (num.length === 9 && num[0] === '9') cores.add(ddd + num.slice(1))        // remove o 9º dígito
  else if (num.length === 8 && /^[6-9]/.test(num)) cores.add(ddd + '9' + num)  // adiciona o 9º dígito
  const out = new Set<string>()
  for (const c of cores) { out.add(c); out.add('55' + c) }
  return [...out].filter((v) => v.length >= 10)
}

function temperatureForSource(source: LeadSource, override: string | undefined): LeadTemperature {
  if (override && ['cold', 'warm', 'hot'].includes(override)) return override as LeadTemperature
  if (source === 'meta_facebook' || source === 'meta_instagram') return 'hot'
  if (source === 'whatsapp' || source === 'meta_whatsapp') return 'warm'
  return 'cold'
}

export async function findLeadByPhone(admin: SupabaseClient, phone: string): Promise<string | null> {
  // 1) Casa por variantes (±55, ±9º dígito) — pega o lead do pedido do site mesmo com
  //    formato diferente do WhatsApp. Prefere o mais antigo (o original) e ignora escondidos.
  const variants = brPhoneVariants(phone)
  if (variants.length) {
    const { data } = await admin
      .from('leads')
      .select('id')
      .in('phone', variants)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (data?.id) return String(data.id)
  }
  // 2) Fallback (compat): RPC + eq exato.
  const { data: fromRpc, error: findError } = await admin.rpc('find_lead_id_by_phone_digits', { p_digits: phone })
  if (!findError && fromRpc) return String(fromRpc)
  const { data, error } = await admin.from('leads').select('id').eq('phone', phone).maybeSingle()
  if (error || !data) return null
  return String((data as { id: unknown }).id)
}

export function isPlaceholderName(name: string): boolean {
  const n = name.toLowerCase().trim()
  return (
    !n ||
    n === 'lead' ||
    n === 'lead webhook' ||
    n === 'novo contato' ||
    n === 'atendimento' ||
    n === 'atendimento comercial' ||
    n === 'whatsapp' ||
    n === 'lead instagram' ||
    n === 'instagram user'
  )
}

async function findLeadIdByPhoneAndInstance(
  admin: SupabaseClient,
  phone: string,
  instanceId: string | null,
): Promise<string | null> {
  const phones = brPhoneVariants(phone)
  const inList = phones.length ? phones : [digitsOnly(phone)]
  if (instanceId) {
    const { data: byBoth } = await admin
      .from('leads')
      .select('id')
      .in('phone', inList)
      .eq('whatsapp_instance_id', instanceId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (byBoth?.id) return String(byBoth.id)
    // Lead do site: criado sem linha (whatsapp_instance_id null) — casa pela variante do fone.
    const { data: byPhoneNull } = await admin
      .from('leads')
      .select('id')
      .in('phone', inList)
      .is('whatsapp_instance_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (byPhoneNull?.id) return String(byPhoneNull.id)
    return null
  }
  return findLeadByPhone(admin, phone)
}

/** Evita FK em `leads.owner_id` quando `whatsapp_channel_instances.default_owner_id` ou payload apontam para `app_users` inexistente. */
async function coerceOwnerIdToExistingAppUser(
  admin: SupabaseClient,
  candidate: string,
  fallback: string,
): Promise<string> {
  const c = String(candidate ?? '').trim()
  if (!c) return fallback
  const { data } = await admin.from('app_users').select('id').eq('id', c).maybeSingle()
  if (data?.id) return String(data.id)
  return fallback
}

export async function resolveDefaultRouting(admin: SupabaseClient): Promise<{
  ownerId: string
  pipelineId: string
  stageId: string
}> {
  const { data: pipelineRows } = await admin
    .from('pipelines')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)

  let pipelineId = pipelineRows?.[0]?.id ? String(pipelineRows[0].id) : ''
  if (!pipelineId) {
    pipelineId = 'pipeline-clinica'
    await admin.from('pipelines').upsert({ id: pipelineId, name: 'Pipeline Clinica', board_config: {} })
  }

  const { data: stageRows } = await admin
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: true })
    .limit(1)
  let stageId = stageRows?.[0]?.id ? String(stageRows[0].id) : ''
  if (!stageId) {
    stageId = 'novo'
    await admin.from('pipeline_stages').upsert({
      id: stageId,
      pipeline_id: pipelineId,
      name: 'Novo',
      position: 0,
    })
  }

  // takes_leads: só quem realmente ATENDE entra no rodízio (financeiro/Gerencia
  // ficam de fora — 42% dos leads caíam com contas que ninguém opera).
  const { data: sdrRows } = await admin
    .from('app_users')
    .select('id')
    .eq('role', 'sdr')
    .eq('active', true)
    .eq('takes_leads', true)
    .order('name', { ascending: true })
    .limit(20)

  let ownerCandidates = (sdrRows ?? []).map((r) => String(r.id))
  if (ownerCandidates.length === 0) {
    const { data: activeUsers } = await admin
      .from('app_users')
      .select('id')
      .eq('active', true)
      .eq('takes_leads', true)
      .limit(20)
    ownerCandidates = (activeUsers ?? []).map((r) => String(r.id))
  }
  if (ownerCandidates.length === 0) {
    const fallbackOwnerId = 'webhook-bot'
    await admin.from('app_users').upsert({
      id: fallbackOwnerId,
      name: 'Webhook Bot',
      role: 'sdr',
      active: true,
      email: 'webhook-bot@local',
    })
    ownerCandidates = [fallbackOwnerId]
  }

  let ownerId = ownerCandidates[0]
  if (ownerCandidates.length > 0) {
    const owners = ownerCandidates
    const ownerCounts = await Promise.all(
      owners.map(async (id) => {
        const { count } = await admin
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('owner_id', id)
          .not('stage_id', 'ilike', '%fechado%')
        return { id, count: count ?? 0 }
      }),
    )
    ownerId = ownerCounts.sort((a, b) => a.count - b.count)[0]?.id ?? owners[0]
  }

  return { ownerId, pipelineId, stageId }
}

async function resolveEntryStageId(
  admin: SupabaseClient,
  pipelineId: string,
  stageId: string | null,
): Promise<string> {
  if (stageId) {
    const { data: byId } = await admin
      .from('pipeline_stages')
      .select('id')
      .eq('id', stageId)
      .eq('pipeline_id', pipelineId)
      .maybeSingle()
    if (byId?.id) return String(byId.id)
  }
  const { data: first } = await admin
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()
  return first?.id ? String(first.id) : ''
}

type WaInstanceRow = {
  id: string
  label: string
  entry_pipeline_id: string | null
  entry_stage_id: string | null
  default_owner_id: string | null
  on_line_change: string
}

export async function resolveRoutingForInstance(
  admin: SupabaseClient,
  instanceId: string | null,
): Promise<{ ownerId: string; pipelineId: string; stageId: string }> {
  const fallback = await resolveDefaultRouting(admin)
  if (!instanceId) return fallback
  const { data: row } = await admin
    .from('whatsapp_channel_instances')
    .select('entry_pipeline_id, entry_stage_id, default_owner_id')
    .eq('id', instanceId)
    .maybeSingle()
  if (!row) return fallback
  const r = row as Record<string, unknown>
  const rawOwner =
    r.default_owner_id != null && String(r.default_owner_id).trim()
      ? String(r.default_owner_id).trim()
      : ''
  const ownerId = rawOwner
    ? await coerceOwnerIdToExistingAppUser(admin, rawOwner, fallback.ownerId)
    : fallback.ownerId
  const ep = r.entry_pipeline_id != null && String(r.entry_pipeline_id) ? String(r.entry_pipeline_id) : null
  if (!ep) {
    return {
      ownerId,
      pipelineId: fallback.pipelineId,
      stageId: fallback.stageId,
    }
  }
  const es = r.entry_stage_id != null && String(r.entry_stage_id) ? String(r.entry_stage_id) : null
  const stageResolved = (await resolveEntryStageId(admin, ep, es)) || fallback.stageId
  return {
    ownerId,
    pipelineId: ep,
    stageId: stageResolved,
  }
}

async function recordLineHandoff(
  admin: SupabaseClient,
  leadId: string,
  fromId: string | null,
  toId: string,
) {
  if (toId && fromId === toId) return
  const { error } = await admin.from('lead_wa_line_events').insert({
    lead_id: leadId,
    from_instance_id: fromId,
    to_instance_id: toId,
  })
  if (error) {
    console.warn('lead_wa_line_events insert:', error.message)
  }
}

async function fetchWhatsAppInstanceForHandoff(
  admin: SupabaseClient,
  id: string,
): Promise<WaInstanceRow | null> {
  const { data } = await admin
    .from('whatsapp_channel_instances')
    .select('id, label, entry_pipeline_id, entry_stage_id, default_owner_id, on_line_change')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  return data as WaInstanceRow
}

function mergeCustomFields(
  prev: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!patch || Object.keys(patch).length === 0) return prev && typeof prev === 'object' ? { ...prev } : {}
  const base = prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...(prev as Record<string, unknown>) } : {}
  return { ...base, ...patch }
}

/** Colunas de atribuição (indexadas) a partir do objeto canônico. */
function attributionColumns(a: LeadAttribution): Record<string, unknown> {
  return {
    attribution: a.raw ?? attributionForCustomFields(a),
    attribution_channel: a.channel,
    attribution_campaign: a.campaign ?? null,
    attribution_ad_id: a.adId ?? null,
  }
}

export async function upsertLeadByPhone(admin: SupabaseClient, input: UpsertLeadInput): Promise<UpsertLeadResult> {
  const phone = normalizePhone(input.phone)
  if (phone.length < 10) {
    throw new Error('Telefone deve ter pelo menos 10 dígitos')
  }

  const instanceId = input.whatsappInstanceId && String(input.whatsappInstanceId).length > 0
    ? String(input.whatsappInstanceId)
    : null

  const useWhatsappUnify = input.source === 'whatsapp'
  const existingId = useWhatsappUnify
    ? ((await findLeadByPhone(admin, phone)) ?? undefined)
    : (await findLeadIdByPhoneAndInstance(admin, phone, instanceId)) ?? undefined

  const score = Number(input.score ?? 50) || 50
  const temperature = temperatureForSource(input.source, input.temperature)

  const newLeadRouting = instanceId
    ? await resolveRoutingForInstance(admin, instanceId)
    : await resolveDefaultRouting(admin)

  const ownerIdForCreate = input.ownerId?.trim() || newLeadRouting.ownerId
  const pipelineIdForCreate = input.pipelineId?.trim() || newLeadRouting.pipelineId
  const stageIdForCreate = input.stageId?.trim() || newLeadRouting.stageId
  const routingFallback = await resolveDefaultRouting(admin)

  if (existingId) {
    const { data: cur, error: curErr } = await admin
      .from('leads')
      .select(
        'id, custom_fields, pipeline_id, stage_id, owner_id, score, whatsapp_instance_id, patient_name, attribution_channel',
      )
      .eq('id', existingId)
      .maybeSingle()
    if (curErr) throw new Error(curErr.message)
    const current = (cur ?? {}) as Record<string, unknown>

    let customMerged = mergeCustomFields(
      current.custom_fields as Record<string, unknown> | undefined,
      input.customFields,
    )

    // First-touch: só grava atribuição se o lead ainda não tiver nenhuma.
    const hasAttribution = Boolean(String(current.attribution_channel ?? '').trim())
    const applyAttribution = Boolean(input.attribution) && !hasAttribution
    if (applyAttribution && input.attribution) {
      customMerged = mergeCustomFields(customMerged, {
        attribution: attributionForCustomFields(input.attribution),
      })
    }

    const isPlaceholder = isPlaceholderName

    const patch: Record<string, unknown> = {
      patient_name: (current.patient_name && !isPlaceholder(String(current.patient_name))) 
        ? String(current.patient_name) 
        : (input.patientName || String(current.patient_name ?? 'Lead')),
      phone,
      source: input.source,
      summary: input.summary || '',
      custom_fields: customMerged,
    }

    if (useWhatsappUnify) {
      patch.whatsapp_instance_id = instanceId
    } else if (instanceId) {
      patch.whatsapp_instance_id = instanceId
    }

    const prevInst = current.whatsapp_instance_id != null && String(current.whatsapp_instance_id)
      ? String(current.whatsapp_instance_id)
      : null
    const isHandoff = Boolean(
      useWhatsappUnify && instanceId && prevInst && prevInst !== instanceId,
    )

    if (isHandoff && instanceId) {
      const toId = instanceId
      await recordLineHandoff(admin, existingId, prevInst, toId)
      const toDef = (await fetchWhatsAppInstanceForHandoff(admin, toId)) as WaInstanceRow | null
      if (toDef && toDef.on_line_change === 'use_entry' && toDef.entry_pipeline_id) {
        const r = await resolveRoutingForInstance(admin, toId)
        patch.pipeline_id = r.pipelineId
        patch.stage_id = r.stageId
        patch.owner_id = r.ownerId
      } else {
        if (String(current.pipeline_id ?? '')) {
          patch.pipeline_id = String(current.pipeline_id)
        }
        if (String(current.stage_id ?? '')) {
          patch.stage_id = String(current.stage_id)
        }
        if (String(current.owner_id ?? '')) {
          patch.owner_id = String(current.owner_id)
        }
      }
      if (toDef) {
        try {
          const fromL = (await fetchWhatsAppInstanceForHandoff(admin, prevInst!))?.label ?? 'linha anterior'
          const lineNote = `Atendimento contínuo: mensagem agora pela linha «${toDef.label}» (antes: «${fromL}»).`
          await insertInteraction(admin, {
            leadId: existingId,
            patientName: String(current.patient_name ?? input.patientName),
            channel: 'system',
            direction: 'system',
            author: 'CRM',
            content: lineNote,
            happenedAt: new Date().toISOString(),
          })
        } catch {
          // ignore
        }
      }
    } else {
      if (String(current.pipeline_id ?? '')) {
        patch.pipeline_id = String(current.pipeline_id)
      }
      if (String(current.stage_id ?? '')) {
        patch.stage_id = String(current.stage_id)
      }
      if (String(current.owner_id ?? '')) {
        patch.owner_id = String(current.owner_id)
      }
    }

    if (!useWhatsappUnify && (input.pipelineId || input.stageId)) {
      if (input.ownerId) patch.owner_id = input.ownerId
      if (input.pipelineId) patch.pipeline_id = input.pipelineId
      if (input.stageId) patch.stage_id = input.stageId
    }
    if (input.score !== undefined && input.score !== null) {
      patch.score = score
    } else if (Number.isFinite(current.score as number)) {
      patch.score = current.score
    } else {
      patch.score = score
    }
    patch.temperature = temperature
    patch.deleted_at = null

    if (patch.owner_id != null && String(patch.owner_id).trim()) {
      patch.owner_id = await coerceOwnerIdToExistingAppUser(
        admin,
        String(patch.owner_id),
        routingFallback.ownerId,
      )
    }

    if (applyAttribution && input.attribution) {
      Object.assign(patch, attributionColumns(input.attribution))
    }

    const { error: updateError } = await admin.from('leads').update(patch).eq('id', existingId)
    if (updateError) throw new Error(updateError.message)
    return { leadId: existingId, status: 'updated' }
  }

  const newId = input.preferredLeadId?.trim() || `lead-${crypto.randomUUID().slice(0, 12)}`
  const safeOwnerId = await coerceOwnerIdToExistingAppUser(admin, ownerIdForCreate, routingFallback.ownerId)
  const customFieldsForCreate = input.attribution
    ? mergeCustomFields(input.customFields, { attribution: attributionForCustomFields(input.attribution) })
    : (input.customFields ?? {})
  const row: Record<string, unknown> = {
    id: newId,
    patient_name: input.patientName || 'Lead webhook',
    phone,
    source: input.source,
    summary: input.summary || '',
    owner_id: safeOwnerId,
    pipeline_id: pipelineIdForCreate,
    stage_id: stageIdForCreate,
    score,
    temperature,
    custom_fields: customFieldsForCreate,
    created_at: new Date().toISOString(),
    position: 1,
  }
  if (input.attribution) {
    Object.assign(row, attributionColumns(input.attribution))
  }
  if (instanceId) {
    row.whatsapp_instance_id = instanceId
  }
  if (input.tenantId) {
    row.tenant_id = input.tenantId
  }
  const { error: insertError } = await admin.from('leads').insert(row)
  if (insertError) throw new Error(insertError.message)
  return { leadId: newId, status: 'created' }
}

export async function insertInteraction(
  admin: SupabaseClient,
  input: {
    leadId: string
    patientName: string
    channel: 'whatsapp' | 'meta' | 'system' | 'ai'
    direction: 'in' | 'out' | 'system'
    author: string
    content: string
    happenedAt?: string
    externalMessageId?: string
    /**
     * tenant_id explícito. Quando omitido, o trigger BEFORE INSERT em interactions
     * cai no fallback `instituto-lorena` (transitório). Edge functions multi-tenant
     * devem sempre passar este campo para garantir isolamento correto.
     */
    tenantId?: string
  },
): Promise<string> {
  const row: Record<string, unknown> = {
    lead_id: input.leadId,
    patient_name: input.patientName,
    channel: input.channel,
    direction: input.direction,
    author: input.author,
    content: input.content,
    happened_at: input.happenedAt ?? new Date().toISOString(),
    external_message_id: input.externalMessageId || null,
  }
  if (input.tenantId) row.tenant_id = input.tenantId
  const { data, error } = await admin.from('interactions').insert(row).select('id').single()
  if (error) throw new Error(error.message)
  if (!data?.id) throw new Error('insert_interaction_no_id')
  return String(data.id)
}

/**
 * Comprovante AUTOMÁTICO do recebimento — grava a prova do gateway no momento do pagamento
 * (cartão: TID/código de autorização/parcelas; Pix: id da transação/E2E do PagBank). Assim
 * NENHUM recebimento fica sem comprovante, mesmo que a SDR nunca anexe um arquivo. Idempotente
 * (índice único parcial payment_id+payment_method onde source='auto') e best-effort: nunca
 * derruba o fluxo de pagamento. O upload manual (foto/recibo) continua possível em paralelo.
 */
export async function recordAutoReceipt(
  admin: SupabaseClient,
  input: {
    tenantId: string
    paymentId: string
    paymentMethod: 'card' | 'pix'
    amountCents: number
    autoData: Record<string, unknown>
    /** Nome de quem pagou — carimbado no comprovante p/ não ficar anônimo na conciliação. */
    customerName?: string
    note?: string
  },
): Promise<void> {
  try {
    const { error } = await admin.from('payment_receipts').insert({
      tenant_id: input.tenantId,
      payment_id: input.paymentId,
      payment_method: input.paymentMethod,
      source: 'auto',
      storage_path: null,
      file_name: `comprovante-auto-${input.paymentMethod}-${input.paymentId}.json`,
      mime_type: 'application/json',
      note: input.note ?? null,
      auto_data: {
        ...input.autoData,
        customer_name: input.customerName?.trim() || null,
        amount_cents: input.amountCents,
        recorded_at: new Date().toISOString(),
      },
    })
    // 23505 = unique_violation → comprovante automático já existe (retry/webhook duplicado). OK.
    if (error && error.code !== '23505') {
      console.warn('[recordAutoReceipt] insert failed:', error.message)
    }
  } catch (e) {
    console.warn('[recordAutoReceipt] exception:', e instanceof Error ? e.message : String(e))
  }
}

/**
 * Escala um lead para ATENDIMENTO HUMANO ("consultor precisa assumir"):
 *  1) marca `conversation_status='waiting_human'` (acende o painel "Atendimento Pendente"),
 *     sem rebaixar quem já está em atendimento humano/perdido/fechado;
 *  2) opcionalmente DESLIGA a IA (owner_mode=human, ai_enabled=false) p/ o humano assumir;
 *  3) notifica os agentes (sininho + som + toast via app_inbox_notifications).
 * Best-effort: nunca lança — usada em webhooks/fechamento, não pode derrubar o fluxo.
 * É o caminho ÚNICO de handoff p/ o bot de vendas (Tricopill), que antes nunca escalava.
 */
export async function escalateLeadToHuman(
  admin: SupabaseClient,
  input: {
    leadId: string
    tenantId?: string
    title: string
    body: string
    /** false = só notifica/acende painel sem desligar a IA (ex.: avisar venda quente). Default: desliga. */
    turnOffAi?: boolean
    /** Anti-spam: não repete a mesma notificação para o lead dentro da janela. */
    dedupeKey?: string
    dedupeWindowMinutes?: number
  },
): Promise<void> {
  try {
    const nowIso = new Date().toISOString()
    await admin
      .from('leads')
      .update({ conversation_status: 'waiting_human', last_interaction_at: nowIso, updated_at: nowIso })
      .eq('id', input.leadId)
      .not('conversation_status', 'in', '(human_active,lost,closed,archived)')
    if (input.turnOffAi !== false) {
      await admin.from('crm_conversation_states').upsert({
        lead_id: input.leadId,
        ai_enabled: false,
        owner_mode: 'human',
        updated_at: nowIso,
      })
    }
    await notifyAgents(admin, {
      leadId: input.leadId,
      kind: 'handoff',
      title: input.title,
      body: input.body,
      includeOwner: true,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey, dedupeWindowMinutes: input.dedupeWindowMinutes ?? 60 } : {}),
    })
  } catch (e) {
    console.warn('[escalateLeadToHuman]', e instanceof Error ? e.message : String(e))
  }
}

/**
 * Detecta quando o cliente PEDE explicitamente falar com uma pessoa (atendente/consultor/humano).
 * Sinal objetivo p/ chamar o consultor no bot de vendas. Conservador p/ evitar falso positivo
 * (que desligaria a IA à toa): exige menção clara a atendente humano, não só a palavra "pessoa".
 */
const HUMAN_REQUEST_RE =
  /atendimento humano|^\s*atendente\b|tem algu[eé]m a[íi]|(quero|queria|gostaria|preciso|posso|chama[r]?|me\s+(transfere|passa|encaminha|chama|atende)|falar|conversar)\b[^.!?\n]{0,24}\b(atendente|humano|consultor[ae]?|vendedor[ae]?|uma pessoa|pessoa\s+(de verdade|real)|algu[eé]m|gente)\b/i

export function wantsHumanAgent(text: string): boolean {
  const t = (text ?? '').toLowerCase().trim()
  if (!t) return false
  return HUMAN_REQUEST_RE.test(t)
}

/**
 * Detecta quando o cliente AVISA que pagou (ou que está mandando o comprovante). Dispara a
 * verificação imediata do PIX e.Rede do lead — confirma em segundos em vez de esperar o poller.
 * Conservador, mas cobre as formas comuns ("paguei", "fiz o pix", "segue o comprovante").
 */
const SAYS_PAID_RE =
  /\b(paguei|pagei|paguey|j[áa]\s*paguei|fiz o (pix|pagamento|pagamentinho)|efetuei|realizei o pagamento|fiz a transfer[êe]ncia|transferi|comprovante|comprei|finalizei a compra|conclu[íi] a compra)\b|pagamento (feito|realizado|efetuado|conclu[íi]do)|paguei o pix/i

export function customerSaysPaid(text: string): boolean {
  const t = (text ?? '').toLowerCase().trim()
  if (!t) return false
  return SAYS_PAID_RE.test(t)
}

/**
 * Finds an existing Instagram lead (synthetic phone prefix 888001) by patient name.
 * Used for cross-channel merge when a WhatsApp message arrives from someone
 * already known via Instagram/ManyChat — no phone match is possible until now.
 */
export async function findSyntheticInstagramLeadByName(
  admin: SupabaseClient,
  patientName: string,
): Promise<string | null> {
  const name = (patientName ?? '').trim()
  if (name.length < 3 || isPlaceholderName(name)) return null
  const { data, error } = await admin
    .from('leads')
    .select('id')
    .ilike('patient_name', name)
    .like('phone', '888001%')
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return String((data as { id: unknown }).id)
}

/** 
 * Busca um lead real de WhatsApp pelo nome do paciente.
 * Usado no merge cross-channel inverso: quando um lead de Instagram entra e já existe um lead de WA com o mesmo nome.
 */
export async function findRealWhatsappLeadByName(
  admin: SupabaseClient,
  patientName: string,
): Promise<string | null> {
  const name = (patientName ?? '').trim()
  if (name.length < 3 || isPlaceholderName(name)) return null
  const { data, error } = await admin
    .from('leads')
    .select('id')
    .ilike('patient_name', name)
    .not('phone', 'like', '888001%')
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return String((data as { id: unknown }).id)
}

/** Telefone sintético estável para leads só Instagram (ManyChat) até haver telefone real (prefixo 888001). */
export function syntheticPhoneFromManychatSubscriberId(subscriberId: string): string {
  const raw = String(subscriberId).replace(/\D/g, '')
  const suffix = (raw + '0000000000').slice(0, 10)
  return `888001${suffix}`
}

/**
 * Consolida vários IDs ManyChat (IG + WA / contas antigas) num único lead sem perder resolução por subscriber.
 */
export function normalizeManychatSubscriberCustomFields(
  cf: Record<string, unknown>,
  leadPhoneDigitsRaw: string,
): Record<string, unknown> {
  const ids = new Set<string>()
  const pushSid = (v: unknown) => {
    const s =
      typeof v === 'number' && Number.isFinite(v)
        ? String(Math.trunc(v))
        : typeof v === 'string'
          ? v.trim()
          : ''
    if (s) ids.add(s)
  }
  pushSid(cf.manychat_subscriber_id)
  pushSid(cf.manychat_whatsapp_subscriber_id)
  const arr = cf.manychat_subscriber_ids
  if (Array.isArray(arr)) {
    for (const x of arr) pushSid(x)
  }

  if (ids.size === 0) return cf

  const phoneDigits = normalizePhone(leadPhoneDigitsRaw)
  let primary: string | null = null
  for (const sid of ids) {
    if (
      phoneDigits.length >= 10 &&
      normalizePhone(syntheticPhoneFromManychatSubscriberId(sid)) === phoneDigits
    ) {
      primary = sid
      break
    }
  }
  if (!primary) {
    const legacy = cf.manychat_subscriber_id
    if (typeof legacy === 'string') {
      const t = legacy.trim()
      if (t && ids.has(t)) primary = t
    } else if (typeof legacy === 'number' && Number.isFinite(legacy)) {
      const t = String(Math.trunc(legacy))
      if (ids.has(t)) primary = t
    }
  }
  if (!primary) {
    primary = [...ids].sort((a, b) => a.localeCompare(b))[0] ?? null
  }
  if (!primary) return cf

  const sorted = [...ids].sort((a, b) => a.localeCompare(b))
  const secondary = sorted.find((id) => id !== primary)
  const next: Record<string, unknown> = {
    ...cf,
    manychat_subscriber_id: primary,
    manychat_subscriber_ids: sorted,
  }
  if (secondary) next.manychat_whatsapp_subscriber_id = secondary
  else delete next.manychat_whatsapp_subscriber_id
  return next
}

export async function findLeadIdByManychatSubscriberId(
  admin: SupabaseClient,
  subscriberId: string,
): Promise<string | null> {
  const sid = String(subscriberId).trim()
  if (!sid) return null
  const { data: fromRpc, error: rpcErr } = await admin.rpc('find_lead_id_by_manychat_subscriber', {
    p_subscriber: sid,
  })
  if (!rpcErr && fromRpc) return String(fromRpc)

  const { data, error } = await admin
    .from('leads')
    .select('id')
    .contains('custom_fields', { manychat_subscriber_id: sid })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return String((data as { id: unknown }).id)
}

async function resolvePhoneLeadIdByDigits(admin: SupabaseClient, digits: string): Promise<string | null> {
  const { data: fromRpc, error: findError } = await admin.rpc('find_lead_id_by_phone_digits', { p_digits: digits })
  if (!findError && fromRpc) return String(fromRpc)
  const { data: byEq } = await admin.from('leads').select('id').eq('phone', digits).maybeSingle()
  return byEq?.id ? String(byEq.id) : null
}

function maxIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

function preferMergedPatientName(keepName: string, dropName: string): string {
  const k = keepName.trim()
  const d = dropName.trim()
  if (!d) return k || 'Lead'
  if (!k) return d
  if (isPlaceholderName(k) && !isPlaceholderName(d)) return d
  if (isPlaceholderName(d)) return k
  return d.length > k.length ? d : k
}

/**
 * Move dados do lead `dropLeadId` para `keepLeadId` e apaga o drop.
 * Usado quando o mesmo contacto passa de ID sintético ManyChat para telefone real já existente.
 */
export async function mergeLeadDropIntoKeep(
  admin: SupabaseClient,
  keepLeadId: string,
  dropLeadId: string,
): Promise<void> {
  if (keepLeadId === dropLeadId) return

  const { data: dropLead } = await admin
    .from('leads')
    .select('custom_fields, patient_name')
    .eq('id', dropLeadId)
    .maybeSingle()
  const { data: keepLead } = await admin
    .from('leads')
    .select('custom_fields, phone, patient_name')
    .eq('id', keepLeadId)
    .maybeSingle()
  const mergedCf = mergeCustomFields(
    keepLead?.custom_fields as Record<string, unknown> | undefined,
    dropLead?.custom_fields as Record<string, unknown> | undefined,
  )
  const normalizedCf = normalizeManychatSubscriberCustomFields(
    mergedCf as Record<string, unknown>,
    String((keepLead as { phone?: string } | null)?.phone ?? ''),
  )
  const patientName = preferMergedPatientName(
    String((keepLead as { patient_name?: string } | null)?.patient_name ?? ''),
    String((dropLead as { patient_name?: string } | null)?.patient_name ?? ''),
  )
  await admin
    .from('leads')
    .update({ custom_fields: normalizedCf, patient_name: patientName, deleted_at: null })
    .eq('id', keepLeadId)

  const fkTables = [
    'interactions',
    'crm_media_items',
    'lead_tasks',
    'survey_dispatches',
    'appointments',
    'lead_wa_line_events',
  ] as const
  for (const t of fkTables) {
    const { error } = await admin.from(t).update({ lead_id: keepLeadId }).eq('lead_id', dropLeadId)
    if (error) console.warn(`mergeLeadDropIntoKeep ${t}:`, error.message)
  }

  const { data: dropTags } = await admin
    .from('lead_tag_assignments')
    .select('tag_id')
    .eq('lead_id', dropLeadId)
  const { data: keepTags } = await admin.from('lead_tag_assignments').select('tag_id').eq('lead_id', keepLeadId)
  const keepSet = new Set((keepTags ?? []).map((r) => String((r as { tag_id: unknown }).tag_id)))
  for (const row of dropTags ?? []) {
    const tid = String((row as { tag_id: unknown }).tag_id)
    if (keepSet.has(tid)) {
      await admin.from('lead_tag_assignments').delete().eq('lead_id', dropLeadId).eq('tag_id', tid)
    }
  }
  await admin.from('lead_tag_assignments').update({ lead_id: keepLeadId }).eq('lead_id', dropLeadId)

  const { data: dropFu } = await admin.from('crm_lead_followup_state').select('lead_id').eq('lead_id', dropLeadId).maybeSingle()
  const { data: keepFu } = await admin.from('crm_lead_followup_state').select('lead_id').eq('lead_id', keepLeadId).maybeSingle()
  if (dropFu) {
    if (!keepFu) {
      const { error } = await admin.from('crm_lead_followup_state').update({ lead_id: keepLeadId }).eq('lead_id', dropLeadId)
      if (error) console.warn('mergeLeadDropIntoKeep crm_lead_followup_state:', error.message)
    } else {
      const { error } = await admin.from('crm_lead_followup_state').delete().eq('lead_id', dropLeadId)
      if (error) console.warn('mergeLeadDropIntoKeep crm_lead_followup_state:', error.message)
    }
  }

  const { data: dropSt } = await admin.from('crm_conversation_states').select('*').eq('lead_id', dropLeadId).maybeSingle()
  const { data: keepSt } = await admin.from('crm_conversation_states').select('*').eq('lead_id', keepLeadId).maybeSingle()
  if (dropSt) {
    if (!keepSt) {
      await admin.from('crm_conversation_states').update({ lead_id: keepLeadId }).eq('lead_id', dropLeadId)
    } else {
      const d = dropSt as Record<string, unknown>
      const k = keepSt as Record<string, unknown>
      const mergedState: Record<string, unknown> = {
        lead_id: keepLeadId,
        owner_mode: String(k.owner_mode ?? 'auto'),
        ai_enabled: Boolean(k.ai_enabled ?? true),
        prompt_override: k.prompt_override ?? d.prompt_override ?? null,
        context_summary: [k.context_summary, d.context_summary].filter(Boolean).join('\n---\n').slice(0, 1200),
        last_inbound_at: maxIso(
          k.last_inbound_at ? String(k.last_inbound_at) : null,
          d.last_inbound_at ? String(d.last_inbound_at) : null,
        ),
        last_ai_reply_at: maxIso(
          k.last_ai_reply_at ? String(k.last_ai_reply_at) : null,
          d.last_ai_reply_at ? String(d.last_ai_reply_at) : null,
        ),
        last_human_reply_at: maxIso(
          k.last_human_reply_at ? String(k.last_human_reply_at) : null,
          d.last_human_reply_at ? String(d.last_human_reply_at) : null,
        ),
        updated_at: new Date().toISOString(),
      }
      await admin.from('crm_conversation_states').update(mergedState).eq('lead_id', keepLeadId)
      await admin.from('crm_conversation_states').delete().eq('lead_id', dropLeadId)
    }
  }

  const { error: delErr } = await admin.from('leads').delete().eq('id', dropLeadId)
  if (delErr) throw new Error(delErr.message)
}

/**
 * Liga o subscriber ManyChat a um telefone real (merge se já existir lead com esse telefone).
 */
export async function promoteManychatLeadToRealPhone(
  admin: SupabaseClient,
  input: {
    subscriberId: string
    patientName: string
    realPhoneDigits: string
    summary: string
    tenantId?: string
    channel?: string
    attribution?: LeadAttribution | null
  },
): Promise<{ leadId: string; merged: boolean }> {
  const sid = String(input.subscriberId).trim()
  const phone = normalizePhone(input.realPhoneDigits)
  if (phone.length < 10) {
    throw new Error('Telefone deve ter pelo menos 10 dígitos')
  }

  const channel = String(input.channel ?? '').trim().toLowerCase()
  const source: LeadSource = channel === 'instagram' ? 'meta_instagram' : 'meta_whatsapp'
  const customChannelTag = channel === 'instagram' ? 'instagram' : 'whatsapp'

  const mcLeadId = await findLeadIdByManychatSubscriberId(admin, sid)
  const phoneLeadId = await resolvePhoneLeadIdByDigits(admin, phone)

  if (mcLeadId && phoneLeadId && mcLeadId !== phoneLeadId) {
    await mergeLeadDropIntoKeep(admin, phoneLeadId, mcLeadId)
    await upsertLeadByPhone(admin, {
      patientName: input.patientName,
      phone,
      summary: input.summary,
      source,
      customFields: { manychat_subscriber_id: sid, channel: customChannelTag },
      attribution: input.attribution ?? null,
      tenantId: input.tenantId,
    })
    return { leadId: phoneLeadId, merged: true }
  }

  if (mcLeadId && !phoneLeadId) {
    const { data: cur } = await admin.from('leads').select('custom_fields').eq('id', mcLeadId).maybeSingle()
    const customMerged = mergeCustomFields(cur?.custom_fields as Record<string, unknown> | undefined, {
      manychat_subscriber_id: sid,
      channel: customChannelTag,
    })
    const { error } = await admin
      .from('leads')
      .update({
        phone,
        patient_name: input.patientName || 'Lead',
        summary: input.summary || '',
        source,
        custom_fields: customMerged,
      })
      .eq('id', mcLeadId)
    if (error) throw new Error(error.message)
    return { leadId: mcLeadId, merged: false }
  }

  const r = await upsertLeadByPhone(admin, {
    patientName: input.patientName,
    phone,
    summary: input.summary,
    source,
    customFields: { manychat_subscriber_id: sid, channel: customChannelTag },
    attribution: input.attribution ?? null,
    tenantId: input.tenantId,
  })
  return { leadId: r.leadId, merged: false }
}

