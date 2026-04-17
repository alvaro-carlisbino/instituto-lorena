import {
  initialDashboardWidgets,
  initialAppUsers,
  initialChannels,
  initialInteractions,
  initialLeads,
  initialMetrics,
  initialNotifications,
  initialPermissions,
  initialTvWidgets,
  initialWorkflowFields,
  pipelines,
  sdrTeam,
} from '../mocks/crmMock'
import type {
  AppUser,
  ChannelConfig,
  DashboardWidget,
  Interaction,
  Lead,
  MetricConfig,
  NotificationRule,
  PermissionProfile,
  Pipeline,
  Sdr,
  TvWidget,
  WorkflowField,
} from '../mocks/crmMock'
import { supabase } from '../lib/supabaseClient'

type DbPipeline = { id: string; name: string }
type DbStage = { id: string; pipeline_id: string; name: string; position: number }
type DbUser = { id: string; name: string; active: boolean; role: string }
type DbLead = {
  id: string
  patient_name: string
  phone: string
  source: Lead['source']
  created_at: string
  position: number
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
  channels: ChannelConfig[]
  metrics: MetricConfig[]
  workflowFields: WorkflowField[]
  permissions: PermissionProfile[]
  notifications: NotificationRule[]
  users: AppUser[]
  tvWidgets: TvWidget[]
  dashboardWidgets: DashboardWidget[]
}

