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
