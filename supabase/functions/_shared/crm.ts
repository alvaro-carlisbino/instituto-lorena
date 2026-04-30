import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

export type LeadSource = 'meta_facebook' | 'meta_instagram' | 'whatsapp' | 'manual'
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

function temperatureForSource(source: LeadSource, override: string | undefined): LeadTemperature {
  if (override && ['cold', 'warm', 'hot'].includes(override)) return override as LeadTemperature
  if (source === 'meta_facebook' || source === 'meta_instagram') return 'hot'
  if (source === 'whatsapp') return 'warm'
  return 'cold'
}

async function findLeadByPhone(admin: SupabaseClient, phone: string): Promise<string | null> {
  const { data: fromRpc, error: findError } = await admin.rpc('find_lead_id_by_phone_digits', { p_digits: phone })
  if (!findError && fromRpc) return String(fromRpc)
  const { data: byEq } = await admin.from('leads').select('id').eq('phone', phone).maybeSingle()
  return byEq?.id ?? null
}

async function findLeadIdByPhoneAndInstance(
  admin: SupabaseClient,
  phone: string,
  instanceId: string | null,
): Promise<string | null> {
  if (instanceId) {
    const { data: byBoth } = await admin
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .eq('whatsapp_instance_id', instanceId)
      .maybeSingle()
    if (byBoth?.id) return String(byBoth.id)
    const { data: byPhoneNull } = await admin
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .is('whatsapp_instance_id', null)
      .maybeSingle()
    if (byPhoneNull?.id) return String(byPhoneNull.id)
    return null
  }
  return findLeadByPhone(admin, phone)
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

  const { data: sdrRows } = await admin
    .from('app_users')
    .select('id')
    .eq('role', 'sdr')
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(20)

  let ownerCandidates = (sdrRows ?? []).map((r) => String(r.id))
  if (ownerCandidates.length === 0) {
    const { data: activeUsers } = await admin.from('app_users').select('id').eq('active', true).limit(20)
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
  const ep = r.entry_pipeline_id != null && String(r.entry_pipeline_id) ? String(r.entry_pipeline_id) : null
  if (!ep) {
    return {
      ownerId: (r.default_owner_id != null && String(r.default_owner_id) ? String(r.default_owner_id) : null) ??
        fallback.ownerId,
      pipelineId: fallback.pipelineId,
      stageId: fallback.stageId,
    }
  }
  const es = r.entry_stage_id != null && String(r.entry_stage_id) ? String(r.entry_stage_id) : null
  const stageResolved = (await resolveEntryStageId(admin, ep, es)) || fallback.stageId
  return {
    ownerId: (r.default_owner_id != null && String(r.default_owner_id) ? String(r.default_owner_id) : null) ??
      fallback.ownerId,
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

  if (existingId) {
    const { data: cur, error: curErr } = await admin
      .from('leads')
      .select(
        'id, custom_fields, pipeline_id, stage_id, owner_id, score, whatsapp_instance_id, patient_name',
      )
      .eq('id', existingId)
      .maybeSingle()
    if (curErr) throw new Error(curErr.message)
    const current = (cur ?? {}) as Record<string, unknown>

    const customMerged = mergeCustomFields(
      current.custom_fields as Record<string, unknown> | undefined,
      input.customFields,
    )
    const patch: Record<string, unknown> = {
      patient_name: input.patientName || String(current.patient_name ?? 'Lead'),
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

    const { error: updateError } = await admin.from('leads').update(patch).eq('id', existingId)
    if (updateError) throw new Error(updateError.message)
    return { leadId: existingId, status: 'updated' }
  }

  const newId = input.preferredLeadId?.trim() || `lead-${crypto.randomUUID().slice(0, 12)}`
  const row: Record<string, unknown> = {
    id: newId,
    patient_name: input.patientName || 'Lead webhook',
    phone,
    source: input.source,
    summary: input.summary || '',
    owner_id: ownerIdForCreate,
    pipeline_id: pipelineIdForCreate,
    stage_id: stageIdForCreate,
    score,
    temperature,
    custom_fields: input.customFields ?? {},
    created_at: new Date().toISOString(),
    position: 1,
  }
  if (instanceId) {
    row.whatsapp_instance_id = instanceId
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
  },
): Promise<string> {
  const { data, error } = await admin
    .from('interactions')
    .insert({
      lead_id: input.leadId,
      patient_name: input.patientName,
      channel: input.channel,
      direction: input.direction,
      author: input.author,
      content: input.content,
      happened_at: input.happenedAt ?? new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  if (!data?.id) throw new Error('insert_interaction_no_id')
  return String(data.id)
}

/** Telefone sintético estável para leads só Instagram (ManyChat) até haver telefone real (prefixo 888001). */
export function syntheticPhoneFromManychatSubscriberId(subscriberId: string): string {
  const raw = String(subscriberId).replace(/\D/g, '')
  const suffix = (raw + '0000000000').slice(0, 10)
  return `888001${suffix}`
}

export async function findLeadIdByManychatSubscriberId(
  admin: SupabaseClient,
  subscriberId: string,
): Promise<string | null> {
  const sid = String(subscriberId).trim()
  if (!sid) return null
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

  const { data: dropLead } = await admin.from('leads').select('custom_fields').eq('id', dropLeadId).maybeSingle()
  const { data: keepLead } = await admin.from('leads').select('custom_fields').eq('id', keepLeadId).maybeSingle()
  const mergedCf = mergeCustomFields(
    keepLead?.custom_fields as Record<string, unknown> | undefined,
    dropLead?.custom_fields as Record<string, unknown> | undefined,
  )
  await admin.from('leads').update({ custom_fields: mergedCf }).eq('id', keepLeadId)

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
  },
): Promise<{ leadId: string; merged: boolean }> {
  const sid = String(input.subscriberId).trim()
  const phone = normalizePhone(input.realPhoneDigits)
  if (phone.length < 10) {
    throw new Error('Telefone deve ter pelo menos 10 dígitos')
  }

  const mcLeadId = await findLeadIdByManychatSubscriberId(admin, sid)
  const phoneLeadId = await resolvePhoneLeadIdByDigits(admin, phone)

  if (mcLeadId && phoneLeadId && mcLeadId !== phoneLeadId) {
    await mergeLeadDropIntoKeep(admin, phoneLeadId, mcLeadId)
    await upsertLeadByPhone(admin, {
      patientName: input.patientName,
      phone,
      summary: input.summary,
      source: 'meta_instagram',
      customFields: { manychat_subscriber_id: sid },
    })
    return { leadId: phoneLeadId, merged: true }
  }

  if (mcLeadId && !phoneLeadId) {
    const { data: cur } = await admin.from('leads').select('custom_fields').eq('id', mcLeadId).maybeSingle()
    const customMerged = mergeCustomFields(cur?.custom_fields as Record<string, unknown> | undefined, {
      manychat_subscriber_id: sid,
    })
    const { error } = await admin
      .from('leads')
      .update({
        phone,
        patient_name: input.patientName || 'Lead',
        summary: input.summary || '',
        source: 'meta_instagram',
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
    source: 'meta_instagram',
    customFields: { manychat_subscriber_id: sid },
  })
  return { leadId: r.leadId, merged: false }
}

