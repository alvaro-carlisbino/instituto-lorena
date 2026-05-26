import { supabase } from '@/lib/supabaseClient'

export type MedicalRecord = {
  id: string
  record_type: string
  author_name: string
  author_crm: string | null
  content: string
  signed_at: string | null
  corrects_record_id: string | null
  created_at: string
}

export type PatientConsentPurpose =
  | 'medical_care'
  | 'marketing'
  | 'research'
  | 'health_insurance'
  | 'whatsapp_messages'

export const RECORD_TYPES = [
  { code: 'anamnese',   label: 'Anamnese' },
  { code: 'evolucao',   label: 'Evolução' },
  { code: 'exame',      label: 'Exame' },
  { code: 'conduta',    label: 'Conduta' },
  { code: 'prescricao', label: 'Prescrição' },
  { code: 'atestado',   label: 'Atestado' },
  { code: 'relato',     label: 'Relato cirúrgico' },
  { code: 'observacao', label: 'Observação' },
  { code: 'errata',     label: 'Errata' },
] as const

/** Lista registros do prontuário do lead. Loga acesso automaticamente. */
export async function listMedicalRecords(leadId: string): Promise<MedicalRecord[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('medical_record_list', { p_lead_id: leadId })
  if (error) throw new Error(error.message)
  return (data ?? []) as MedicalRecord[]
}

/** Cria novo registro. Falha se o paciente não tem consentimento medical_care. */
export async function createMedicalRecord(payload: {
  leadId: string
  recordType: string
  content: string
  correctsRecordId?: string | null
  signatureMeta?: Record<string, unknown> | null
}): Promise<string> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.rpc('medical_record_create', {
    p_lead_id: payload.leadId,
    p_record_type: payload.recordType,
    p_content: payload.content,
    p_corrects_record_id: payload.correctsRecordId ?? null,
    p_signature_meta: payload.signatureMeta ?? null,
  })
  if (error) throw new Error(error.message)
  return String(data ?? '')
}

/** Marca um consentimento como concedido (ou revogado). */
export async function setPatientConsent(payload: {
  leadId: string
  purpose: PatientConsentPurpose
  granted: boolean
  source?: string
  evidence?: Record<string, unknown>
}): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const now = new Date().toISOString()
  const row = {
    lead_id: payload.leadId,
    purpose: payload.purpose,
    granted: payload.granted,
    granted_at: payload.granted ? now : null,
    revoked_at: payload.granted ? null : now,
    source: payload.source ?? 'manual',
    evidence: payload.evidence ?? {},
  }
  const { error } = await supabase
    .from('patient_consents')
    .upsert(row, { onConflict: 'tenant_id,lead_id,purpose' })
  if (error) throw new Error(error.message)
}

export async function fetchPatientConsents(
  leadId: string,
): Promise<Record<PatientConsentPurpose, boolean>> {
  if (!supabase) {
    return {
      medical_care: false,
      marketing: false,
      research: false,
      health_insurance: false,
      whatsapp_messages: false,
    }
  }
  const { data, error } = await supabase
    .from('patient_consents')
    .select('purpose, granted, revoked_at')
    .eq('lead_id', leadId)
  if (error) throw new Error(error.message)
  const map: Record<PatientConsentPurpose, boolean> = {
    medical_care: false,
    marketing: false,
    research: false,
    health_insurance: false,
    whatsapp_messages: false,
  }
  for (const r of data ?? []) {
    const row = r as { purpose: PatientConsentPurpose; granted: boolean; revoked_at: string | null }
    map[row.purpose] = row.granted && !row.revoked_at
  }
  return map
}
