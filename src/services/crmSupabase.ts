import { initialInteractions, initialLeads, pipelines, sdrTeam } from '../mocks/crmMock'
import type { Interaction, Lead, Pipeline, Sdr } from '../mocks/crmMock'
import { supabase } from '../lib/supabaseClient'

type DbPipeline = {
  id: string
  name: string
}

type DbStage = {
  id: string
  pipeline_id: string
  name: string
  position: number
}

type DbUser = {
  id: string
  name: string
  active: boolean
  role: string
}

type DbLead = {
  id: string
  patient_name: string
  phone: string
  source: Lead['source']
  created_at: string
  score: number
  temperature: Lead['temperature']
  owner_id: string
  pipeline_id: string
  stage_id: string
  summary: string
}

type DbInteraction = {
  id: string
  lead_id: string
  patient_name: string
  channel: Interaction['channel']
  direction: Interaction['direction']
  author: string
  content: string
  happened_at: string
}

export type CrmDataSnapshot = {
  pipelines: Pipeline[]
  sdrTeam: Sdr[]
  leads: Lead[]
  interactions: Interaction[]
}

const assertSupabase = () => {
  if (!supabase) {
    throw new Error('Supabase nao configurado.')
  }
  return supabase
}

export const loadCrmData = async (): Promise<CrmDataSnapshot> => {
  const client = assertSupabase()

  const [pipelinesRes, stagesRes, usersRes, leadsRes, interactionsRes] = await Promise.all([
    client.from('pipelines').select('id, name').order('name', { ascending: true }),
    client.from('pipeline_stages').select('id, pipeline_id, name, position').order('position', { ascending: true }),
    client.from('app_users').select('id, name, active, role').order('name', { ascending: true }),
    client.from('leads').select('id, patient_name, phone, source, created_at, score, temperature, owner_id, pipeline_id, stage_id, summary').order('created_at', { ascending: false }),
    client
      .from('interactions')
      .select('id, lead_id, patient_name, channel, direction, author, content, happened_at')
      .order('happened_at', { ascending: false }),
  ])

  if (pipelinesRes.error) throw pipelinesRes.error
  if (stagesRes.error) throw stagesRes.error
  if (usersRes.error) throw usersRes.error
  if (leadsRes.error) throw leadsRes.error
  if (interactionsRes.error) throw interactionsRes.error

  const pipelineRows = (pipelinesRes.data ?? []) as DbPipeline[]
  const stageRows = (stagesRes.data ?? []) as DbStage[]
  const userRows = (usersRes.data ?? []) as DbUser[]
  const leadRows = (leadsRes.data ?? []) as DbLead[]
  const interactionRows = (interactionsRes.data ?? []) as DbInteraction[]

  if (pipelineRows.length === 0 || stageRows.length === 0 || userRows.length === 0) {
    return {
      pipelines,
      sdrTeam,
      leads: initialLeads,
      interactions: initialInteractions,
    }
  }

  const builtPipelines: Pipeline[] = pipelineRows.map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    stages: stageRows
      .filter((stage) => stage.pipeline_id === pipeline.id)
      .sort((a, b) => a.position - b.position)
      .map((stage) => ({ id: stage.id, name: stage.name })),
  }))

  const builtUsers: Sdr[] = userRows
    .filter((user) => user.role === 'sdr')
    .map((user) => ({ id: user.id, name: user.name, active: user.active }))

  const builtLeads: Lead[] = leadRows.map((lead) => ({
    id: lead.id,
    patientName: lead.patient_name,
    phone: lead.phone,
    source: lead.source,
    createdAt: lead.created_at,
    score: lead.score,
    temperature: lead.temperature,
    ownerId: lead.owner_id,
    pipelineId: lead.pipeline_id,
    stageId: lead.stage_id,
    summary: lead.summary,
  }))

  const builtInteractions: Interaction[] = interactionRows.map((interaction) => ({
    id: interaction.id,
    leadId: interaction.lead_id,
    patientName: interaction.patient_name,
    channel: interaction.channel,
    direction: interaction.direction,
    author: interaction.author,
    content: interaction.content,
    happenedAt: interaction.happened_at,
  }))

  return {
    pipelines: builtPipelines,
    sdrTeam: builtUsers,
    leads: builtLeads,
    interactions: builtInteractions,
  }
}

export const seedTestUsers = async (): Promise<void> => {
  const client = assertSupabase()

  const payload = [
    { id: 'sdr-1', name: 'Ana Costa', role: 'sdr', active: true },
    { id: 'sdr-2', name: 'Bruno Lima', role: 'sdr', active: true },
    { id: 'sdr-3', name: 'Carla Souza', role: 'sdr', active: true },
    { id: 'gestor-1', name: 'Diego Moura', role: 'gestor', active: true },
  ]

  const { error } = await client.from('app_users').upsert(payload)
  if (error) throw error
}

export const seedDemoData = async (): Promise<void> => {
  const client = assertSupabase()

  const pipelinePayload = pipelines.map((pipeline) => ({ id: pipeline.id, name: pipeline.name }))
  const stagePayload = pipelines.flatMap((pipeline) =>
    pipeline.stages.map((stage, index) => ({
      id: stage.id,
      pipeline_id: pipeline.id,
      name: stage.name,
      position: index,
    })),
  )
  const leadPayload = initialLeads.map((lead) => ({
    id: lead.id,
    patient_name: lead.patientName,
    phone: lead.phone,
    source: lead.source,
    created_at: lead.createdAt,
    score: lead.score,
    temperature: lead.temperature,
    owner_id: lead.ownerId,
    pipeline_id: lead.pipelineId,
    stage_id: lead.stageId,
    summary: lead.summary,
  }))
  const interactionPayload = initialInteractions.map((interaction) => ({
    id: interaction.id,
    lead_id: interaction.leadId,
    patient_name: interaction.patientName,
    channel: interaction.channel,
    direction: interaction.direction,
    author: interaction.author,
    content: interaction.content,
    happened_at: interaction.happenedAt,
  }))

  const pipelineRes = await client.from('pipelines').upsert(pipelinePayload)
  if (pipelineRes.error) throw pipelineRes.error

  const stageRes = await client.from('pipeline_stages').upsert(stagePayload)
  if (stageRes.error) throw stageRes.error

  const leadRes = await client.from('leads').upsert(leadPayload)
  if (leadRes.error) throw leadRes.error

  const interactionRes = await client.from('interactions').upsert(interactionPayload)
  if (interactionRes.error) throw interactionRes.error
}

export const updateLeadStage = async (leadId: string, stageId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('leads').update({ stage_id: stageId }).eq('id', leadId)
  if (error) throw error
}

export const insertLead = async (lead: Lead): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('leads').insert({
    id: lead.id,
    patient_name: lead.patientName,
    phone: lead.phone,
    source: lead.source,
    created_at: lead.createdAt,
    score: lead.score,
    temperature: lead.temperature,
    owner_id: lead.ownerId,
    pipeline_id: lead.pipelineId,
    stage_id: lead.stageId,
    summary: lead.summary,
  })
  if (error) throw error
}

export const insertInteraction = async (interaction: Omit<Interaction, 'id'>): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('interactions').insert({
    lead_id: interaction.leadId,
    patient_name: interaction.patientName,
    channel: interaction.channel,
    direction: interaction.direction,
    author: interaction.author,
    content: interaction.content,
    happened_at: interaction.happenedAt,
  })
  if (error) throw error
}
