import type { FieldVisibilityContext, Lead, WorkflowField } from '@/mocks/crmMock'

/** Campos persistidos em colunas SQL (além de custom_fields). */
export const CORE_LEAD_FIELD_KEYS = [
  'patient_name',
  'phone',
  'source',
  'summary',
  'score',
  'temperature',
] as const

export type CoreLeadFieldKey = (typeof CORE_LEAD_FIELD_KEYS)[number]

export const defaultVisibleInAll: FieldVisibilityContext[] = ['kanban_card', 'lead_detail', 'list', 'capture_form']

export function getLeadFieldValue(lead: Lead, fieldKey: string): unknown {
  switch (fieldKey) {
    case 'patient_name':
      return lead.patientName
    case 'phone':
      return lead.phone
    case 'source':
      return lead.source
    case 'summary':
      return lead.summary
    case 'score':
      return lead.score
    case 'temperature':
      return lead.temperature
    default:
      return lead.customFields[fieldKey]
  }
}

export function setLeadFieldValue(lead: Lead, fieldKey: string, value: unknown): Lead {
  switch (fieldKey) {
    case 'patient_name':
      return { ...lead, patientName: String(value ?? '') }
    case 'phone':
      return { ...lead, phone: String(value ?? '') }
    case 'source': {
      const v = String(value ?? '')
      const ok = ['meta_facebook', 'meta_instagram', 'whatsapp', 'manual'] as const
      const hit = ok.find((s) => s === v)
      return { ...lead, source: hit ?? lead.source }
    }
    case 'summary':
      return { ...lead, summary: String(value ?? '') }
    case 'score':
      return { ...lead, score: Number(value) || 0 }
    case 'temperature': {
      const v = String(value ?? '')
      const ok = ['cold', 'warm', 'hot'] as const
      const hit = ok.find((s) => s === v)
      return { ...lead, temperature: hit ?? lead.temperature }
    }
    default:
      return {
        ...lead,
        customFields: { ...lead.customFields, [fieldKey]: value },
      }
  }
}

export function workflowFieldsForContext(fields: WorkflowField[], ctx: FieldVisibilityContext): WorkflowField[] {
  return [...fields]
    .filter((f) => f.visibleIn.includes(ctx))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
}

export function mergeKanbanFieldOrder(pipelineBoardConfig: { kanbanFieldOrder?: string[] } | undefined, fields: WorkflowField[]): WorkflowField[] {
  const ordered = workflowFieldsForContext(fields, 'kanban_card')
  const order = pipelineBoardConfig?.kanbanFieldOrder
  if (!order?.length) return ordered
  const byKey = new Map(ordered.map((f) => [f.fieldKey, f]))
  const seen = new Set<string>()
  const result: WorkflowField[] = []
  for (const key of order) {
    const f = byKey.get(key)
    if (f) {
      result.push(f)
      seen.add(key)
    }
  }
  for (const f of ordered) {
    if (!seen.has(f.fieldKey)) result.push(f)
  }
  return result
}
