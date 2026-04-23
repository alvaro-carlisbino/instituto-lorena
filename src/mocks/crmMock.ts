export type Stage = {
  id: string
  name: string
}

export type BoardConfig = {
  stageSlaMinutes?: Record<string, number>
  kanbanFieldOrder?: string[]
}

export type Pipeline = {
  id: string
  name: string
  stages: Stage[]
  boardConfig: BoardConfig
}

export type Sdr = {
  id: string
  name: string
  active: boolean
}

export type Lead = {
  id: string
  patientName: string
  phone: string
  source: 'meta_facebook' | 'meta_instagram' | 'whatsapp' | 'manual'
  createdAt: string
  position: number
  score: number
  temperature: 'cold' | 'warm' | 'hot'
  ownerId: string
  pipelineId: string
  stageId: string
  summary: string
  customFields: Record<string, unknown>
}

export type Interaction = {
  id: string
  leadId: string
  patientName: string
  channel: 'whatsapp' | 'meta' | 'system' | 'ai'
  direction: 'in' | 'out' | 'system'
  author: string
  content: string
  happenedAt: string
}

export type TriageResult = {
  leadId: string
  classification: 'qualified' | 'human_handoff' | 'not_qualified'
  confidence: number
  recommendation: string
}

export type ChannelDriver = 'manual' | 'meta' | 'whatsapp' | 'webhook'

export type ChannelConfig = {
  id: string
  name: string
  enabled: boolean
  slaMinutes: number
  autoReply: boolean
  priority: number
  driver: ChannelDriver
  fieldMapping: Record<string, string>
  credentialsRef: string
}

export type MetricConfig = {
  id: string
  label: string
  value: number
  target: number
  unit: 'percent' | 'minutes' | 'count'
}

export type FieldVisibilityContext = 'kanban_card' | 'lead_detail' | 'list' | 'capture_form'

export type WorkflowField = {
  id: string
  fieldKey: string
  label: string
  fieldType: 'text' | 'select' | 'number' | 'date'
  required: boolean
  options: string[]
  section: string
  sortOrder: number
  visibleIn: FieldVisibilityContext[]
  validation: Record<string, unknown>
}

export type PermissionProfile = {
  id: string
  role: 'admin' | 'gestor' | 'sdr'
  canEditBoards: boolean
  canRouteLeads: boolean
  canManageUsers: boolean
  canViewTvPanel: boolean
}

export type NotificationRule = {
  id: string
  name: string
  channel: 'email' | 'whatsapp' | 'in_app'
  enabled: boolean
  trigger: string
}

export type AppUser = {
  id: string
  name: string
  email: string
  role: 'admin' | 'gestor' | 'sdr'
  active: boolean
  authUserId?: string | null
}

export type TvWidget = {
  id: string
  title: string
  widgetType: 'kpi' | 'bar'
  metricKey: string
  enabled: boolean
  position: number
  layout: Record<string, unknown>
  widgetConfig: Record<string, unknown>
}

export type DashboardWidget = {
  id: string
  title: string
  metricKey: string
  enabled: boolean
  position: number
  layout: Record<string, unknown>
  widgetConfig: Record<string, unknown>
}

export type DataViewConfig = {
  columns?: string[]
  sortField?: string
  sortDir?: 'asc' | 'desc'
}

export type DataView = {
  id: string
  name: string
  config: DataViewConfig
}

export type OrgSettings = {
  id: string
  timezone: string
  dateFormat: string
  weekStartsOn: number
}

export const pipelines: Pipeline[] = [
  {
    id: 'pipeline-clinica',
    name: 'Funil Clínica',
    boardConfig: {
      stageSlaMinutes: {
        'novo': 15,
        'triagem': 30,
        'contato': 60
      }
    },
    stages: [
      { id: 'novo', name: 'Novo lead' },
      { id: 'triagem', name: 'Triagem (IA)' },
      { id: 'contato', name: 'Contato (atendente)' },
      { id: 'consulta', name: 'Consulta agendada' },
      { id: 'fechado', name: 'Fechado' },
    ],
  },
  {
    id: 'pipeline-estetica',
    name: 'Funil Estética',
    boardConfig: {
      stageSlaMinutes: {
        'novo-estetica': 30,
        'avaliacao': 120
      }
    },
    stages: [
      { id: 'novo-estetica', name: 'Novo lead' },
      { id: 'avaliacao', name: 'Avaliação inicial' },
      { id: 'proposta', name: 'Proposta' },
      { id: 'fechado-estetica', name: 'Fechado' },
    ],
  },
]

