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
 * Telefone para EXIBIÇÃO no chat/ficha. Quando o número é sintético do ManyChat
 * (`888001…`) ou tem menos de 10 dígitos, não mostramos o id disfarçado de telefone —
 * devolvemos um rótulo honesto de que ainda não há número real. `isReal` permite
 * estilizar (mutado/itálico) o caso sem número.
 */
export function getLeadPhoneDisplay(lead: Pick<Lead, 'phone' | 'source'>): { label: string; isReal: boolean } {
  const phone = String(lead.phone ?? '').trim()
  const digits = phone.replace(/\D/g, '')
  if (digits.length >= 10 && !isManychatSyntheticPhone(phone)) {
    return { label: phone, isReal: true }
  }
  const via = isLeadSourceInstagram(lead.source) ? 'Instagram' : 'ManyChat'
  return { label: `Sem nº real · ${via}`, isReal: false }
}

/**
 * Sem compositor / envio `crm-send-message`: lead Instagram sem número utilizável **ou** ainda com telefone sintético.
 * Com ≥10 dígitos e **não** prefixo `888001…`, o CRM permite WhatsApp manual (ex.: após merge com WA real).
 */
export function isLeadWhatsappComposeBlocked(lead: Pick<Lead, 'source' | 'phone' | 'customFields'>): boolean {
  if (!isLeadSourceInstagram(lead.source)) return false
  
  const mcPrimary = lead.customFields?.manychat_subscriber_id
  const mcWa = lead.customFields?.manychat_whatsapp_subscriber_id
  const mcIds = lead.customFields?.manychat_subscriber_ids
  const mcAny = Array.isArray(mcIds) && mcIds.filter(Boolean).length > 0
  if (mcPrimary || mcWa || mcAny) return false

  const digits = String(lead.phone ?? '').replace(/\D/g, '')
  if (digits.length < 10) return true
  return isManychatSyntheticPhone(lead.phone)
}

/**
 * Tabelas de preço embutidas por médico: [medico][tipo_consulta][genero] → R$.
 * Quando gênero não afeta o valor, M e F apontam para o mesmo número.
 *
 * TODO (Fase 2 do whitelabel): mover para `tenants.brand_config.price_table` e
 * carregar via `useTenant()` em vez de hardcode. Hoje só o tenant `instituto-lorena`
 * usa esses valores; demais tenants caem no fallback vazio (sem cálculo automático).
 */
export const BUILTIN_PRICE_TABLES: Record<string, Record<string, Record<string, number>>> = {
  lorena: {
    transplante: { masculino: 800, feminino: 1100 },
    clinica: { masculino: 800, feminino: 1100 },
    acompanhamento: { masculino: 600, feminino: 600 },
    online: { masculino: 800, feminino: 800 },
    sobrancelhas: { masculino: 600, feminino: 600 },
  },
  outros: {
    transplante: { masculino: 600, feminino: 600 },
    clinica: { masculino: 600, feminino: 600 },
    acompanhamento: { masculino: 400, feminino: 400 },
    online: { masculino: 400, feminino: 400 },
    sobrancelhas: { masculino: 400, feminino: 400 },
  },
}

export function formatBRL(value: number): string {
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Resolve preço a partir de tipo_consulta + medico + genero. '' se faltar dado. */
export function calculateInvestmentValue(tipoConsulta: unknown, medico: unknown, genero: unknown): string {
  const t = String(tipoConsulta ?? '').toLowerCase()
  const m = String(medico ?? '').toLowerCase()
  const g = String(genero ?? '').toLowerCase()
  if (!t || !m || !g) return ''
  const value = BUILTIN_PRICE_TABLES[m]?.[t]?.[g]
  if (typeof value !== 'number') return ''
  return formatBRL(value)
}

/**
 * Score 0–100 derivado dos campos do lead. Regras (acertadas com o usuário):
 * +20 telefone real (≥10 dígitos e não sintético ManyChat)
 * +20 tipo de consulta definido
 * +15 faixa de investimento definida
 * +15 data preferida preenchida
 * +15 primeira consulta = sim
 * +15 e-mail válido
 */
export function calculateLeadScore(lead: Pick<Lead, 'phone' | 'customFields'>): number {
  let score = 0
  const phone = String(lead.phone ?? '')
  if (phone.replace(/\D/g, '').length >= 10 && !isManychatSyntheticPhone(phone)) score += 20

  const cf = lead.customFields ?? {}
  if (String(cf.tipo_consulta ?? '').trim()) score += 20
  if (String(cf.faixa_investimento ?? '').trim()) score += 15
  if (String(cf.data_preferida ?? '').trim()) score += 15
  const pc = cf.primeira_consulta
  if (pc === true || pc === 'true' || pc === 1) score += 15
  const email = String(cf.email ?? '').trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) score += 15

  return Math.min(100, score)
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
  let next: Lead
  switch (fieldKey) {
    case 'patient_name':
      next = { ...lead, patientName: String(value ?? '') }
      break
    case 'phone':
      next = { ...lead, phone: String(value ?? '') }
      break
    case 'source': {
      const v = String(value ?? '')
      const ok = ['meta_facebook', 'meta_instagram', 'meta_whatsapp', 'whatsapp', 'manual'] as const
      const hit = ok.find((s) => s === v)
      next = { ...lead, source: hit ?? lead.source }
      break
    }
    case 'summary':
      next = { ...lead, summary: String(value ?? '') }
      break
    case 'score':
      next = { ...lead, score: Number(value) || 0 }
      break
    case 'temperature': {
      const v = String(value ?? '')
      const ok = ['cold', 'warm', 'hot'] as const
      const hit = ok.find((s) => s === v)
      next = { ...lead, temperature: hit ?? lead.temperature }
      break
    }
    default:
      next = { ...lead, customFields: { ...lead.customFields, [fieldKey]: value } }
  }

  if (fieldKey === 'tipo_consulta' || fieldKey === 'medico' || fieldKey === 'genero_paciente') {
    const computed = calculateInvestmentValue(
      next.customFields?.tipo_consulta,
      next.customFields?.medico,
      next.customFields?.genero_paciente,
    )
    if (computed) {
      next = { ...next, customFields: { ...next.customFields, faixa_investimento: computed } }
    }
  }

  if (fieldKey !== 'score') {
    next = { ...next, score: calculateLeadScore(next) }
  }

  return next
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
