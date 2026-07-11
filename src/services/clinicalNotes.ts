import { supabase } from '@/lib/supabaseClient'

// Notas clínicas: ferramenta interna entre médicos/doutoras e a recepção (Aline) que dá
// continuidade ao atendimento. Uma nota por observação, vinculada ao paciente (lead).

export type ClinicalNote = {
  id: string
  leadId: string
  patientName: string
  author: string
  authorRole: string
  category: string
  note: string
  createdAt: string
}

export const NOTE_CATEGORIES = [
  { value: 'consulta', label: 'Consulta' },
  { value: 'observacao', label: 'Observação' },
  { value: 'encaminhamento', label: 'Encaminhamento' },
  { value: 'plano', label: 'Plano / conduta' },
  { value: 'recepcao', label: 'Recepção / Aline' },
]

type Row = {
  id: string; lead_id: string; author: string | null; author_role: string | null
  category: string | null; note: string; created_at: string
}

async function attachNames(rows: Row[]): Promise<ClinicalNote[]> {
  const ids = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))]
  const nameById = new Map<string, string>()
  if (ids.length && supabase) {
    const { data } = await supabase.from('leads').select('id, patient_name').in('id', ids)
    for (const l of (data ?? []) as Array<{ id: string; patient_name: string }>) {
      nameById.set(String(l.id), String(l.patient_name ?? '').trim())
    }
  }
  return rows.map((r) => ({
    id: String(r.id), leadId: String(r.lead_id), patientName: nameById.get(String(r.lead_id)) || 'Paciente',
    author: String(r.author ?? ''), authorRole: String(r.author_role ?? ''),
    category: String(r.category ?? ''), note: String(r.note ?? ''), createdAt: String(r.created_at),
  }))
}

export async function fetchClinicalNotes(opts?: { leadId?: string; limit?: number }): Promise<ClinicalNote[]> {
  if (!supabase) return []
  let q = supabase.from('clinical_notes').select('id, lead_id, author, author_role, category, note, created_at')
    .order('created_at', { ascending: false }).limit(opts?.limit ?? 100)
  if (opts?.leadId) q = q.eq('lead_id', opts.leadId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return attachNames((data ?? []) as Row[])
}

export async function createClinicalNote(input: {
  tenantId: string; leadId: string; note: string; category?: string; authorRole?: string
}): Promise<void> {
  if (!supabase) throw new Error('sem conexão')
  const { data: u } = await supabase.auth.getUser()
  const author = u?.user?.email ?? 'usuário'
  const { error } = await supabase.from('clinical_notes').insert({
    tenant_id: input.tenantId,
    lead_id: input.leadId,
    author,
    author_role: input.authorRole ?? null,
    category: input.category ?? 'observacao',
    note: input.note.trim().slice(0, 5000),
  })
  if (error) throw new Error(error.message)
}

/** Busca leads por nome (pro seletor de paciente da nota). */
export async function searchLeadsByName(tenantId: string, term: string): Promise<Array<{ id: string; name: string; phone: string }>> {
  if (!supabase || !term.trim()) return []
  const { data } = await supabase.from('leads').select('id, patient_name, phone')
    .eq('tenant_id', tenantId).ilike('patient_name', `%${term.trim()}%`)
    .order('created_at', { ascending: false }).limit(12)
  return ((data ?? []) as Array<{ id: string; patient_name: string; phone: string }>)
    .map((l) => ({ id: String(l.id), name: String(l.patient_name ?? 'Sem nome'), phone: String(l.phone ?? '') }))
}