export type AuditLogEntry = {
  id: string
  actorId: string | null
  actorEmail: string | null
  action: string
  targetTable: string
  targetId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

const assertSupabase = () => {
  if (!supabase) throw new Error('Supabase nao configurado.')
  return supabase
}

export const loadCrmData = async (): Promise<CrmDataSnapshot> => {
  const client = assertSupabase()

  const [pipelinesRes, stagesRes, usersRes, leadsRes, interactionsRes, channelsRes, metricsRes, workflowRes, permissionsRes, notificationsRes, tvWidgetsRes, dashboardWidgetsRes] =
    await Promise.all([
      client.from('pipelines').select('id, name').order('name', { ascending: true }),
      client.from('pipeline_stages').select('id, pipeline_id, name, position').order('position', { ascending: true }),
      client.from('app_users').select('id, name, active, role').order('name', { ascending: true }),
      client
        .from('leads')
        .select('id, patient_name, phone, source, created_at, position, score, temperature, owner_id, pipeline_id, stage_id, summary')
        .order('position', { ascending: true }),
      client
        .from('interactions')
        .select('id, lead_id, patient_name, channel, direction, author, content, happened_at')
        .order('happened_at', { ascending: false }),
      client.from('channel_configs').select('id, name, enabled, sla_minutes, auto_reply, priority').order('priority', { ascending: true }),
      client.from('metric_configs').select('id, label, value, target, unit').order('label', { ascending: true }),
      client.from('workflow_fields').select('id, label, field_type, required, options').order('label', { ascending: true }),
      client
        .from('permission_profiles')
        .select('id, role, can_edit_boards, can_route_leads, can_manage_users, can_view_tv_panel')
        .order('role', { ascending: true }),
      client.from('notification_rules').select('id, name, channel, enabled, trigger').order('name', { ascending: true }),
      client.from('tv_widgets').select('id, title, widget_type, metric_key, enabled, position').order('position', { ascending: true }),
      client
        .from('dashboard_widgets')
        .select('id, title, metric_key, enabled, position')
        .order('position', { ascending: true }),
    ])

  if (pipelinesRes.error) throw pipelinesRes.error
  if (stagesRes.error) throw stagesRes.error
  if (usersRes.error) throw usersRes.error
  if (leadsRes.error) throw leadsRes.error
  if (interactionsRes.error) throw interactionsRes.error
  if (channelsRes.error) throw channelsRes.error
  if (metricsRes.error) throw metricsRes.error
  if (workflowRes.error) throw workflowRes.error
  if (permissionsRes.error) throw permissionsRes.error
  if (notificationsRes.error) throw notificationsRes.error
  if (tvWidgetsRes.error) throw tvWidgetsRes.error
  if (dashboardWidgetsRes.error) throw dashboardWidgetsRes.error

  const pipelineRows = (pipelinesRes.data ?? []) as DbPipeline[]
  const stageRows = (stagesRes.data ?? []) as DbStage[]
  const userRows = (usersRes.data ?? []) as DbUser[]
  const leadRows = (leadsRes.data ?? []) as DbLead[]
  const interactionRows = (interactionsRes.data ?? []) as DbInteraction[]

  const builtPipelines: Pipeline[] = pipelineRows.length
    ? pipelineRows.map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        stages: stageRows
          .filter((stage) => stage.pipeline_id === pipeline.id)
          .sort((a, b) => a.position - b.position)
          .map((stage) => ({ id: stage.id, name: stage.name })),
      }))
    : pipelines

  const builtSdrUsers: Sdr[] = userRows.length
    ? userRows
        .filter((user) => user.role === 'sdr')
        .map((user) => ({ id: user.id, name: user.name, active: user.active }))
    : sdrTeam

  const builtLeads: Lead[] = leadRows.length
    ? leadRows.map((lead) => ({
        id: lead.id,
        patientName: lead.patient_name,
        phone: lead.phone,
        source: lead.source,
        createdAt: lead.created_at,
        position: lead.position,
        score: lead.score,
        temperature: lead.temperature,
        ownerId: lead.owner_id,
        pipelineId: lead.pipeline_id,
        stageId: lead.stage_id,
        summary: lead.summary,
      }))
    : initialLeads

  const builtInteractions: Interaction[] = interactionRows.length
    ? interactionRows.map((interaction) => ({
        id: interaction.id,
        leadId: interaction.lead_id,
        patientName: interaction.patient_name,
        channel: interaction.channel,
        direction: interaction.direction,
        author: interaction.author,
        content: interaction.content,
        happenedAt: interaction.happened_at,
      }))
    : initialInteractions

  const builtChannels: ChannelConfig[] = (channelsRes.data ?? []).length
    ? (channelsRes.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        enabled: row.enabled,
        slaMinutes: row.sla_minutes,
        autoReply: row.auto_reply,
        priority: row.priority,
      }))
    : initialChannels

  const builtMetrics: MetricConfig[] = (metricsRes.data ?? []).length
    ? (metricsRes.data ?? [])
    : initialMetrics

  const builtWorkflowFields: WorkflowField[] = (workflowRes.data ?? []).length
    ? (workflowRes.data ?? []).map((row) => ({
        id: row.id,
        label: row.label,
        fieldType: row.field_type,
        required: row.required,
        options: row.options ?? [],
      }))
    : initialWorkflowFields

  const builtPermissions: PermissionProfile[] = (permissionsRes.data ?? []).length
    ? (permissionsRes.data ?? []).map((row) => ({
        id: row.id,
        role: row.role,
        canEditBoards: row.can_edit_boards,
        canRouteLeads: row.can_route_leads,
        canManageUsers: row.can_manage_users,
        canViewTvPanel: row.can_view_tv_panel,
      }))
    : initialPermissions

  const builtNotifications: NotificationRule[] = (notificationsRes.data ?? []).length
    ? (notificationsRes.data ?? [])
    : initialNotifications

  const builtUsers: AppUser[] = userRows.length
    ? userRows.map((row) => ({
        id: row.id,
        name: row.name,
        role: row.role as AppUser['role'],
        active: row.active,
      }))
    : initialAppUsers

  const builtTvWidgets: TvWidget[] = (tvWidgetsRes.data ?? []).length
    ? (tvWidgetsRes.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        widgetType: row.widget_type,
        metricKey: row.metric_key,
        enabled: row.enabled,
        position: row.position,
      }))
    : initialTvWidgets

  const builtDashboardWidgets: DashboardWidget[] = (dashboardWidgetsRes.data ?? []).length
    ? (dashboardWidgetsRes.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        metricKey: row.metric_key,
        enabled: row.enabled,
        position: row.position,
      }))
    : initialDashboardWidgets

  return {
    pipelines: builtPipelines,
    sdrTeam: builtSdrUsers,
    leads: builtLeads,
    interactions: builtInteractions,
    channels: builtChannels,
    metrics: builtMetrics,
    workflowFields: builtWorkflowFields,
    permissions: builtPermissions,
    notifications: builtNotifications,
    users: builtUsers,
    tvWidgets: builtTvWidgets,
    dashboardWidgets: builtDashboardWidgets,
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
    position: lead.position,
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

  const channelPayload = initialChannels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    enabled: channel.enabled,
    sla_minutes: channel.slaMinutes,
    auto_reply: channel.autoReply,
    priority: channel.priority,
  }))

  const workflowPayload = initialWorkflowFields.map((field) => ({
    id: field.id,
    label: field.label,
    field_type: field.fieldType,
    required: field.required,
    options: field.options,
  }))

  const permissionPayload = initialPermissions.map((profile) => ({
    id: profile.id,
    role: profile.role,
    can_edit_boards: profile.canEditBoards,
    can_route_leads: profile.canRouteLeads,
    can_manage_users: profile.canManageUsers,
    can_view_tv_panel: profile.canViewTvPanel,
  }))

  const notificationPayload = initialNotifications.map((rule) => ({
    id: rule.id,
    name: rule.name,
    channel: rule.channel,
    enabled: rule.enabled,
    trigger: rule.trigger,
  }))

  const metricPayload = initialMetrics
  const tvWidgetPayload = initialTvWidgets.map((widget) => ({
    id: widget.id,
    title: widget.title,
    widget_type: widget.widgetType,
    metric_key: widget.metricKey,
    enabled: widget.enabled,
    position: widget.position,
  }))
  const dashboardWidgetPayload = initialDashboardWidgets

  const pipelineRes = await client.from('pipelines').upsert(pipelinePayload)
  if (pipelineRes.error) throw pipelineRes.error

  const stageRes = await client.from('pipeline_stages').upsert(stagePayload)
  if (stageRes.error) throw stageRes.error

  const leadRes = await client.from('leads').upsert(leadPayload)
  if (leadRes.error) throw leadRes.error

  const interactionRes = await client.from('interactions').upsert(interactionPayload)
  if (interactionRes.error) throw interactionRes.error

  const channelRes = await client.from('channel_configs').upsert(channelPayload)
  if (channelRes.error) throw channelRes.error

  const workflowRes = await client.from('workflow_fields').upsert(workflowPayload)
  if (workflowRes.error) throw workflowRes.error

  const permissionRes = await client.from('permission_profiles').upsert(permissionPayload)
  if (permissionRes.error) throw permissionRes.error

  const notificationRes = await client.from('notification_rules').upsert(notificationPayload)
  if (notificationRes.error) throw notificationRes.error

  const metricRes = await client.from('metric_configs').upsert(metricPayload)
  if (metricRes.error) throw metricRes.error

  const tvWidgetRes = await client.from('tv_widgets').upsert(tvWidgetPayload)
  if (tvWidgetRes.error) throw tvWidgetRes.error

  const dashboardWidgetRes = await client.from('dashboard_widgets').upsert(dashboardWidgetPayload)
  if (dashboardWidgetRes.error) throw dashboardWidgetRes.error
}

