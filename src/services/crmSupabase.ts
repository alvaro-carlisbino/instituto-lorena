import {
  initialAutomationRules,
  initialDashboardWidgets,
  initialAppUsers,
  initialChannels,
  initialDataViews,
  initialInteractions,
  initialLeadTasks,
  initialLeads,
  initialLeadTagDefinitions,
  initialRooms,
  initialAppointments,
  initialMetrics,
  initialNotifications,
  initialOrgSettings,
  initialPermissions,
  initialSurveyDispatches,
  initialSurveyResponses,
  initialSurveyTemplates,
  initialTvWidgets,
  initialWorkflowFields,
  pipelines,
  sdrTeam,
} from '../mocks/crmMock'
import type {
  AppUser,
  AutomationRule,
  ChannelConfig,
  DashboardWidget,
  DataView,
  FieldVisibilityContext,
  Interaction,
  Lead,
  LeadTagDefinition,
  LeadTask,
  Room,
  Appointment,
  MetricConfig,
  NotificationRule,
  OrgSettings,
  PermissionProfile,
  Pipeline,
  Sdr,
  SurveyDispatch,
  SurveyResponse,
  SurveyTemplate,
  TvWidget,
  WorkflowField,
  WorkflowFieldOption,
} from '../mocks/crmMock'
import { defaultVisibleInAll } from '../lib/leadFields'
import { supabase } from '../lib/supabaseClient'

/** Alinha papel do banco (ex.: casing) ao union usado no app. */
const normalizeAppRole = (raw: string): PermissionProfile['role'] => {
  const r = String(raw ?? '').trim().toLowerCase()
  if (r === 'admin' || r === 'gestor' || r === 'sdr') return r
  return 'sdr'
}

type DbPipeline = { id: string; name: string; board_config?: Record<string, unknown> | null }
type DbStage = { id: string; pipeline_id: string; name: string; position: number }
type DbUser = {
  id: string
  name: string
  email?: string | null
  auth_user_id?: string | null
  active: boolean
  role: string
}
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
  custom_fields?: Record<string, unknown> | null
  whatsapp_instance_id?: string | null
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
  external_message_id?: string | null
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
  dataViews: DataView[]
  orgSettings: OrgSettings
  leadTasks: LeadTask[]
  automationRules: AutomationRule[]
  surveyTemplates: SurveyTemplate[]
  surveyDispatches: SurveyDispatch[]
  surveyResponses: SurveyResponse[]
  leadTagDefinitions: LeadTagDefinition[]
  rooms: Room[]
  appointments: Appointment[]
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

export type WebhookJob = {
  id: string
  source: 'meta-webhook' | 'whatsapp-webhook' | 'ai-triage'
  status: 'queued' | 'processing' | 'retry' | 'done'
  note: string
  createdAt: string
}

const assertSupabase = () => {
  if (!supabase) throw new Error('Sistema não está configurado.')
  return supabase
}

const normalizeChannelDriver = (raw: unknown): ChannelConfig['driver'] => {
  const d = String(raw ?? 'manual').toLowerCase()
  if (d === 'meta' || d === 'whatsapp' || d === 'webhook' || d === 'manual') return d
  return 'manual'
}

const mapWorkflowFromDb = (row: Record<string, unknown>): WorkflowField => {
  const visibleRaw = row.visible_in
  const visibleIn: FieldVisibilityContext[] = Array.isArray(visibleRaw)
    ? (visibleRaw.filter((v) =>
        ['kanban_card', 'lead_detail', 'list', 'capture_form'].includes(String(v)),
      ) as FieldVisibilityContext[])
    : defaultVisibleInAll

  return {
    id: String(row.id),
    fieldKey: String(row.field_key ?? row.id),
    label: String(row.label),
    fieldType: (['text', 'select', 'number', 'date'].includes(String(row.field_type))
      ? row.field_type
      : 'text') as WorkflowField['fieldType'],
    required: Boolean(row.required),
    options: Array.isArray(row.options) ? (row.options as WorkflowFieldOption[]) : [],
    section: String(row.section ?? ''),
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order) || 0,
    visibleIn: visibleIn.length ? visibleIn : defaultVisibleInAll,
    validation: (row.validation && typeof row.validation === 'object' ? row.validation : {}) as Record<string, unknown>,
  }
}

