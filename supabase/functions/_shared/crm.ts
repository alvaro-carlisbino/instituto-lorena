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

export async function upsertLeadByPhone(admin: SupabaseClient, input: UpsertLeadInput): Promise<UpsertLeadResult> {
  const phone = normalizePhone(input.phone)
  if (phone.length < 10) {
    throw new Error('Telefone deve ter pelo menos 10 dígitos')
  }

  const routing = await resolveDefaultRouting(admin)
  const ownerId = input.ownerId ?? routing.ownerId
  const pipelineId = input.pipelineId ?? routing.pipelineId
  const stageId = input.stageId ?? routing.stageId
  const score = Number(input.score ?? 50) || 50
  const temperature = temperatureForSource(input.source, input.temperature)
  const existingId = await findLeadByPhone(admin, phone)

  const row = {
    patient_name: input.patientName || 'Lead webhook',
    phone,
    source: input.source,
    summary: input.summary || '',
    owner_id: ownerId,
    pipeline_id: pipelineId,
    stage_id: stageId,
    score,
    temperature,
    custom_fields: input.customFields ?? {},
  }

  if (existingId) {
    const { error: updateError } = await admin.from('leads').update(row).eq('id', existingId)
    if (updateError) throw new Error(updateError.message)
    return { leadId: existingId, status: 'updated' }
  }

  const newId = input.preferredLeadId?.trim() || `lead-${crypto.randomUUID().slice(0, 12)}`
  const { error: insertError } = await admin.from('leads').insert({
    id: newId,
    ...row,
    created_at: new Date().toISOString(),
    position: 1,
  })
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