export const updateLeadStage = async (leadId: string, stageId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('leads').update({ stage_id: stageId }).eq('id', leadId)
  if (error) throw error
}

export const saveLeadOrdering = async (
  leadId: string,
  payload: { stageId: string; position: number },
): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client
    .from('leads')
    .update({ stage_id: payload.stageId, position: payload.position })
    .eq('id', leadId)
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
    position: lead.position,
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

export const saveChannelConfig = async (channel: ChannelConfig): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('channel_configs').upsert({
    id: channel.id,
    name: channel.name,
    enabled: channel.enabled,
    sla_minutes: channel.slaMinutes,
    auto_reply: channel.autoReply,
    priority: channel.priority,
  })
  if (error) throw error
}

export const saveMetricConfig = async (metric: MetricConfig): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('metric_configs').upsert(metric)
  if (error) throw error
}

export const saveWorkflowField = async (field: WorkflowField): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('workflow_fields').upsert({
    id: field.id,
    label: field.label,
    field_type: field.fieldType,
    required: field.required,
    options: field.options,
  })
  if (error) throw error
}

export const savePermissionProfile = async (profile: PermissionProfile): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('permission_profiles').upsert({
    id: profile.id,
    role: profile.role,
    can_edit_boards: profile.canEditBoards,
    can_route_leads: profile.canRouteLeads,
    can_manage_users: profile.canManageUsers,
    can_view_tv_panel: profile.canViewTvPanel,
  })
  if (error) throw error
}