const mapLeadTaskFromDb = (row: Record<string, unknown>): LeadTask => ({
  id: String(row.id),
  leadId: String(row.lead_id),
  title: String(row.title),
  assigneeId: row.assignee_id != null && String(row.assignee_id).length > 0 ? String(row.assignee_id) : null,
  dueAt: row.due_at != null ? String(row.due_at) : null,
  status: (['open', 'done', 'cancelled'].includes(String(row.status)) ? row.status : 'open') as LeadTask['status'],
  taskType: String(row.task_type ?? 'follow_up'),
  metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>,
  createdAt: String(row.created_at ?? new Date().toISOString()),
  sortOrder: typeof row.sort_order === 'number' ? row.sort_order : Number(row.sort_order) || 0,
})

const mapAutomationFromDb = (row: Record<string, unknown>): AutomationRule => ({
  id: String(row.id),
  name: String(row.name),
  enabled: Boolean(row.enabled),
  triggerType: String(row.trigger_type ?? ''),
  triggerConfig: (row.trigger_config && typeof row.trigger_config === 'object' ? row.trigger_config : {}) as Record<
    string,
    unknown
  >,
  actionType: String(row.action_type ?? ''),
  actionConfig: (row.action_config && typeof row.action_config === 'object' ? row.action_config : {}) as Record<
    string,
    unknown
  >,
})

const mapSurveyTemplateFromDb = (row: Record<string, unknown>): SurveyTemplate => ({
  id: String(row.id),
  name: String(row.name),
  npsQuestion: String(row.nps_question ?? ''),
  enabled: Boolean(row.enabled),
})

const mapSurveyDispatchFromDb = (row: Record<string, unknown>): SurveyDispatch => ({
  id: String(row.id),
  templateId: String(row.template_id),
  leadId: String(row.lead_id),
  sentAt: String(row.sent_at ?? new Date().toISOString()),
  channel: String(row.channel ?? 'in_app'),
})

const mapSurveyResponseFromDb = (row: Record<string, unknown>): SurveyResponse => ({
  id: String(row.id),
  dispatchId: String(row.dispatch_id),
  score: Number(row.score) || 0,
  comment: row.comment != null ? String(row.comment) : null,
  respondedAt: String(row.responded_at ?? new Date().toISOString()),
})

