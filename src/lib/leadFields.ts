import type { FieldVisibilityContext, Lead, WorkflowField } from '@/mocks/crmMock'

/** Prefixo alinhado a `syntheticPhoneFromManychatSubscriberId` no Edge (`_shared/crm.ts`). */
const MANYCHAT_SYNTHETIC_PHONE_PREFIX = '888001'

export function isLeadSourceInstagram(source: Lead['source']): boolean {
  return source === 'meta_instagram'
}

/** Telefone gerado para subscriber ManyChat até existir número real (merge / ingest). */
export function isManychatSyntheticPhone(phone: string): boolean {
  const digits = String(phone ?? '').replace(/\D/g, '')
  return digits.length >= 10 && digits.startsWith(MANYCHAT_SYNTHETIC_PHONE_PREFIX)
}

/**
 * Sem compositor / envio `crm-send-message`: lead Instagram sem número utilizável **ou** ainda com telefone sintético.
 * Com ≥10 dígitos e **não** prefixo `888001…`, o CRM permite WhatsApp manual (ex.: após merge com WA real).
 */
export function isLeadWhatsappComposeBlocked(lead: Pick<Lead, 'source' | 'phone'>): boolean {
  if (!isLeadSourceInstagram(lead.source)) return false
  const digits = String(lead.phone ?? '').replace(/\D/g, '')
  if (digits.length < 10) return true
  return isManychatSyntheticPhone(lead.phone)
}

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