export const saveNotificationRule = async (rule: NotificationRule): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('notification_rules').upsert(rule)
  if (error) throw error
}

export const savePipelineConfig = async (pipeline: Pipeline): Promise<void> => {
  const client = assertSupabase()
  const pipelineRes = await client.from('pipelines').upsert({ id: pipeline.id, name: pipeline.name })
  if (pipelineRes.error) throw pipelineRes.error

  const stagePayload = pipeline.stages.map((stage, index) => ({
    id: stage.id,
    pipeline_id: pipeline.id,
    name: stage.name,
    position: index,
  }))
  const stageRes = await client.from('pipeline_stages').upsert(stagePayload)
  if (stageRes.error) throw stageRes.error
}

export const deletePipelineConfig = async (pipelineId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('pipelines').delete().eq('id', pipelineId)
  if (error) throw error
}

export const deleteStageConfig = async (stageId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('pipeline_stages').delete().eq('id', stageId)
  if (error) throw error
}

export const deleteChannelConfig = async (channelId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('channel_configs').delete().eq('id', channelId)
  if (error) throw error
}

export const deleteMetricConfig = async (metricId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('metric_configs').delete().eq('id', metricId)
  if (error) throw error
}

export const deleteWorkflowField = async (fieldId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('workflow_fields').delete().eq('id', fieldId)
  if (error) throw error
}

export const deleteNotificationRule = async (ruleId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('notification_rules').delete().eq('id', ruleId)
  if (error) throw error
}

export const deletePermissionProfile = async (profileId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('permission_profiles').delete().eq('id', profileId)
  if (error) throw error
}

export const saveAppUser = async (user: AppUser): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('app_users').upsert(user)
  if (error) throw error
}

export const deleteAppUser = async (userId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('app_users').delete().eq('id', userId)
  if (error) throw error
}

export const saveTvWidget = async (widget: TvWidget): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('tv_widgets').upsert({
    id: widget.id,
    title: widget.title,
    widget_type: widget.widgetType,
    metric_key: widget.metricKey,
    enabled: widget.enabled,
    position: widget.position,
  })
  if (error) throw error
}

export const deleteTvWidget = async (widgetId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('tv_widgets').delete().eq('id', widgetId)
  if (error) throw error
}

export const saveDashboardWidget = async (widget: DashboardWidget): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('dashboard_widgets').upsert(widget)
  if (error) throw error
}

export const deleteDashboardWidget = async (widgetId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('dashboard_widgets').delete().eq('id', widgetId)
  if (error) throw error
}

export const loadAuditLogs = async (limit = 120): Promise<AuditLogEntry[]> => {
  const client = assertSupabase()
  const { data, error } = await client
    .from('audit_logs')
    .select('id, actor_id, actor_email, action, target_table, target_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    action: row.action,
    targetTable: row.target_table,
    targetId: row.target_id,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  }))
}