export const loadCrmData = async (): Promise<CrmDataSnapshot> => {
  const client = assertSupabase()

  const [
    pipelinesRes,
    stagesRes,
    usersRes,
    leadsRes,
    interactionsRes,
    channelsRes,
    metricsRes,
    workflowRes,
    permissionsRes,
    notificationsRes,
    tvWidgetsRes,
    dashboardWidgetsRes,
    dataViewsRes,
    orgSettingsRes,
    mediaItemsRes,
  ] = await Promise.all([
    client.from('pipelines').select('id, name, board_config').order('name', { ascending: true }),
    client.from('pipeline_stages').select('id, pipeline_id, name, position').order('position', { ascending: true }),
    client.from('app_users').select('id, name, email, auth_user_id, active, role').order('name', { ascending: true }),
    client
      .from('leads')
      .select(
        'id, patient_name, phone, source, created_at, position, score, temperature, owner_id, pipeline_id, stage_id, summary, custom_fields, whatsapp_instance_id',
      )
      .order('position', { ascending: true }),
    client
      .from('interactions')
      .select('id, lead_id, patient_name, channel, direction, author, content, happened_at, external_message_id')
      .order('happened_at', { ascending: false }),
    client
      .from('channel_configs')
      .select('id, name, enabled, sla_minutes, auto_reply, priority, driver, field_mapping, credentials_ref')
      .order('priority', { ascending: true }),
    client.from('metric_configs').select('id, label, value, target, unit').order('label', { ascending: true }),
    client
      .from('workflow_fields')
      .select('id, label, field_type, required, options, field_key, section, sort_order, visible_in, validation')
      .order('sort_order', { ascending: true }),
    client
      .from('permission_profiles')
      .select('id, role, can_edit_boards, can_route_leads, can_manage_users, can_view_tv_panel')
      .order('role', { ascending: true }),
    client.from('notification_rules').select('id, name, channel, enabled, trigger').order('name', { ascending: true }),
    client.from('tv_widgets').select('id, title, widget_type, metric_key, enabled, position, layout, widget_config').order('position', { ascending: true }),
    client
      .from('dashboard_widgets')
      .select('id, title, metric_key, enabled, position, layout, widget_config')
      .order('position', { ascending: true }),
    client.from('data_views').select('id, name, config').order('name', { ascending: true }),
    client.from('org_settings').select('id, timezone, date_format, week_starts_on').eq('id', 'default').maybeSingle(),
    client.from('crm_media_items').select('id, interaction_id, media_type, mime_type, media_base64, metadata'),
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
  if (dataViewsRes.error) throw dataViewsRes.error
  if (orgSettingsRes.error) throw orgSettingsRes.error
  if (mediaItemsRes.error) throw mediaItemsRes.error

  const [tasksRes, rulesRes, tmplRes, dispRes, respRes, tagAssignRes] = await Promise.all([
    client
      .from('lead_tasks')
      .select('id, lead_id, title, assignee_id, due_at, status, task_type, metadata, created_at, sort_order')
      .order('sort_order', { ascending: true })
      .order('due_at', { ascending: true }),
    client.from('automation_rules').select('id, name, enabled, trigger_type, trigger_config, action_type, action_config'),
    client.from('survey_templates').select('id, name, nps_question, enabled'),
    client.from('survey_dispatches').select('id, template_id, lead_id, sent_at, channel'),
    client.from('survey_responses').select('id, dispatch_id, score, comment, responded_at'),
    client.from('lead_tag_assignments').select('lead_id, tag_id'),
  ])

  const builtLeadTasks: LeadTask[] = !tasksRes.error
    ? ((tasksRes.data ?? []) as Record<string, unknown>[]).map(mapLeadTaskFromDb)
    : initialLeadTasks
  const builtAutomationRules: AutomationRule[] = !rulesRes.error
    ? ((rulesRes.data ?? []) as Record<string, unknown>[]).map(mapAutomationFromDb)
    : initialAutomationRules
  const builtSurveyTemplates: SurveyTemplate[] = !tmplRes.error
    ? ((tmplRes.data ?? []) as Record<string, unknown>[]).map(mapSurveyTemplateFromDb)
    : initialSurveyTemplates
  const builtSurveyDispatches: SurveyDispatch[] = !dispRes.error
    ? ((dispRes.data ?? []) as Record<string, unknown>[]).map(mapSurveyDispatchFromDb)
    : initialSurveyDispatches
  const builtSurveyResponses: SurveyResponse[] = !respRes.error
    ? ((respRes.data ?? []) as Record<string, unknown>[]).map(mapSurveyResponseFromDb)
    : initialSurveyResponses

  const tagIdsByLead = new Map<string, string[]>()
  if (!tagAssignRes.error && tagAssignRes.data) {
    for (const row of tagAssignRes.data as { lead_id: string; tag_id: string }[]) {
      const lid = String(row.lead_id)
      const t = String(row.tag_id)
      const list = tagIdsByLead.get(lid) ?? []
      list.push(t)
      tagIdsByLead.set(lid, list)
    }
  }

  const pipelineRows = (pipelinesRes.data ?? []) as DbPipeline[]
  const stageRows = (stagesRes.data ?? []) as DbStage[]
  const userRows = (usersRes.data ?? []) as DbUser[]
  const leadRows = (leadsRes.data ?? []) as DbLead[]
  const interactionRows = (interactionsRes.data ?? []) as DbInteraction[]

  const builtPipelines: Pipeline[] = pipelineRows.length
    ? pipelineRows.map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        boardConfig: (pipeline.board_config && typeof pipeline.board_config === 'object'
          ? (pipeline.board_config as Pipeline['boardConfig'])
          : {}) as Pipeline['boardConfig'],
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
        customFields: (lead.custom_fields && typeof lead.custom_fields === 'object' ? lead.custom_fields : {}) as Record<
          string,
          unknown
        >,
        whatsappInstanceId: lead.whatsapp_instance_id != null && String(lead.whatsapp_instance_id).length > 0
          ? String(lead.whatsapp_instance_id)
          : null,
        tagIds: tagIdsByLead.get(lead.id) ?? [],
      }))
    : initialLeads

  const mediaByInteraction = new Map<string, Interaction['media']>()
  if (mediaItemsRes.data) {
    for (const row of mediaItemsRes.data) {
      const iid = String(row.interaction_id)
      if (!iid || iid === 'null') continue
      const list = mediaByInteraction.get(iid) ?? []
      list.push({
        id: String(row.id),
        type: row.media_type as any,
        mimeType: row.mime_type,
        base64: row.media_base64,
        caption: (row.metadata as any)?.caption,
      })
      mediaByInteraction.set(iid, list)
    }
  }

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
        externalMessageId: interaction.external_message_id || undefined,
        media: mediaByInteraction.get(interaction.id),
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
        driver: normalizeChannelDriver(row.driver),
        fieldMapping: (row.field_mapping && typeof row.field_mapping === 'object'
          ? (row.field_mapping as Record<string, string>)
          : {}) as Record<string, string>,
        credentialsRef: String(row.credentials_ref ?? ''),
      }))
    : initialChannels

  const builtMetrics: MetricConfig[] = (metricsRes.data ?? []).length
    ? (metricsRes.data ?? [])
    : initialMetrics

  const builtWorkflowFields: WorkflowField[] = (workflowRes.data ?? []).length
    ? (workflowRes.data ?? []).map((row) => mapWorkflowFromDb(row as Record<string, unknown>))
    : initialWorkflowFields

  const builtPermissions: PermissionProfile[] = (permissionsRes.data ?? []).length
    ? (permissionsRes.data ?? []).map((row) => ({
        id: row.id,
        role: normalizeAppRole(row.role),
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
        email: row.email ?? '',
        role: normalizeAppRole(row.role),
        active: row.active,
        authUserId: row.auth_user_id ?? null,
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
        layout: (row.layout && typeof row.layout === 'object' ? row.layout : {}) as Record<string, unknown>,
        widgetConfig: (row.widget_config && typeof row.widget_config === 'object' ? row.widget_config : {}) as Record<
          string,
          unknown
        >,
      }))
    : initialTvWidgets

  const builtDashboardWidgets: DashboardWidget[] = (dashboardWidgetsRes.data ?? []).length
    ? (dashboardWidgetsRes.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        metricKey: row.metric_key,
        enabled: row.enabled,
        position: row.position,
        layout: (row.layout && typeof row.layout === 'object' ? row.layout : {}) as Record<string, unknown>,
        widgetConfig: (row.widget_config && typeof row.widget_config === 'object' ? row.widget_config : {}) as Record<
          string,
          unknown
        >,
      }))
    : initialDashboardWidgets

  const builtDataViews: DataView[] = (dataViewsRes.data ?? []).length
    ? (dataViewsRes.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        config: (row.config && typeof row.config === 'object' ? row.config : {}) as DataView['config'],
      }))
    : initialDataViews

  const orgRow = orgSettingsRes.data as Record<string, unknown> | null
  const builtOrgSettings: OrgSettings = orgRow
    ? {
        id: String(orgRow.id ?? 'default'),
        timezone: String(orgRow.timezone ?? initialOrgSettings.timezone),
        dateFormat: String(orgRow.date_format ?? initialOrgSettings.dateFormat),
        weekStartsOn: typeof orgRow.week_starts_on === 'number' ? orgRow.week_starts_on : Number(orgRow.week_starts_on) || 1,
      }
    : initialOrgSettings

  const [tagDefRes, roomsRes, apptRes] = await Promise.all([
    client.from('lead_tag_definitions').select('id, name, color, created_at').order('name', { ascending: true }),
    client.from('rooms').select('id, name, active, slot_minutes, sort_order, created_at').order('sort_order', { ascending: true }),
    client
      .from('appointments')
      .select('id, lead_id, room_id, starts_at, ends_at, status, attendance_status, notes, created_at, updated_at')
      .order('starts_at', { ascending: true })
      .limit(500),
  ])

  const builtTagDefs: LeadTagDefinition[] = !tagDefRes.error
    ? ((tagDefRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        color: String(r.color ?? '#6366f1'),
        createdAt: String(r.created_at ?? new Date().toISOString()),
      }))
    : initialLeadTagDefinitions

  const builtRooms: Room[] = !roomsRes.error
    ? ((roomsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        name: String(r.name),
        active: r.active !== false,
        slotMinutes: typeof r.slot_minutes === 'number' ? r.slot_minutes : Number(r.slot_minutes) || 30,
        sortOrder: typeof r.sort_order === 'number' ? r.sort_order : Number(r.sort_order) || 0,
        createdAt: String(r.created_at ?? new Date().toISOString()),
      }))
    : initialRooms

  const builtAppointments: Appointment[] = !apptRes.error
    ? ((apptRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        leadId: String(r.lead_id),
        roomId: String(r.room_id),
        startsAt: String(r.starts_at),
        endsAt: String(r.ends_at),
        status: (['draft', 'confirmed', 'cancelled'].includes(String(r.status)) ? r.status : 'confirmed') as Appointment['status'],
        attendanceStatus: (['expected', 'checked_in', 'no_show'].includes(String(r.attendance_status))
          ? r.attendance_status
          : 'expected') as Appointment['attendanceStatus'],
        notes: r.notes != null && String(r.notes).length ? String(r.notes) : null,
        createdAt: String(r.created_at ?? new Date().toISOString()),
        updatedAt: String(r.updated_at ?? r.created_at ?? new Date().toISOString()),
      }))
    : initialAppointments

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
    dataViews: builtDataViews,
    orgSettings: builtOrgSettings,
    leadTasks: builtLeadTasks,
    automationRules: builtAutomationRules,
    surveyTemplates: builtSurveyTemplates,
    surveyDispatches: builtSurveyDispatches,
    surveyResponses: builtSurveyResponses,
    leadTagDefinitions: builtTagDefs,
    rooms: builtRooms,
    appointments: builtAppointments,
  }
}