export const sdrTeam: Sdr[] = [
  { id: 'sdr-1', name: 'Ana Costa', active: true },
  { id: 'sdr-2', name: 'Bruno Lima', active: true },
  { id: 'sdr-3', name: 'Carla Souza', active: true },
]

export const initialLeads: Lead[] = [
  {
    id: 'lead-001',
    patientName: 'Mariana Alves',
    phone: '+55 11 91234-2222',
    source: 'meta_instagram',
    createdAt: '2026-04-16T10:00:00Z',
    position: 1,
    score: 78,
    temperature: 'hot',
    ownerId: 'sdr-1',
    pipelineId: 'pipeline-clinica',
    stageId: 'triagem',
    summary: 'Quer avaliacao para harmonizacao facial ainda esta semana.',
    customFields: {},
  },
  {
    id: 'lead-002',
    patientName: 'Paulo Neri',
    phone: '+55 11 94567-3333',
    source: 'meta_facebook',
    createdAt: '2026-04-16T11:20:00Z',
    position: 1,
    score: 62,
    temperature: 'warm',
    ownerId: 'sdr-2',
    pipelineId: 'pipeline-clinica',
    stageId: 'contato',
    summary: 'Interesse em check-up preventivo, prefere contato por WhatsApp.',
    customFields: {},
  },
  {
    id: 'lead-003',
    patientName: 'Renata Melo',
    phone: '+55 11 99876-7878',
    source: 'whatsapp',
    createdAt: '2026-04-16T12:50:00Z',
    position: 1,
    score: 45,
    temperature: 'warm',
    ownerId: 'sdr-3',
    pipelineId: 'pipeline-clinica',
    stageId: 'novo',
    summary: 'Pediu informacoes de valores e condicoes de pagamento.',
    customFields: {},
  },
]

export const initialInteractions: Interaction[] = [
  {
    id: 'int-001',
    leadId: 'lead-001',
    patientName: 'Mariana Alves',
    channel: 'meta',
    direction: 'in',
    author: 'Meta Graph API',
    content: 'Lead capturado do formulario do Instagram Ads.',
    happenedAt: '2026-04-16T10:00:00Z',
  },
  {
    id: 'int-002',
    leadId: 'lead-001',
    patientName: 'Mariana Alves',
    channel: 'ai',
    direction: 'system',
    author: 'AI Triage',
    content: 'Lead qualificado. Sugestao: contato humano em ate 15 min.',
    happenedAt: '2026-04-16T10:01:00Z',
  },
  {
    id: 'int-003',
    leadId: 'lead-002',
    patientName: 'Paulo Neri',
    channel: 'whatsapp',
    direction: 'out',
    author: 'Bruno Lima',
    content: 'Oi Paulo! Sou da equipe da clinica. Posso te enviar opcoes?',
    happenedAt: '2026-04-16T11:30:00Z',
  },
  {
    id: 'int-004',
    leadId: 'lead-003',
    patientName: 'Renata Melo',
    channel: 'system',
    direction: 'system',
    author: 'Routing Engine',
    content: 'Lead distribuido automaticamente para Carla Souza.',
    happenedAt: '2026-04-16T12:52:00Z',
  },
]

export const sourceLabel: Record<Lead['source'], string> = {
  meta_facebook: 'Meta Facebook',
  meta_instagram: 'Meta Instagram',
  whatsapp: 'WhatsApp',
  manual: 'Manual',
}

export const integrationStatus = [
  { id: 'meta', name: 'Meta (Facebook)', status: 'Conectado', latency: '420ms' },
  { id: 'whatsapp', name: 'WhatsApp', status: 'Conectado', latency: '350ms' },
  { id: 'openai', name: 'OpenAI', status: 'Conectado', latency: '810ms' },
]

