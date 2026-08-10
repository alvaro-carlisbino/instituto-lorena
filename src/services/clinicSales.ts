import { supabase } from '@/lib/supabaseClient'

/**
 * Central de Vendas da clínica: a aba VENDAS das planilhas da Aline (transplante)
 * e da Ingrid (spa/protocolos).
 *
 * As listas de opção abaixo saíram das planilhas de verdade, com a grafia delas.
 * São sugestões, não trava: o campo aceita texto livre, porque procedimento novo
 * aparece antes de qualquer deploy.
 */

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type ClinicSaleKind = 'cirurgia' | 'protocolo'
export type ClinicSaleStatus = 'vendida' | 'agendada' | 'realizada' | 'cancelada'

export type ClinicSale = {
  id: string
  kind: ClinicSaleKind
  leadId: string | null
  patientName: string
  phone: string | null
  city: string | null
  origin: string | null
  soldAt: string
  consultationAt: string | null
  consultationType: string | null
  procedureLabel: string
  sellerDoctor: string | null
  attendingDoctor: string | null
  performingDoctor: string | null
  anesthetist: string | null
  valueCents: number
  depositCents: number | null
  depositAt: string | null
  paymentMethod: string | null
  installments: number | null
  invoiceIssued: boolean
  scheduledAt: string | null
  schedulePending: boolean
  durationMinutes: number | null
  room: string | null
  hotelNeeded: boolean
  contractUrl: string | null
  note: string | null
  status: ClinicSaleStatus
  canceledAt: string | null
  cancelReason: string | null
  refundStatus: string | null
  cancelNote: string | null
  surgeryAccountId: string | null
  srgSurgeryId: number | null
  createdAt: string
}

export type ChecklistItem = {
  id: string
  saleId: string
  item: string
  required: boolean
  position: number
  receivedAt: string | null
  note: string | null
}

export type SurgeryReminder = {
  id: string
  saleId: string
  kind: 'd30' | 'd15' | 'd7' | 'd2'
  scheduledFor: string
  status: 'pendente' | 'enviado' | 'simulado' | 'cancelado' | 'erro'
  sentAt: string | null
  error: string | null
}

/** Procedimentos que aparecem na planilha da Aline, na grafia dela. */
export const PROCEDURE_OPTIONS = [
  'Tc Frontal/ Coroa',
  'Tc Frontal',
  'Tc Frontal/ Coroa/ Barba',
  'Tc masculino/ Barba',
  'Barba',
  'Sobrancelha',
  'Sobrancelha + Nanofat',
  'TC Feminino',
  'TC Feminino + Nanofat',
  'TC Feminino + Sobrancelha',
]

/** Protocolos da planilha da Ingrid. */
export const PROTOCOL_OPTIONS = [
  'Protocolo pós TC',
  'Protocolo convencional',
  'Protocolo inicial 3 sessões',
  'Pacote 3 sessões de tratamento',
  'Pacote terapia',
  'Exossomos',
  'Células',
  'MMP',
  'Mesoject',
]

export const CONSULTATION_TYPES = ['Consulta clínica', 'Retorno 1 mês', 'Retorno clínico', 'Consulta TC']

export const PAYMENT_METHODS = [
  'Dinheiro',
  'Pix',
  'Cartão de crédito',
  'Cartão de débito',
  'Boleto',
  'Transferência',
  'Misto',
]

/** Origens que a Aline escreve na coluna de indicação. */
export const ORIGIN_OPTIONS = [
  'Indicação',
  'Instagram',
  'Google',
  'Já é paciente',
  'Tráfego pago',
  'Site',
  'Indicação médica',
]

