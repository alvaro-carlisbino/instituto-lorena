export type Stage = {
  id: string
  name: string
}

export type BoardConfig = {
  stageSlaMinutes?: Record<string, number>
  kanbanFieldOrder?: string[]
  stageAutomations?: Record<string, { enabled: boolean; template: string }>
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

export type LeadTagDefinition = {
  id: string
  name: string
  color: string
  createdAt: string
}

export type Room = {
  id: string
  name: string
  active: boolean
  slotMinutes: number
  sortOrder: number
  createdAt: string
}

export type Appointment = {
  id: string
  leadId: string
  roomId: string
  startsAt: string
  endsAt: string
  status: 'draft' | 'confirmed' | 'cancelled'
  attendanceStatus: 'expected' | 'checked_in' | 'no_show'
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type AppInboxItem = {
  id: string
  kind: string
  title: string
  body: string
  readAt: string | null
  createdAt: string
  metadata: Record<string, unknown>
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
  /** CRM line (Evolution instance) when using multi-phone. */
  whatsappInstanceId: string | null
  tagIds: string[]
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
  externalMessageId?: string
  media?: Array<{
    id: string
    type: 'audio' | 'image' | 'video' | 'document' | 'other'
    mimeType?: string
    base64?: string
    caption?: string
  }>
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

/** Opção de select: string legada ou par valor + rótulo. */
export type WorkflowFieldOption = string | { value: string; label: string }

export type WorkflowField = {
  id: string
  fieldKey: string
  label: string
  fieldType: 'text' | 'select' | 'number' | 'date' | 'boolean'
  required: boolean
  options: WorkflowFieldOption[]
  section: string
  sortOrder: number
  visibleIn: FieldVisibilityContext[]
  validation: Record<string, unknown>
}

export type LeadTaskStatus = 'open' | 'done' | 'cancelled'

export type LeadTask = {
  id: string
  leadId: string
  title: string
  assigneeId: string | null
  dueAt: string | null
  status: LeadTaskStatus
  taskType: string
  metadata: Record<string, unknown>
  createdAt: string
  sortOrder: number
}

export type AutomationRule = {
  id: string
  name: string
  enabled: boolean
  triggerType: string
  triggerConfig: Record<string, unknown>
  actionType: string
  actionConfig: Record<string, unknown>
}

export type SurveyTemplate = {
  id: string
  name: string
  npsQuestion: string
  enabled: boolean
}

export type SurveyDispatch = {
  id: string
  templateId: string
  leadId: string
  sentAt: string
  channel: string
}

export type SurveyResponse = {
  id: string
  dispatchId: string
  score: number
  comment: string | null
  respondedAt: string
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
  // Clinic Info
  clinicName?: string
  clinicLogo?: string
  clinicPhone?: string
  clinicEmail?: string
  clinicAddress?: string
  // Working Hours (Simplified)
  workingHours?: {
    start: string // "08:00"
    end: string   // "18:00"
    days: number[] // [1,2,3,4,5]
  }
}

/**
 * Três funis padrão Lorena (teste com cliente). IDs de etapa são únicos em toda a base (Postgres).
 * Jornada sugerida: Clínica (entrada) → TRATAMENTO CAPILAR → Processo cirúrgico (após concluir o capilar).
 */
export const pipelines: Pipeline[] = [
  {
    id: 'pipeline-clinica',
    name: 'Pipeline Clínica',
    boardConfig: {
      stageSlaMinutes: {
        novo: 15,
        triagem: 30,
        contato: 60,
        consulta: 120,
        acompanhamento: 240,
        fechado: 0,
      },
    },
    stages: [
      { id: 'novo', name: 'Novo lead' },
      { id: 'triagem', name: 'Triagem' },
      { id: 'contato', name: 'Contato' },
      { id: 'consulta', name: 'Consulta agendada' },
      { id: 'acompanhamento', name: 'Acompanhamento' },
      { id: 'fechado', name: 'Encerrado' },
    ],
  },
  {
    id: 'pipeline-tratamento-capilar',
    name: 'Pipeline TRATAMENTO CAPILAR',
    boardConfig: {
      stageSlaMinutes: {
        'tc-novo': 20,
        'tc-triagem': 45,
        'tc-avaliacao': 120,
        'tc-plano': 240,
        'tc-sessoes': 0,
        'tc-concluido': 0,
      },
    },
    stages: [
      { id: 'tc-novo', name: 'Novo' },
      { id: 'tc-triagem', name: 'Triagem e primeiros dados' },
      { id: 'tc-avaliacao', name: 'Avaliação capilar' },
      { id: 'tc-plano', name: 'Plano e orçamento' },
      { id: 'tc-sessoes', name: 'Em tratamento (sessões)' },
      { id: 'tc-concluido', name: 'Tratamento concluído (pré-cirúrgico)' },
    ],
  },
  {
    id: 'pipeline-processo-cirurgico',
    name: 'PROCESSO CIRÚRGICO',
    boardConfig: {
      stageSlaMinutes: {
        'cx-entrada': 60,
        'cx-pre-op': 1440,
        'cx-cirurgia': 0,
        'cx-pos-op': 720,
        'cx-alta': 0,
      },
    },
    stages: [
      { id: 'cx-entrada', name: 'Entrada (pós-tratamento capilar)' },
      { id: 'cx-pre-op', name: 'Pré-operatório' },
      { id: 'cx-cirurgia', name: 'Cirurgia' },
      { id: 'cx-pos-op', name: 'Pós-operatório' },
      { id: 'cx-alta', name: 'Alta / concluído' },
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
    whatsappInstanceId: null,
    tagIds: [],
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
    whatsappInstanceId: null,
    tagIds: [],
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
    whatsappInstanceId: null,
    tagIds: [],
  },
  {
    id: 'lead-004',
    patientName: 'Fernanda Rocha',
    phone: '+55 11 97777-1010',
    source: 'whatsapp',
    createdAt: '2026-04-20T09:00:00Z',
    position: 1,
    score: 55,
    temperature: 'warm',
    ownerId: 'sdr-1',
    pipelineId: 'pipeline-tratamento-capilar',
    stageId: 'tc-plano',
    summary: 'Avaliação feita; aguardando aprovação do plano de sessões.',
    customFields: {},
    whatsappInstanceId: null,
    tagIds: [],
  },
  {
    id: 'lead-005',
    patientName: 'Gustavo Prado',
    phone: '+55 11 96666-2020',
    source: 'manual',
    createdAt: '2026-04-22T14:00:00Z',
    position: 1,
    score: 80,
    temperature: 'hot',
    ownerId: 'sdr-2',
    pipelineId: 'pipeline-processo-cirurgico',
    stageId: 'cx-pre-op',
    summary: 'Concluiu tratamento capilar; documentação e exames pré-operatórios em andamento.',
    customFields: {},
    whatsappInstanceId: null,
    tagIds: [],
  },
]

export const initialInteractions: Interaction[] = [
  {
    id: 'int-001',
    leadId: 'lead-001',
    patientName: 'Mariana Alves',
    channel: 'meta',
    direction: 'in',
    author: 'Anúncios Meta',
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
    id: 'custom-primeira-consulta',
    fieldKey: 'primeira_consulta',
    label: 'Primeira Consulta?',
    fieldType: 'boolean',
    required: false,
    options: [],
    section: 'Principal',
    sortOrder: 2,
    visibleIn: ['kanban_card', 'lead_detail'],
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
    options: [
      { value: 'cold', label: 'Frio' },
      { value: 'warm', label: 'Morno' },
      { value: 'hot', label: 'Quente' },
    ],
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
    id: 'core-email',
    fieldKey: 'email',
    label: 'E-mail',
    fieldType: 'text',
    required: false,
    options: [],
    section: 'Contato',
    sortOrder: 5,
    visibleIn: ['lead_detail', 'list', 'capture_form'],
    validation: {},
  },
  {
    id: 'core-birthday',
    fieldKey: 'birthday',
    label: 'Aniversário',
    fieldType: 'date',
    required: false,
    options: [],
    section: 'Contato',
    sortOrder: 6,
    visibleIn: ['lead_detail', 'list', 'capture_form'],
    validation: {},
  },
  {
    id: 'core-notes',
    fieldKey: 'notes',
    label: 'Notas',
    fieldType: 'text',
    required: false,
    options: [],
    section: 'Gestão',
    sortOrder: 7,
    visibleIn: ['lead_detail', 'list'],
    validation: {},
  },
  {
    id: 'core-observations',
    fieldKey: 'observations',
    label: 'Observações',
    fieldType: 'text',
    required: false,
    options: [],
    section: 'Gestão',
    sortOrder: 8,
    visibleIn: ['lead_detail', 'list'],
    validation: {},
  },
  {
    id: 'wf-1',
    fieldKey: 'especialidade_interesse',
    label: 'Especialidade de interesse',
    fieldType: 'select',
    required: true,
    options: ['Clínica Geral', 'Estética Avançada', 'Odontologia', 'Cirurgia Plástica', 'Dermatologia'],
    section: 'Comercial',
    sortOrder: 10,
    visibleIn: allContexts,
    validation: {},
  },
  {
    id: 'wf-2',
    fieldKey: 'faixa_investimento',
    label: 'Faixa de investimento (R$)',
    fieldType: 'select',
    required: false,
    options: ['Até R$ 1.000', 'R$ 1.000 a R$ 5.000', 'Acima de R$ 5.000', 'Indefinido'],
    section: 'Comercial',
    sortOrder: 11,
    visibleIn: allContexts,
    validation: {},
  },
  {
    id: 'wf-3',
    fieldKey: 'data_preferida',
    label: 'Data preferida para avaliação',
    fieldType: 'date',
    required: false,
    options: [],
    section: 'Agenda',
    sortOrder: 12,
    visibleIn: allContexts,
    validation: {},
  },
  {
    id: 'wf-4',
    fieldKey: 'convenio',
    label: 'Convênio / Plano de Saúde',
    fieldType: 'select',
    required: false,
    options: ['Particular', 'Unimed', 'Bradesco Saúde', 'SulAmérica', 'Amil', 'Outros'],
    section: 'Cadastro Médio',
    sortOrder: 13,
    visibleIn: ['lead_detail', 'capture_form'],
    validation: {},
  },
  {
    id: 'wf-5',
    fieldKey: 'procedimentos_anteriores',
    label: 'Já realizou procedimentos similares?',
    fieldType: 'select',
    required: false,
    options: ['Sim', 'Não'],
    section: 'Triagem Clínica',
    sortOrder: 14,
    visibleIn: ['lead_detail'],
    validation: {},
  },
  {
    id: 'wf-6',
    fieldKey: 'medicamentos_uso',
    label: 'Medicamentos em uso contínuo',
    fieldType: 'text',
    required: false,
    options: [],
    section: 'Triagem Clínica',
    sortOrder: 15,
    visibleIn: ['lead_detail'],
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
  { id: 'ntf-4', name: 'Tarefa de follow-up a vencer hoje', channel: 'in_app', enabled: true, trigger: 'task_follow_up_due_today' },
  { id: 'ntf-5', name: 'NPS enviado — aguarda registo de resposta', channel: 'in_app', enabled: true, trigger: 'nps_dispatch_pending' },
  { id: 'ntf-6', name: 'Lembrete: lead em triagem ha mais de 2h', channel: 'in_app', enabled: true, trigger: 'triage_stale_2h' },
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
  clinicName: 'Instituto Lorena',
  clinicPhone: '',
  clinicEmail: '',
  clinicAddress: '',
  workingHours: {
    start: '08:00',
    end: '18:00',
    days: [1, 2, 3, 4, 5],
  },
}

export const initialLeadTasks: LeadTask[] = [
  {
    id: 'task-demo-1',
    leadId: 'lead-001',
    title: 'Retornar ligação — harmonização',
    assigneeId: 'sdr-1',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    status: 'open',
    taskType: 'follow_up',
    metadata: {},
    createdAt: '2026-04-16T10:05:00Z',
    sortOrder: 0,
  },
]

export const initialAutomationRules: AutomationRule[] = [
  {
    id: 'auto-novo',
    name: 'Clínica: primeiro retorno (novo lead)',
    enabled: true,
    triggerType: 'stage_entered',
    triggerConfig: { stageId: 'novo' },
    actionType: 'create_task',
    actionConfig: { title: 'Ligar ou WhatsApp em ate 2h', hoursOffset: 2, taskType: 'follow_up' },
  },
  {
    id: 'auto-triagem',
    name: 'Clínica: follow-up pós-triagem',
    enabled: true,
    triggerType: 'stage_entered',
    triggerConfig: { stageId: 'triagem' },
    actionType: 'create_task',
    actionConfig: { title: 'Confirmar entendimento e proximo passo (triagem)', hoursOffset: 4, taskType: 'follow_up' },
  },
  {
    id: 'auto-contato',
    name: 'Clínica: contato humano (24h)',
    enabled: true,
    triggerType: 'stage_entered',
    triggerConfig: { stageId: 'contato' },
    actionType: 'create_task',
    actionConfig: { title: 'Contato humano: proposta ou proxima acao', hoursOffset: 24, taskType: 'follow_up' },
  },
  {
    id: 'auto-consulta',
    name: 'Clínica: pos-consulta',
    enabled: true,
    triggerType: 'stage_entered',
    triggerConfig: { stageId: 'consulta' },
    actionType: 'create_task',
    actionConfig: { title: 'Check-in pos-consulta (satisfacao e retorno)', hoursOffset: 48, taskType: 'follow_up' },
  },
  {
    id: 'auto-tc-avaliacao',
    name: 'Capilar: apos avaliacao',
    enabled: true,
    triggerType: 'stage_entered',
    triggerConfig: { stageId: 'tc-avaliacao' },
    actionType: 'create_task',
    actionConfig: { title: 'Enviar plano e condicoes (avaliacao capilar)', hoursOffset: 24, taskType: 'follow_up' },
  },
  {
    id: 'auto-tc-plano',
    name: 'Capilar: acompanhamento do plano',
    enabled: true,
    triggerType: 'stage_entered',
    triggerConfig: { stageId: 'tc-plano' },
    actionType: 'create_task',
    actionConfig: { title: 'Cobrar aceite do plano / orcamento', hoursOffset: 48, taskType: 'follow_up' },
  },
  {
    id: 'auto-tc-sessoes',
    name: 'Capilar: em sessoes',
    enabled: true,
    triggerType: 'stage_entered',
    triggerConfig: { stageId: 'tc-sessoes' },
    actionType: 'create_task',
    actionConfig: { title: 'Check-in de evolucao (meio do tratamento)', hoursOffset: 168, taskType: 'follow_up' },
  },
  {
    id: 'auto-cx-pre',
    name: 'Cirurgico: pre-operatorio',
    enabled: true,
    triggerType: 'stage_entered',
    triggerConfig: { stageId: 'cx-pre-op' },
    actionType: 'create_task',
    actionConfig: { title: 'Checklist de exames e documentacao pre-cirurgia', hoursOffset: 24, taskType: 'follow_up' },
  },
  {
    id: 'auto-cx-pos',
    name: 'Cirurgico: pos-operatorio',
    enabled: true,
    triggerType: 'stage_entered',
    triggerConfig: { stageId: 'cx-pos-op' },
    actionType: 'create_task',
    actionConfig: { title: 'Primeiro contato pos-cirurgia (dor, curativo, duvidas)', hoursOffset: 4, taskType: 'follow_up' },
  },
]

export const initialSurveyTemplates: SurveyTemplate[] = [
  {
    id: 'nps-default',
    name: 'NPS generico (fallback)',
    npsQuestion: 'De 0 a 10, quanto recomendaria a nossa clinica a um amigo ou familiar?',
    enabled: false,
  },
  {
    id: 'nps-clinica',
    name: 'NPS — Pipeline Clínica',
    npsQuestion: 'Apos o atendimento, de 0 a 10, o quanto recomendaria a experiencia na nossa recepcao e triagem?',
    enabled: true,
  },
  {
    id: 'nps-capilar',
    name: 'NPS — Tratamento capilar',
    npsQuestion: 'Sobre o tratamento capilar, de 0 a 10, como avalia o acompanhamento e os resultados ate aqui?',
    enabled: true,
  },
  {
    id: 'nps-cirurgico',
    name: 'NPS — Processo cirurgico',
    npsQuestion: 'Sobre a cirurgia e o cuidado pos-operatorio, de 0 a 10, o quanto recomendaria a nossa equipe?',
    enabled: true,
  },
]

export const initialSurveyDispatches: SurveyDispatch[] = []

export const initialSurveyResponses: SurveyResponse[] = []

export const initialLeadTagDefinitions: LeadTagDefinition[] = [
  { id: 'tag-1', name: 'Urgência Médica', color: '#ef4444', createdAt: '2026-04-01T10:00:00Z' },
  { id: 'tag-2', name: 'Paciente VIP', color: '#eab308', createdAt: '2026-04-01T10:00:00Z' },
  { id: 'tag-3', name: 'Indicação', color: '#3b82f6', createdAt: '2026-04-01T10:00:00Z' },
  { id: 'tag-4', name: 'Recorrente', color: '#22c55e', createdAt: '2026-04-01T10:00:00Z' },
  { id: 'tag-5', name: 'Pendente Doc.', color: '#f97316', createdAt: '2026-04-01T10:00:00Z' },
]

export const initialRooms: Room[] = [
  { id: 'room-1', name: 'Consultório 1 (Avaliação)', active: true, slotMinutes: 30, sortOrder: 0, createdAt: '2026-04-01T10:00:00Z' },
  { id: 'room-2', name: 'Consultório 2 (Procedimentos)', active: true, slotMinutes: 60, sortOrder: 1, createdAt: '2026-04-01T10:00:00Z' },
  { id: 'room-3', name: 'Sala de Cirurgia', active: true, slotMinutes: 120, sortOrder: 2, createdAt: '2026-04-01T10:00:00Z' },
  { id: 'room-4', name: 'Sala de Recuperação', active: true, slotMinutes: 60, sortOrder: 3, createdAt: '2026-04-01T10:00:00Z' },
]

export const initialAppointments: Appointment[] = []