export type ChatSlice = {
  leads: Lead[]
  interactions: Interaction[]
}

export const loadChatSliceFromSupabase = async (): Promise<ChatSlice> => {
  const client = assertSupabase()
  const [leadsRes, interactionsRes, tagAssignRes, mediaRes] = await Promise.all([
    client
      .from('leads')
      .select(
        'id, patient_name, phone, source, created_at, position, score, temperature, owner_id, pipeline_id, stage_id, summary, custom_fields, whatsapp_instance_id',
      )
      .order('position', { ascending: true }),
    client
      .from('interactions')
      .select('id, lead_id, patient_name, channel, direction, author, content, happened_at, external_message_id')
      .order('happened_at', { ascending: false })
      .limit(3200),
    client.from('lead_tag_assignments').select('lead_id, tag_id'),
    client.from('crm_media_items').select('id, interaction_id, media_type, mime_type, media_base64, metadata'),
  ])
  if (leadsRes.error) throw leadsRes.error
  if (interactionsRes.error) throw interactionsRes.error

  const leadRows = (leadsRes.data ?? []) as DbLead[]
  const interactionRows = (interactionsRes.data ?? []) as DbInteraction[]

  const tagIdsByLead = new Map<string, string[]>()
  if (!tagAssignRes.error && tagAssignRes.data) {
    for (const row of tagAssignRes.data as { lead_id: string; tag_id: string }[]) {
      const lid = String(row.lead_id)
      const t = String(row.tag_id)
      const list = tagIdsByLead.get(lid) ?? []
      list.push(t)
      tagIdsByLead.set(lid, list)
    }
  }

  const builtLeads: Lead[] = leadRows.map((lead) => ({
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
    customFields: (lead.custom_fields && typeof lead.custom_fields === 'object' ? lead.custom_fields : {}) as Record<
      string,
      unknown
    >,
    whatsappInstanceId: lead.whatsapp_instance_id != null && String(lead.whatsapp_instance_id).length > 0
      ? String(lead.whatsapp_instance_id)
      : null,
    tagIds: tagIdsByLead.get(lead.id) ?? [],
  }))

  const mediaByInteraction = new Map<string, Interaction['media']>()
  if (!mediaRes.error && mediaRes.data) {
    for (const row of mediaRes.data) {
      const iid = String(row.interaction_id)
      if (!iid) continue
      const list = mediaByInteraction.get(iid) ?? []
      list.push({
        id: String(row.id),
        type: row.media_type as any,
        mimeType: row.mime_type,
        base64: row.media_base64,
        caption: (row.metadata as any)?.caption,
      })
      mediaByInteraction.set(iid, list)
    }
  }

  const builtInteractions: Interaction[] = interactionRows.map((interaction) => ({
    id: interaction.id,
    leadId: interaction.lead_id,
    patientName: interaction.patient_name,
    channel: interaction.channel,
    direction: interaction.direction,
    author: interaction.author,
    content: interaction.content,
    happenedAt: interaction.happened_at,
    externalMessageId: interaction.external_message_id || undefined,
    media: mediaByInteraction.get(interaction.id),
  }))

  return { leads: builtLeads, interactions: builtInteractions }
}