function mapSale(r: Record<string, unknown>): ClinicSale {
  const num = (v: unknown) => (v == null ? null : Number(v))
  const str = (v: unknown) => (v == null || String(v).length === 0 ? null : String(v))
  return {
    id: String(r.id),
    kind: r.kind === 'protocolo' ? 'protocolo' : 'cirurgia',
    leadId: str(r.lead_id),
    patientName: String(r.patient_name ?? ''),
    phone: str(r.phone),
    city: str(r.city),
    origin: str(r.origin),
    soldAt: String(r.sold_at ?? ''),
    consultationAt: str(r.consultation_at),
    consultationType: str(r.consultation_type),
    procedureLabel: String(r.procedure_label ?? ''),
    sellerDoctor: str(r.seller_doctor),
    attendingDoctor: str(r.attending_doctor),
    performingDoctor: str(r.performing_doctor),
    anesthetist: str(r.anesthetist),
    valueCents: Number(r.value_cents ?? 0),
    depositCents: num(r.deposit_cents),
    depositAt: str(r.deposit_at),
    paymentMethod: str(r.payment_method),
    installments: num(r.installments),
    invoiceIssued: r.invoice_issued === true,
    scheduledAt: str(r.scheduled_at),
    schedulePending: r.schedule_pending === true,
    durationMinutes: num(r.duration_minutes),
    room: str(r.room),
    hotelNeeded: r.hotel_needed === true,
    contractUrl: str(r.contract_url),
    note: str(r.note),
    status: (['vendida', 'agendada', 'realizada', 'cancelada'] as const).includes(r.status as ClinicSaleStatus)
      ? (r.status as ClinicSaleStatus)
      : 'vendida',
    canceledAt: str(r.canceled_at),
    cancelReason: str(r.cancel_reason),
    refundStatus: str(r.refund_status),
    cancelNote: str(r.cancel_note),
    surgeryAccountId: str(r.surgery_account_id),
    srgSurgeryId: r.srg_surgery_id != null ? Number(r.srg_surgery_id) : null,
    createdAt: String(r.created_at ?? ''),
  }
}

const SALE_COLS =
  'id, kind, lead_id, patient_name, phone, city, origin, sold_at, consultation_at, consultation_type, ' +
  'procedure_label, seller_doctor, attending_doctor, performing_doctor, anesthetist, value_cents, ' +
  'deposit_cents, deposit_at, payment_method, installments, invoice_issued, scheduled_at, schedule_pending, ' +
  'duration_minutes, room, hotel_needed, contract_url, note, status, canceled_at, cancel_reason, ' +
  'refund_status, cancel_note, surgery_account_id, srg_surgery_id, created_at'

export async function listClinicSales(kind?: ClinicSaleKind, limit = 400): Promise<ClinicSale[]> {
  const client = assertClient()
  let q = client.from('clinic_sales').select(SALE_COLS).order('sold_at', { ascending: false }).limit(limit)
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  // A lista de colunas é montada por concatenação, então o supabase-js não
  // consegue inferir a linha e devolve GenericStringError. Passa por unknown.
  return (data ?? []).map((r) => mapSale(r as unknown as Record<string, unknown>))
}

export type ClinicSaleInput = {
  kind: ClinicSaleKind
  leadId?: string | null
  patientName: string
  phone?: string | null
  city?: string | null
  origin?: string | null
  soldAt: string
  consultationAt?: string | null
  consultationType?: string | null
  procedureLabel: string
  sellerDoctor?: string | null
  attendingDoctor?: string | null
  performingDoctor?: string | null
  anesthetist?: string | null
  valueCents: number
  depositCents?: number | null
  depositAt?: string | null
  paymentMethod?: string | null
  installments?: number | null
  invoiceIssued?: boolean
  scheduledAt?: string | null
  schedulePending?: boolean
  durationMinutes?: number | null
  room?: string | null
  hotelNeeded?: boolean
  contractUrl?: string | null
  note?: string | null
}

