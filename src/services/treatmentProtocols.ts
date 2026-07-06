import { supabase } from '@/lib/supabaseClient'

// Protocolos de tratamento da clínica (além do tratamento capilar):
// catálogo de protocolos + protocolo atribuído ao paciente com registro de
// sessões. O nome/sessões/preço são copiados na atribuição (snapshot) — mudar
// o catálogo depois não altera protocolos já em andamento.

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

// ------------------------------------------------------------------ catálogo

export type TreatmentProtocol = {
  id: string
  name: string
  category: string | null
  sessionsPlanned: number
  intervalDays: number | null
  defaultPrice: number | null
  description: string | null
  active: boolean
}

export async function listProtocolCatalog(): Promise<TreatmentProtocol[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('treatment_protocols')
    .select('id, name, category, sessions_planned, interval_days, default_price, description, active')
    .eq('active', true)
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    category: r.category != null ? String(r.category) : null,
    sessionsPlanned: Number(r.sessions_planned ?? 1),
    intervalDays: r.interval_days != null ? Number(r.interval_days) : null,
    defaultPrice: r.default_price != null ? Number(r.default_price) : null,
    description: r.description != null ? String(r.description) : null,
    active: Boolean(r.active),
  }))
}

export async function createProtocol(payload: {
  name: string
  category?: string
  sessionsPlanned: number
  intervalDays?: number | null
  defaultPrice?: number | null
  description?: string
}): Promise<void> {
  const client = assertClient()
  if (payload.name.trim().length < 2) throw new Error('Informe o nome do protocolo.')
  if (!Number.isFinite(payload.sessionsPlanned) || payload.sessionsPlanned < 1) {
    throw new Error('Informe o número de sessões (mínimo 1).')
  }
  const { error } = await client.from('treatment_protocols').insert({
    name: payload.name.trim(),
    category: payload.category?.trim() || null,
    sessions_planned: Math.round(payload.sessionsPlanned),
    interval_days: payload.intervalDays ?? null,
    default_price: payload.defaultPrice ?? null,
    description: payload.description?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

export async function deactivateProtocol(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client
    .from('treatment_protocols')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// -------------------------------------------------- protocolos do paciente

export type LeadProtocolStatus = 'ativo' | 'pausado' | 'concluido' | 'cancelado'

export type LeadProtocolSession = {
  id: string
  sessionNumber: number
  performedOn: string
  performedBy: string | null
  note: string | null
}

export type LeadProtocol = {
  id: string
  leadId: string
  protocolId: string | null
  name: string
  sessionsPlanned: number
  price: number | null
  status: LeadProtocolStatus
  startedOn: string
  finishedOn: string | null
  note: string | null
  createdAt: string
  sessions: LeadProtocolSession[]
}

const parseStatus = (v: unknown): LeadProtocolStatus =>
  v === 'pausado' || v === 'concluido' || v === 'cancelado' ? v : 'ativo'

/** Lista protocolos de pacientes. Com leadId filtra pela ficha; sem, traz os mais recentes. */
export async function listLeadProtocols(leadId?: string): Promise<LeadProtocol[]> {
  const client = assertClient()
  let query = client
    .from('lead_treatment_protocols')
    .select('id, lead_id, protocol_id, name, sessions_planned, price, status, started_on, finished_on, note, created_at')
    .order('created_at', { ascending: false })
  query = leadId ? query.eq('lead_id', leadId) : query.limit(200)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = data ?? []
  const ids = rows.map((r) => String(r.id))
  const byProtocol = new Map<string, LeadProtocolSession[]>()
  if (ids.length > 0) {
    const { data: sess, error: sessErr } = await client
      .from('lead_protocol_sessions')
      .select('id, lead_protocol_id, session_number, performed_on, performed_by, note')
      .in('lead_protocol_id', ids)
      .order('session_number')
    if (sessErr) throw new Error(sessErr.message)
    for (const s of sess ?? []) {
      const key = String(s.lead_protocol_id)
      const list = byProtocol.get(key) ?? []
      list.push({
        id: String(s.id),
        sessionNumber: Number(s.session_number ?? 0),
        performedOn: String(s.performed_on ?? ''),
        performedBy: s.performed_by != null ? String(s.performed_by) : null,
        note: s.note != null ? String(s.note) : null,
      })
      byProtocol.set(key, list)
    }
  }
  return rows.map((r) => ({
    id: String(r.id),
    leadId: String(r.lead_id),
    protocolId: r.protocol_id != null ? String(r.protocol_id) : null,
    name: String(r.name),
    sessionsPlanned: Number(r.sessions_planned ?? 1),
    price: r.price != null ? Number(r.price) : null,
    status: parseStatus(r.status),
    startedOn: String(r.started_on ?? ''),
    finishedOn: r.finished_on != null ? String(r.finished_on) : null,
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at ?? ''),
    sessions: byProtocol.get(String(r.id)) ?? [],
  }))
}

export async function startLeadProtocol(payload: {
  leadId: string
  protocolId?: string | null
  name: string
  sessionsPlanned: number
  price?: number | null
  startedOn?: string | null
  note?: string
}): Promise<void> {
  const client = assertClient()
  if (!payload.leadId) throw new Error('Escolha o paciente (lead do CRM).')
  if (payload.name.trim().length < 2) throw new Error('Informe o nome do protocolo.')
  if (!Number.isFinite(payload.sessionsPlanned) || payload.sessionsPlanned < 1) {
    throw new Error('Informe o número de sessões (mínimo 1).')
  }
  const { error } = await client.from('lead_treatment_protocols').insert({
    lead_id: payload.leadId,
    protocol_id: payload.protocolId || null,
    name: payload.name.trim(),
    sessions_planned: Math.round(payload.sessionsPlanned),
    price: payload.price ?? null,
    started_on: payload.startedOn || undefined,
    note: payload.note?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

export async function registerSession(payload: {
  leadProtocolId: string
  sessionNumber: number
  performedOn?: string | null
  performedBy?: string
  note?: string
}): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('lead_protocol_sessions').insert({
    lead_protocol_id: payload.leadProtocolId,
    session_number: payload.sessionNumber,
    performed_on: payload.performedOn || undefined,
    performed_by: payload.performedBy?.trim() || null,
    note: payload.note?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

export async function setLeadProtocolStatus(id: string, status: LeadProtocolStatus): Promise<void> {
  const client = assertClient()
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (status === 'concluido' || status === 'cancelado') {
    patch.finished_on = new Date().toISOString().slice(0, 10)
  } else {
    patch.finished_on = null
  }
  const { error } = await client.from('lead_treatment_protocols').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}