export type RoomsAndAppointmentsSlice = {
  rooms: Room[]
  appointments: Appointment[]
}

/** Salas + marcações para atualizar a agenda sem refazer o snapshot completo do CRM. */
export const loadRoomsAndAppointmentsFromSupabase = async (): Promise<RoomsAndAppointmentsSlice> => {
  const client = assertSupabase()
  const [roomsRes, apptRes] = await Promise.all([
    client.from('rooms').select('id, name, active, slot_minutes, sort_order, created_at').order('sort_order', { ascending: true }),
    client
      .from('appointments')
      .select('id, lead_id, room_id, starts_at, ends_at, status, attendance_status, notes, created_at, updated_at')
      .order('starts_at', { ascending: true })
      .limit(500),
  ])
  if (roomsRes.error) throw roomsRes.error
  if (apptRes.error) throw apptRes.error

  const builtRooms: Room[] = ((roomsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    active: r.active !== false,
    slotMinutes: typeof r.slot_minutes === 'number' ? r.slot_minutes : Number(r.slot_minutes) || 30,
    sortOrder: typeof r.sort_order === 'number' ? r.sort_order : Number(r.sort_order) || 0,
    createdAt: String(r.created_at ?? new Date().toISOString()),
  }))

  const builtAppointments: Appointment[] = ((apptRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    leadId: String(r.lead_id),
    roomId: String(r.room_id),
    startsAt: String(r.starts_at),
    endsAt: String(r.ends_at),
    status: (['draft', 'confirmed', 'cancelled'].includes(String(r.status)) ? r.status : 'confirmed') as Appointment['status'],
    attendanceStatus: (['expected', 'checked_in', 'no_show'].includes(String(r.attendance_status))
      ? r.attendance_status
      : 'expected') as Appointment['attendanceStatus'],
    notes: r.notes != null && String(r.notes).length ? String(r.notes) : null,
    createdAt: String(r.created_at ?? new Date().toISOString()),
    updatedAt: String(r.updated_at ?? r.created_at ?? new Date().toISOString()),
  }))

  return { rooms: builtRooms, appointments: builtAppointments }
}