function toRow(input: ClinicSaleInput) {
  return {
    kind: input.kind,
    lead_id: input.leadId || null,
    patient_name: input.patientName.trim(),
    phone: input.phone || null,
    city: input.city?.trim() || null,
    origin: input.origin?.trim() || null,
    sold_at: input.soldAt,
    consultation_at: input.consultationAt || null,
    consultation_type: input.consultationType?.trim() || null,
    procedure_label: input.procedureLabel.trim(),
    seller_doctor: input.sellerDoctor || null,
    attending_doctor: input.attendingDoctor || null,
    performing_doctor: input.performingDoctor || input.sellerDoctor || null,
    anesthetist: input.anesthetist || null,
    value_cents: Math.max(0, Math.round(input.valueCents)),
    deposit_cents: input.depositCents != null ? Math.max(0, Math.round(input.depositCents)) : null,
    deposit_at: input.depositAt || null,
    payment_method: input.paymentMethod || null,
    installments: input.installments ?? null,
    invoice_issued: input.invoiceIssued === true,
    scheduled_at: input.scheduledAt || null,
    schedule_pending: input.schedulePending === true,
    duration_minutes: input.durationMinutes ?? null,
    room: input.room?.trim() || null,
    hotel_needed: input.hotelNeeded === true,
    contract_url: input.contractUrl?.trim() || null,
    note: input.note?.trim() || null,
    status: input.scheduledAt ? 'agendada' : 'vendida',
  }
}

/**
 * Erros que a planilha não conseguia reclamar. Existe venda registrada em
 * 31/07/2026 com data de procedimento em 04/01/2026, três meses antes da venda.
 */
function validate(input: ClinicSaleInput) {
  if (input.patientName.trim().length < 2) throw new Error('Informe o paciente.')
  if (input.procedureLabel.trim().length < 2) throw new Error('Informe o procedimento.')
  if (!input.soldAt) throw new Error('Informe a data da venda.')
  if (input.valueCents <= 0) throw new Error('Informe o valor da venda.')
  if (!input.scheduledAt && !input.schedulePending) {
    throw new Error('Marque a data do procedimento ou marque "a definir".')
  }
  if (input.scheduledAt && input.scheduledAt.slice(0, 10) < input.soldAt) {
    throw new Error('A data do procedimento está antes da data da venda. Confira o ano.')
  }
  if (input.depositCents != null && input.depositCents > input.valueCents) {
    throw new Error('A entrada é maior que o valor da venda.')
  }
}

export async function createClinicSale(input: ClinicSaleInput): Promise<string> {
  const client = assertClient()
  validate(input)
  const { data, error } = await client.from('clinic_sales').insert(toRow(input)).select('id').single()
  if (error) throw new Error(error.message)
  return String((data as { id: unknown }).id)
}