export const initialChannels: ChannelConfig[] = [
  {
    id: 'meta',
    name: 'Meta Leads',
    enabled: true,
    slaMinutes: 15,
    autoReply: true,
    priority: 1,
    driver: 'meta',
    fieldMapping: { patient_name: 'full_name', phone: 'phone_number' },
    credentialsRef: '',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Oficial',
    enabled: true,
    slaMinutes: 8,
    autoReply: true,
    priority: 2,
    driver: 'whatsapp',
    fieldMapping: {},
    credentialsRef: '',
  },
  {
    id: 'site',
    name: 'Formulario do Site',
    enabled: true,
    slaMinutes: 20,
    autoReply: false,
    priority: 3,
    driver: 'webhook',
    fieldMapping: {},
    credentialsRef: '',
  },
  {
    id: 'manual',
    name: 'Cadastro Manual',
    enabled: true,
    slaMinutes: 30,
    autoReply: false,
    priority: 4,
    driver: 'manual',
    fieldMapping: {},
    credentialsRef: '',
  },
]

export const initialMetrics: MetricConfig[] = [
  { id: 'conversion', label: 'Conversao geral', value: 32, target: 40, unit: 'percent' },
  { id: 'first-response', label: '1a resposta', value: 11, target: 8, unit: 'minutes' },
  { id: 'qualified-rate', label: 'Qualificacao IA', value: 67, target: 70, unit: 'percent' },
  { id: 'new-leads-day', label: 'Leads por dia', value: 29, target: 35, unit: 'count' },
]

export const tvKpiSeries = [
  { label: '08h', leads: 4, qualified: 2 },
  { label: '09h', leads: 6, qualified: 4 },
  { label: '10h', leads: 8, qualified: 5 },
  { label: '11h', leads: 10, qualified: 7 },
  { label: '12h', leads: 7, qualified: 5 },
  { label: '13h', leads: 9, qualified: 6 },
  { label: '14h', leads: 11, qualified: 7 },
  { label: '15h', leads: 12, qualified: 8 },
]

const allContexts: FieldVisibilityContext[] = ['kanban_card', 'lead_detail', 'list', 'capture_form']

export const initialWorkflowFields: WorkflowField[] = [
  {
    id: 'core-patient',
    fieldKey: 'patient_name',
    label: 'Paciente',
    fieldType: 'text',
    required: true,
    options: [],
    section: 'Principal',
    sortOrder: 0,
    visibleIn: ['kanban_card', 'lead_detail', 'list'],
    validation: {},
  },
  {
    id: 'core-summary',
    fieldKey: 'summary',
    label: 'Resumo',
    fieldType: 'text',
    required: true,
    options: [],
    section: 'Principal',
    sortOrder: 1,
    visibleIn: ['kanban_card', 'lead_detail', 'list'],
    validation: {},
  },
  {
    id: 'core-score',
    fieldKey: 'score',
    label: 'Pontuação',
    fieldType: 'number',
    required: false,
    options: [],
    section: 'Principal',
    sortOrder: 2,
    visibleIn: ['kanban_card', 'lead_detail', 'list'],
    validation: {},
  },
  {
    id: 'core-temp',
    fieldKey: 'temperature',
    label: 'Interesse',
    fieldType: 'select',
    required: false,
    options: ['cold', 'warm', 'hot'],
    section: 'Principal',
    sortOrder: 3,
    visibleIn: ['kanban_card', 'lead_detail', 'list'],
    validation: {},
  },
  {
    id: 'core-phone',
    fieldKey: 'phone',
    label: 'Telefone',
    fieldType: 'text',
    required: false,
    options: [],
    section: 'Contato',
    sortOrder: 4,
    visibleIn: ['lead_detail', 'list', 'capture_form'],
    validation: {},
  },
  {
    id: 'wf-1',
    fieldKey: 'especialidade_interesse',
    label: 'Especialidade de interesse',
    fieldType: 'select',
    required: true,
    options: ['Clinica', 'Estetica', 'Odonto'],
    section: 'Clinico',
    sortOrder: 10,
    visibleIn: allContexts,
    validation: {},
  },
  {
    id: 'wf-2',
    fieldKey: 'faixa_investimento',
    label: 'Faixa de investimento',
    fieldType: 'select',
    required: false,
    options: ['Ate R$500', 'R$500 a R$1500', 'Acima de R$1500'],
    section: 'Comercial',
    sortOrder: 11,
    visibleIn: allContexts,
    validation: {},
  },
  {
    id: 'wf-3',
    fieldKey: 'data_preferida',
    label: 'Data preferida',
    fieldType: 'date',
    required: false,
    options: [],
    section: 'Agenda',
    sortOrder: 12,
    visibleIn: allContexts,
    validation: {},
  },
]