export const seedTestUsers = async (): Promise<void> => {
  const client = assertSupabase()
  const payload = [
    { id: 'sdr-1', name: 'Ana Costa', email: 'ana@institutolorena.com', role: 'sdr', active: true },
    { id: 'sdr-2', name: 'Bruno Lima', email: 'bruno@institutolorena.com', role: 'sdr', active: true },
    { id: 'sdr-3', name: 'Carla Souza', email: 'carla@institutolorena.com', role: 'sdr', active: true },
    { id: 'gestor-1', name: 'Diego Moura', email: 'diego@institutolorena.com', role: 'gestor', active: true },
  ]
  const { error } = await client.from('app_users').upsert(payload)
  if (error) throw error
}

export const seedDemoData = async (): Promise<void> => {
  const client = assertSupabase()

  const pipelinePayload = pipelines.map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    board_config: pipeline.boardConfig ?? {},
  }))
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
    custom_fields: lead.customFields ?? {},
    whatsapp_instance_id: lead.whatsappInstanceId,
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
    driver: channel.driver,
    field_mapping: channel.fieldMapping,
    credentials_ref: channel.credentialsRef,
  }))

  const workflowPayload = initialWorkflowFields.map((field) => ({
    id: field.id,
    label: field.label,
    field_type: field.fieldType,
    required: field.required,
    options: field.options,
    field_key: field.fieldKey,
    section: field.section,
    sort_order: field.sortOrder,
    visible_in: field.visibleIn,
    validation: field.validation,
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
    layout: widget.layout ?? {},
    widget_config: widget.widgetConfig ?? {},
  }))
  const dashboardWidgetPayload = initialDashboardWidgets.map((widget) => ({
    id: widget.id,
    title: widget.title,
    metric_key: widget.metricKey,
    enabled: widget.enabled,
    position: widget.position,
    layout: widget.layout ?? {},
    widget_config: widget.widgetConfig ?? {},
  }))

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

  const surveyTemplatePayload = initialSurveyTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    nps_question: t.npsQuestion,
    enabled: t.enabled,
  }))
  const surveyTRes = await client.from('survey_templates').upsert(surveyTemplatePayload)
  if (surveyTRes.error) throw surveyTRes.error

  const automationPayload = initialAutomationRules.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger_type: r.triggerType,
    trigger_config: r.triggerConfig,
    action_type: r.actionType,
    action_config: r.actionConfig,
  }))
  const autoRes = await client.from('automation_rules').upsert(automationPayload)
  if (autoRes.error) throw autoRes.error

  const taskPayload = initialLeadTasks.map((t) => ({
    id: t.id,
    lead_id: t.leadId,
    title: t.title,
    assignee_id: t.assigneeId,
    due_at: t.dueAt,
    status: t.status,
    task_type: t.taskType,
    metadata: t.metadata ?? {},
    created_at: t.createdAt,
    sort_order: t.sortOrder,
  }))
  const taskRes = await client.from('lead_tasks').upsert(taskPayload)
  if (taskRes.error) throw taskRes.error
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
    custom_fields: lead.customFields ?? {},
    whatsapp_instance_id: lead.whatsappInstanceId,
  })
  if (error) throw error
}