export async function updateClinicSale(id: string, input: ClinicSaleInput): Promise<void> {
  const client = assertClient()
  validate(input)
  const { error } = await client.from('clinic_sales').update(toRow(input)).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Remarcação: muda só a data, e o gatilho do banco refaz a fila de lembretes. */
export async function rescheduleSale(id: string, scheduledAt: string | null): Promise<void> {
  const client = assertClient()
  const { error } = await client
    .from('clinic_sales')
    .update({
      scheduled_at: scheduledAt,
      schedule_pending: scheduledAt == null,
      status: scheduledAt ? 'agendada' : 'vendida',
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function cancelClinicSale(
  id: string,
  payload: { reason: string; refundStatus?: string; note?: string },
): Promise<void> {
  const client = assertClient()
  if (!payload.reason.trim()) throw new Error('Informe o motivo do cancelamento.')
  const { error } = await client
    .from('clinic_sales')
    .update({
      status: 'cancelada',
      canceled_at: new Date().toISOString().slice(0, 10),
      cancel_reason: payload.reason.trim(),
      refund_status: payload.refundStatus?.trim() || 'Em avaliação',
      cancel_note: payload.note?.trim() || null,
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listChecklist(saleIds: string[]): Promise<Map<string, ChecklistItem[]>> {
  const client = assertClient()
  if (saleIds.length === 0) return new Map()
  const { data, error } = await client
    .from('surgery_checklist_items')
    .select('id, sale_id, item, required, position, received_at, note')
    .in('sale_id', saleIds)
    .order('position', { ascending: true })
  if (error) throw new Error(error.message)
  const out = new Map<string, ChecklistItem[]>()
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>
    const saleId = String(row.sale_id)
    const list = out.get(saleId) ?? []
    list.push({
      id: String(row.id),
      saleId,
      item: String(row.item ?? ''),
      required: row.required === true,
      position: Number(row.position ?? 0),
      receivedAt: row.received_at != null ? String(row.received_at) : null,
      note: row.note != null ? String(row.note) : null,
    })
    out.set(saleId, list)
  }
  return out
}

export async function setChecklistReceived(itemId: string, received: boolean): Promise<void> {
  const client = assertClient()
  const { error } = await client
    .from('surgery_checklist_items')
    .update({ received_at: received ? new Date().toISOString() : null })
    .eq('id', itemId)
  if (error) throw new Error(error.message)
}

export async function listReminders(saleIds: string[]): Promise<Map<string, SurgeryReminder[]>> {
  const client = assertClient()
  if (saleIds.length === 0) return new Map()
  const { data, error } = await client
    .from('surgery_reminders')
    .select('id, sale_id, kind, scheduled_for, status, sent_at, error')
    .in('sale_id', saleIds)
    .order('scheduled_for', { ascending: true })
  if (error) throw new Error(error.message)
  const out = new Map<string, SurgeryReminder[]>()
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>
    const saleId = String(row.sale_id)
    const list = out.get(saleId) ?? []
    list.push({
      id: String(row.id),
      saleId,
      kind: row.kind as SurgeryReminder['kind'],
      scheduledFor: String(row.scheduled_for),
      status: row.status as SurgeryReminder['status'],
      sentAt: row.sent_at != null ? String(row.sent_at) : null,
      error: row.error != null ? String(row.error) : null,
    })
    out.set(saleId, list)
  }
  return out
}

export type StaffMember = { id: number; nome: string; tipo: string }

/**
 * Médicos e anestesistas vêm do espelho do centro cirúrgico, não de uma lista
 * fixa aqui. Quem entra ou sai da equipe é cadastrado lá, e é o mesmo nome que
 * vai aparecer no bloco de hora quando a cirurgia acontecer.
 */
export async function listSurgicalStaff(): Promise<StaffMember[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('srg_staff')
    .select('id, nome, tipo')
    .in('tipo', ['MEDICO', 'ANESTESISTA'])
    .order('nome', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: Number((r as Record<string, unknown>).id),
    nome: String((r as Record<string, unknown>).nome ?? ''),
    tipo: String((r as Record<string, unknown>).tipo ?? ''),
  }))
}

/** Faturamento e conversão por médico, o relatório que hoje é digitado na mão. */
export function salesByDoctor(sales: ClinicSale[]) {
  const map = new Map<string, { vendeu: number; valorCents: number; executa: number }>()
  const touch = (nome: string) => {
    const cur = map.get(nome) ?? { vendeu: 0, valorCents: 0, executa: 0 }
    map.set(nome, cur)
    return cur
  }
  for (const s of sales) {
    if (s.status === 'cancelada') continue
    if (s.sellerDoctor) {
      const e = touch(s.sellerDoctor)
      e.vendeu += 1
      e.valorCents += s.valueCents
    }
    if (s.performingDoctor) touch(s.performingDoctor).executa += 1
  }
  return [...map.entries()]
    .map(([nome, v]) => ({ nome, ...v, ticketCents: v.vendeu > 0 ? Math.round(v.valorCents / v.vendeu) : 0 }))
    .sort((a, b) => b.valorCents - a.valorCents)
}
