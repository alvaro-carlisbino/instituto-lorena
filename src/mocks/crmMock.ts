export type Stage = {
  id: string
  name: string
}

export type Pipeline = {
  id: string
  name: string
  stages: Stage[]
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
  score: number
  temperature: 'cold' | 'warm' | 'hot'
  ownerId: string
  pipelineId: string
  stageId: string
  summary: string
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

export type ChannelConfig = {
  id: string
  name: string
  enabled: boolean
  slaMinutes: number
  autoReply: boolean
  priority: number
}

export type MetricConfig = {
  id: string
  label: string
  value: number
  target: number
  unit: 'percent' | 'minutes' | 'count'
}

export type WorkflowField = {
  id: string
  label: string
  fieldType: 'text' | 'select' | 'number' | 'date'
  required: boolean
  options: string[]
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
  role: 'admin' | 'gestor' | 'sdr'
  active: boolean
}

export type TvWidget = {
  id: string
  title: string
  widgetType: 'kpi' | 'bar'
  metricKey: string
  enabled: boolean
  position: number
}

export type DashboardWidget = {
  id: string
  title: string
  metricKey: string
  enabled: boolean
  position: number
}

export const pipelines: Pipeline[] = [
  {
    id: 'pipeline-clinica',
    name: 'Pipeline Clinica',
    stages: [
      { id: 'novo', name: 'Novo lead' },
      { id: 'triagem', name: 'Triagem IA' },
      { id: 'contato', name: 'Contato SDR' },
      { id: 'consulta', name: 'Consulta agendada' },
      { id: 'fechado', name: 'Fechado' },
    ],
  },
  {
    id: 'pipeline-estetica',
    name: 'Pipeline Estetica',
    stages: [
      { id: 'novo-estetica', name: 'Novo lead' },
      { id: 'avaliacao', name: 'Avaliacao inicial' },
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
    score: 78,
    temperature: 'hot',
    ownerId: 'sdr-1',
    pipelineId: 'pipeline-clinica',
    stageId: 'triagem',
    summary: 'Quer avaliacao para harmonizacao facial ainda esta semana.',
  },
  {
    id: 'lead-002',
    patientName: 'Paulo Neri',
    phone: '+55 11 94567-3333',
    source: 'meta_facebook',
    createdAt: '2026-04-16T11:20:00Z',
    score: 62,
    temperature: 'warm',
    ownerId: 'sdr-2',
    pipelineId: 'pipeline-clinica',
    stageId: 'contato',
    summary: 'Interesse em check-up preventivo, prefere contato por WhatsApp.',
  },
  {
    id: 'lead-003',
    patientName: 'Renata Melo',
    phone: '+55 11 99876-7878',
    source: 'whatsapp',
    createdAt: '2026-04-16T12:50:00Z',
    score: 45,
    temperature: 'warm',
    ownerId: 'sdr-3',
    pipelineId: 'pipeline-clinica',
    stageId: 'novo',
    summary: 'Pediu informacoes de valores e condicoes de pagamento.',
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
  { id: 'meta', name: 'Meta Graph API', status: 'Conectado', latency: '420ms' },
  { id: 'whatsapp', name: 'WhatsApp Cloud API', status: 'Conectado', latency: '350ms' },
  { id: 'openai', name: 'OpenAI API', status: 'Conectado', latency: '810ms' },
]

export const initialChannels: ChannelConfig[] = [
  { id: 'meta', name: 'Meta Leads', enabled: true, slaMinutes: 15, autoReply: true, priority: 1 },
  { id: 'whatsapp', name: 'WhatsApp Oficial', enabled: true, slaMinutes: 8, autoReply: true, priority: 2 },
  { id: 'site', name: 'Formulario do Site', enabled: true, slaMinutes: 20, autoReply: false, priority: 3 },
  { id: 'manual', name: 'Cadastro Manual', enabled: true, slaMinutes: 30, autoReply: false, priority: 4 },
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

export const initialWorkflowFields: WorkflowField[] = [
  { id: 'wf-1', label: 'Especialidade de interesse', fieldType: 'select', required: true, options: ['Clinica', 'Estetica', 'Odonto'] },
  { id: 'wf-2', label: 'Faixa de investimento', fieldType: 'select', required: false, options: ['Ate R$500', 'R$500 a R$1500', 'Acima de R$1500'] },
  { id: 'wf-3', label: 'Data preferida', fieldType: 'date', required: false, options: [] },
]

export const initialPermissions: PermissionProfile[] = [
  { id: 'perm-admin', role: 'admin', canEditBoards: true, canRouteLeads: true, canManageUsers: true, canViewTvPanel: true },
  { id: 'perm-gestor', role: 'gestor', canEditBoards: true, canRouteLeads: true, canManageUsers: false, canViewTvPanel: true },
  { id: 'perm-sdr', role: 'sdr', canEditBoards: false, canRouteLeads: false, canManageUsers: false, canViewTvPanel: true },
]

export const initialNotifications: NotificationRule[] = [
  { id: 'ntf-1', name: 'Lead sem retorno em 30 min', channel: 'in_app', enabled: true, trigger: 'sla_delay_30m' },
  { id: 'ntf-2', name: 'Lead qualificado por IA', channel: 'email', enabled: true, trigger: 'ai_qualified' },
  { id: 'ntf-3', name: 'Falha de webhook', channel: 'whatsapp', enabled: false, trigger: 'integration_webhook_error' },
]

export const initialAppUsers: AppUser[] = [
  { id: 'admin-1', name: 'Alvaro', role: 'admin', active: true },
  { id: 'gestor-1', name: 'Diego Moura', role: 'gestor', active: true },
  { id: 'sdr-1', name: 'Ana Costa', role: 'sdr', active: true },
  { id: 'sdr-2', name: 'Bruno Lima', role: 'sdr', active: true },
  { id: 'sdr-3', name: 'Carla Souza', role: 'sdr', active: true },
]

export const initialTvWidgets: TvWidget[] = [
  { id: 'tv-1', title: 'Leads Hoje', widgetType: 'kpi', metricKey: 'new-leads-day', enabled: true, position: 1 },
  { id: 'tv-2', title: 'Conversao', widgetType: 'kpi', metricKey: 'conversion', enabled: true, position: 2 },
  { id: 'tv-3', title: 'Tempo 1a Resposta', widgetType: 'kpi', metricKey: 'first-response', enabled: true, position: 3 },
  { id: 'tv-4', title: 'Capacao x Qualificacao', widgetType: 'bar', metricKey: 'hourly-funnel', enabled: true, position: 4 },
]

export const initialDashboardWidgets: DashboardWidget[] = [
  { id: 'dash-1', title: 'Leads ativos', metricKey: 'leads-active', enabled: true, position: 1 },
  { id: 'dash-2', title: 'Leads quentes', metricKey: 'leads-hot', enabled: true, position: 2 },
  { id: 'dash-3', title: 'Qualificados IA', metricKey: 'qualified-ai', enabled: true, position: 3 },
  { id: 'dash-4', title: 'Canais ativos', metricKey: 'channels-active', enabled: true, position: 4 },
]