export const persistLead = async (lead: Lead): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('leads').upsert(
    {
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
      custom_fields: lead.customFields ?? {},
      whatsapp_instance_id: lead.whatsappInstanceId,
    },
    { onConflict: 'id' },
  )
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

export const updateInteractionContent = async (interactionId: string, content: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('interactions').update({ content }).eq('id', interactionId)
  if (error) throw error
}

export const deleteInteractionRow = async (interactionId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('interactions').delete().eq('id', interactionId)
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
    driver: channel.driver,
    field_mapping: channel.fieldMapping,
    credentials_ref: channel.credentialsRef,
  })
  if (error) throw error
}

export const saveMetricConfig = async (metric: MetricConfig): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('metric_configs').upsert(metric)
  if (error) throw error
}

export const deleteLead = async (leadId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('leads').delete().eq('id', leadId)
  if (error) throw new Error(error.message)
}

export const saveLeadTask = async (task: LeadTask): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('lead_tasks').upsert({
    id: task.id,
    lead_id: task.leadId,
    title: task.title,
    assignee_id: task.assigneeId,
    due_at: task.dueAt,
    status: task.status,
    task_type: task.taskType,
    metadata: task.metadata ?? {},
    created_at: task.createdAt,
    sort_order: task.sortOrder,
  })
  if (error) throw error
}

export const deleteLeadTask = async (taskId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('lead_tasks').delete().eq('id', taskId)
  if (error) throw error
}

export const saveSurveyResponse = async (row: SurveyResponse): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('survey_responses').upsert({
    id: row.id,
    dispatch_id: row.dispatchId,
    score: row.score,
    comment: row.comment,
    responded_at: row.respondedAt,
  })
  if (error) throw error
}

export const saveSurveyDispatch = async (row: SurveyDispatch): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('survey_dispatches').upsert({
    id: row.id,
    template_id: row.templateId,
    lead_id: row.leadId,
    sent_at: row.sentAt,
    channel: row.channel,
  })
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
    field_key: field.fieldKey,
    section: field.section,
    sort_order: field.sortOrder,
    visible_in: field.visibleIn,
    validation: field.validation,
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

export const saveAutomationRule = async (rule: AutomationRule): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('automation_rules').upsert({
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    trigger_type: rule.triggerType,
    trigger_config: rule.triggerConfig,
    action_type: rule.actionType,
    action_config: rule.actionConfig,
  })
  if (error) throw error
}

export const deleteAutomationRule = async (ruleId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('automation_rules').delete().eq('id', ruleId)
  if (error) throw error
}

export const savePipelineConfig = async (pipeline: Pipeline): Promise<void> => {
  const client = assertSupabase()
  const pipelineRes = await client
    .from('pipelines')
    .upsert({ id: pipeline.id, name: pipeline.name, board_config: pipeline.boardConfig ?? {} })
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
  const { error } = await client.from('app_users').upsert({
    id: user.id,
    name: user.name,
    email: user.email ?? '',
    role: user.role,
    active: user.active,
    auth_user_id: user.authUserId ?? null,
  })
  if (error) throw error
}

/** Reatribui leads antes de apagar (FK owner_id → app_users). */
export const deleteAppUser = async (userId: string, reassignOwnerId?: string): Promise<void> => {
  const client = assertSupabase()
  if (reassignOwnerId && reassignOwnerId !== userId) {
    const { error: reassignErr } = await client.from('leads').update({ owner_id: reassignOwnerId }).eq('owner_id', userId)
    if (reassignErr) throw reassignErr
  }
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
    layout: widget.layout ?? {},
    widget_config: widget.widgetConfig ?? {},
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
  const { error } = await client.from('dashboard_widgets').upsert({
    id: widget.id,
    title: widget.title,
    metric_key: widget.metricKey,
    enabled: widget.enabled,
    position: widget.position,
    layout: widget.layout ?? {},
    widget_config: widget.widgetConfig ?? {},
  })
  if (error) throw error
}