export const initialPermissions: PermissionProfile[] = [
  { id: 'perm-admin', role: 'admin', canEditBoards: true, canRouteLeads: true, canManageUsers: true, canViewTvPanel: true },
  { id: 'perm-gestor', role: 'gestor', canEditBoards: true, canRouteLeads: true, canManageUsers: false, canViewTvPanel: true },
  { id: 'perm-sdr', role: 'sdr', canEditBoards: false, canRouteLeads: false, canManageUsers: false, canViewTvPanel: true },
]

export const initialNotifications: NotificationRule[] = [
  { id: 'ntf-1', name: 'Lead sem retorno em 30 min', channel: 'in_app', enabled: true, trigger: 'sla_delay_30m' },
  { id: 'ntf-2', name: 'Lead qualificado por IA', channel: 'email', enabled: true, trigger: 'ai_qualified' },
  { id: 'ntf-3', name: 'Falha no link externo', channel: 'whatsapp', enabled: false, trigger: 'integration_webhook_error' },
]

export const initialAppUsers: AppUser[] = [
  { id: 'admin-1', name: 'Alvaro', email: 'alvaro@institutolorena.com', role: 'admin', active: true },
  { id: 'gestor-1', name: 'Diego Moura', email: 'diego@institutolorena.com', role: 'gestor', active: true },
  { id: 'sdr-1', name: 'Ana Costa', email: 'ana@institutolorena.com', role: 'sdr', active: true },
  { id: 'sdr-2', name: 'Bruno Lima', email: 'bruno@institutolorena.com', role: 'sdr', active: true },
  { id: 'sdr-3', name: 'Carla Souza', email: 'carla@institutolorena.com', role: 'sdr', active: true },
]

const defaultTvLayout = (position: number) => ({
  grid: 'legacy',
  col: ((position - 1) % 4) + 1,
  row: Math.floor((position - 1) / 4) + 1,
  span: 1,
})

export const initialTvWidgets: TvWidget[] = [
  {
    id: 'tv-1',
    title: 'Leads Hoje',
    widgetType: 'kpi',
    metricKey: 'new-leads-day',
    enabled: true,
    position: 1,
    layout: defaultTvLayout(1),
    widgetConfig: {},
  },
  {
    id: 'tv-2',
    title: 'Conversao',
    widgetType: 'kpi',
    metricKey: 'conversion',
    enabled: true,
    position: 2,
    layout: defaultTvLayout(2),
    widgetConfig: {},
  },
  {
    id: 'tv-3',
    title: 'Tempo 1a Resposta',
    widgetType: 'kpi',
    metricKey: 'first-response',
    enabled: true,
    position: 3,
    layout: defaultTvLayout(3),
    widgetConfig: {},
  },
  {
    id: 'tv-4',
    title: 'Capacao x Qualificacao',
    widgetType: 'bar',
    metricKey: 'hourly-funnel',
    enabled: true,
    position: 4,
    layout: { ...defaultTvLayout(4), span: 2 },
    widgetConfig: {},
  },
]

export const initialDashboardWidgets: DashboardWidget[] = [
  {
    id: 'dash-1',
    title: 'Leads ativos',
    metricKey: 'leads-active',
    enabled: true,
    position: 1,
    layout: { w: 1, h: 1 },
    widgetConfig: {},
  },
  {
    id: 'dash-2',
    title: 'Leads quentes',
    metricKey: 'leads-hot',
    enabled: true,
    position: 2,
    layout: { w: 1, h: 1 },
    widgetConfig: {},
  },
  {
    id: 'dash-3',
    title: 'Qualificados IA',
    metricKey: 'qualified-ai',
    enabled: true,
    position: 3,
    layout: { w: 1, h: 1 },
    widgetConfig: {},
  },
  {
    id: 'dash-4',
    title: 'Canais ativos',
    metricKey: 'channels-active',
    enabled: true,
    position: 4,
    layout: { w: 1, h: 1 },
    widgetConfig: {},
  },
]

export const initialDataViews: DataView[] = []

export const initialOrgSettings: OrgSettings = {
  id: 'default',
  timezone: 'America/Sao_Paulo',
  dateFormat: 'dd/MM/yyyy',
  weekStartsOn: 1,
}
