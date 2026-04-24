import type { WorkflowField } from '@/mocks/crmMock'

export const CORE_COLUMN_LABELS: Record<string, string> = {
  patient_name: 'Nome do contato',
  phone: 'Telefone',
  summary: 'Resumo',
  source: 'Origem',
  temperature: 'Interesse',
  score: 'Pontuação',
  pipeline_id: 'Funil',
  stage_id: 'Etapa',
  owner_id: 'Responsável',
  created_at: 'Criado em',
}

export function columnLabel(fieldKey: string, workflowFields: Pick<WorkflowField, 'fieldKey' | 'label'>[]): string {
  const wf = workflowFields.find((f) => f.fieldKey === fieldKey)
  if (wf) return wf.label
  return CORE_COLUMN_LABELS[fieldKey] ?? fieldKey
}