export const saveDataView = async (view: DataView): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('data_views').upsert({
    id: view.id,
    name: view.name,
    config: view.config,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

export const deleteDataView = async (viewId: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('data_views').delete().eq('id', viewId)
  if (error) throw error
}

export const saveOrgSettings = async (settings: OrgSettings): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('org_settings').upsert({
    id: settings.id,
    timezone: settings.timezone,
    date_format: settings.dateFormat,
    week_starts_on: settings.weekStartsOn,
    updated_at: new Date().toISOString(),
  })
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

export const loadAuditLogsPage = async (params: {
  page: number
  pageSize: number
  action?: 'INSERT' | 'UPDATE' | 'DELETE'
  targetTable?: string
  sinceIso?: string
}): Promise<{ rows: AuditLogEntry[]; total: number }> => {
  const client = assertSupabase()
  const from = params.page * params.pageSize
  const to = from + params.pageSize - 1

  let query = client
    .from('audit_logs')
    .select('id, actor_id, actor_email, action, target_table, target_id, metadata, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (params.action) query = query.eq('action', params.action)
  if (params.targetTable) query = query.eq('target_table', params.targetTable)
  if (params.sinceIso) query = query.gte('created_at', params.sinceIso)

  const { data, error, count } = await query
  if (error) throw error

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    action: row.action,
    targetTable: row.target_table,
    targetId: row.target_id,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  }))

  return { rows, total: count ?? 0 }
}

export const loadWebhookJobs = async (limit = 40): Promise<WebhookJob[]> => {
  const client = assertSupabase()
  const { data, error } = await client
    .from('webhook_jobs')
    .select('id, source, status, note, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    source: row.source,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
  }))
}

export const createWebhookReplayJob = async (payload: {
  source: WebhookJob['source']
  note: string
}): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('webhook_jobs').insert({
    source: payload.source,
    status: 'queued',
    note: payload.note,
  })
  if (error) throw error
}

export const upsertLeadTagDefinition = async (row: LeadTagDefinition): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('lead_tag_definitions').upsert({
    id: row.id,
    name: row.name,
    color: row.color,
    created_at: row.createdAt,
  })
  if (error) throw error
}

export const setLeadTagIdsForLead = async (leadId: string, tagIds: string[]): Promise<void> => {
  const client = assertSupabase()
  const { error: delErr } = await client.from('lead_tag_assignments').delete().eq('lead_id', leadId)
  if (delErr) throw delErr
  if (tagIds.length === 0) return
  const { error } = await client.from('lead_tag_assignments').insert(
    tagIds.map((tagId) => ({ lead_id: leadId, tag_id: tagId })),
  )
  if (error) throw error
}

export const upsertRoom = async (room: Room): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('rooms').upsert({
    id: room.id,
    name: room.name,
    active: room.active,
    slot_minutes: room.slotMinutes,
    sort_order: room.sortOrder,
    created_at: room.createdAt,
  })
  if (error) throw error
}

export const upsertAppointment = async (a: Appointment): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.from('appointments').upsert({
    id: a.id,
    lead_id: a.leadId,
    room_id: a.roomId,
    starts_at: a.startsAt,
    ends_at: a.endsAt,
    status: a.status,
    attendance_status: a.attendanceStatus,
    notes: a.notes,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  }, { onConflict: 'id' })
  if (error) throw error
}

export const findFirstFreeSlot = async (params: {
  startsOn: string
  endsOn: string
  durationMinutes: number
}): Promise<{ roomId: string; slotStart: string; slotEnd: string } | null> => {
  const client = assertSupabase()
  const { data, error } = await client.rpc('find_first_appointment_slot', {
    p_starts_on: params.startsOn,
    p_ends_on: params.endsOn,
    p_duration_minutes: params.durationMinutes,
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as
    | { room_id?: string; slot_start?: string; slot_end?: string }
    | null
    | undefined
  if (!row || !row.room_id || !row.slot_start || !row.slot_end) return null
  return { roomId: String(row.room_id), slotStart: String(row.slot_start), slotEnd: String(row.slot_end) }
}
