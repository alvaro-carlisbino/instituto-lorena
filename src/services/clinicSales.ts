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
/** Para quem o paciente pagou a entrada. Nem toda entrada passa pela clínica. */
export type DepositPayee = 'clinica' | 'anestesista'
/** A confirmação da cirurgia com o paciente, que substituiu o checklist na tela. */
export type ConfirmationStatus = 'confirmada' | 'nao_confirmada' | 'remanejar'

export const CONFIRMATION_LABEL: Record<ConfirmationStatus, string> = {
  confirmada: 'Confirmada',
  nao_confirmada: 'Não confirmada',
  remanejar: 'Remanejar',
}

export const DEPOSIT_PAYEE_LABEL: Record<DepositPayee, string> = {
  clinica: 'Clínica',
  anestesista: 'Anestesista',
}

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
  /** Consultora que fechou (Aline, Ingrid). Quem vende não é o médico da consulta. */
  sellerName: string | null
  sellerDoctor: string | null
  attendingDoctor: string | null
  performingDoctor: string | null
  anesthetist: string | null
  valueCents: number
  depositCents: number | null
  depositAt: string | null
  depositPayee: DepositPayee | null
  paymentMethod: string | null
  installments: number | null
  invoiceIssued: boolean
  confirmationStatus: ConfirmationStatus
  confirmationAt: string | null
  confirmationNote: string | null
  costMaterialsCents: number
  costDoctorCents: number
  taxCents: number
  costOtherCents: number
  /** Coluna gerada no banco: valor menos os quatro custos. */
  profitCents: number
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
    sellerName: str(r.seller_name),
    sellerDoctor: str(r.seller_doctor),
    attendingDoctor: str(r.attending_doctor),
    performingDoctor: str(r.performing_doctor),
    anesthetist: str(r.anesthetist),
    valueCents: Number(r.value_cents ?? 0),
    depositCents: num(r.deposit_cents),
    depositAt: str(r.deposit_at),
    depositPayee:
      r.deposit_payee === 'clinica' || r.deposit_payee === 'anestesista' ? r.deposit_payee : null,
    paymentMethod: str(r.payment_method),
    installments: num(r.installments),
    invoiceIssued: r.invoice_issued === true,
    confirmationStatus: (['confirmada', 'nao_confirmada', 'remanejar'] as const).includes(
      r.confirmation_status as ConfirmationStatus,
    )
      ? (r.confirmation_status as ConfirmationStatus)
      : 'nao_confirmada',
    confirmationAt: str(r.confirmation_at),
    confirmationNote: str(r.confirmation_note),
    costMaterialsCents: Number(r.cost_materials_cents ?? 0),
    costDoctorCents: Number(r.cost_doctor_cents ?? 0),
    taxCents: Number(r.tax_cents ?? 0),
    costOtherCents: Number(r.cost_other_cents ?? 0),
    profitCents: Number(r.profit_cents ?? 0),
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
  'procedure_label, seller_name, seller_doctor, attending_doctor, performing_doctor, anesthetist, value_cents, ' +
  'deposit_cents, deposit_at, deposit_payee, payment_method, installments, invoice_issued, scheduled_at, ' +
  'schedule_pending, duration_minutes, room, hotel_needed, contract_url, note, status, canceled_at, ' +
  'cancel_reason, refund_status, cancel_note, surgery_account_id, srg_surgery_id, created_at, ' +
  'confirmation_status, confirmation_at, confirmation_note, cost_materials_cents, cost_doctor_cents, ' +
  'tax_cents, cost_other_cents, profit_cents'

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
  sellerName?: string | null
  sellerDoctor?: string | null
  attendingDoctor?: string | null
  performingDoctor?: string | null
  anesthetist?: string | null
  valueCents: number
  depositCents?: number | null
  depositAt?: string | null
  depositPayee?: DepositPayee | null
  paymentMethod?: string | null
  installments?: number | null
  invoiceIssued?: boolean
  costMaterialsCents?: number | null
  costDoctorCents?: number | null
  taxCents?: number | null
  costOtherCents?: number | null
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
    seller_name: input.sellerName?.trim() || null,
    // seller_doctor espelha quem atendeu: na planilha quem vende é quem faz a
    // consulta. A coluna fica por compatibilidade com quem já consulta a tabela.
    seller_doctor: input.attendingDoctor || input.sellerDoctor || null,
    attending_doctor: input.attendingDoctor || null,
    performing_doctor: input.performingDoctor || input.attendingDoctor || null,
    anesthetist: input.anesthetist || null,
    value_cents: Math.max(0, Math.round(input.valueCents)),
    deposit_cents: input.depositCents != null ? Math.max(0, Math.round(input.depositCents)) : null,
    deposit_at: input.depositAt || null,
    deposit_payee: input.depositPayee || null,
    cost_materials_cents: Math.max(0, Math.round(input.costMaterialsCents ?? 0)),
    cost_doctor_cents: Math.max(0, Math.round(input.costDoctorCents ?? 0)),
    tax_cents: Math.max(0, Math.round(input.taxCents ?? 0)),
    cost_other_cents: Math.max(0, Math.round(input.costOtherCents ?? 0)),
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

export type ResultadoEnfermagem = {
  /** Se a agenda do centro cirúrgico foi de fato alterada. */
  tocou: boolean
  acao?: string
  motivo?: string
  /** Quando a sala já começou: o sistema não mexe, alguém precisa ligar lá. */
  precisaAvisar?: boolean
}

/**
 * Remarca ou cancela a cirurgia no CRM **e** na agenda da enfermagem.
 *
 * Passa por edge function porque o outro lado é o MySQL do centro cirúrgico, que
 * o navegador não alcança. A resposta diz o que aconteceu lá: cirurgia que a sala
 * já iniciou não é alterada por sistema nenhum, e nesse caso a tela avisa para
 * falar com a equipe em vez de deixar a recepção achar que resolveu.
 */
async function chamarRemarcacao(payload: Record<string, unknown>): Promise<ResultadoEnfermagem> {
  const client = assertClient()
  const { data, error } = await client.functions.invoke('crm-cirurgia-remarcar', { body: payload })
  const corpo = (data ?? {}) as { ok?: boolean; error?: string; enfermagem?: ResultadoEnfermagem }
  if (error && !corpo.error) throw new Error(error.message)
  if (corpo.error || corpo.ok === false) throw new Error(corpo.error || 'Falha ao atualizar a cirurgia')
  return corpo.enfermagem ?? { tocou: false }
}

export async function remarcarCirurgia(saleId: string, scheduledAt: string): Promise<ResultadoEnfermagem> {
  return chamarRemarcacao({ saleId, action: 'remarcar', scheduledAt })
}

export async function cancelarCirurgia(
  saleId: string,
  payload: { reason: string; refundStatus?: string; note?: string },
): Promise<ResultadoEnfermagem> {
  if (!payload.reason.trim()) throw new Error('Informe o motivo do cancelamento.')
  return chamarRemarcacao({ saleId, action: 'cancelar', ...payload })
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

/**
 * Confirmação da cirurgia com o paciente.
 *
 * Substituiu, na tela, as seis caixinhas de documento por uma pergunta só. O
 * carimbo de hora vai junto porque "confirmada" de duas semanas atrás, para uma
 * cirurgia de amanhã, não é a mesma coisa que confirmada hoje.
 */
export async function setSaleConfirmation(
  id: string,
  status: ConfirmationStatus,
  note?: string | null,
): Promise<void> {
  const client = assertClient()
  const { error } = await client
    .from('clinic_sales')
    .update({
      confirmation_status: status,
      confirmation_at: status === 'nao_confirmada' ? null : new Date().toISOString(),
      confirmation_note: note?.trim() || null,
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * O "tipo de negociação" que a gestão pede, montado do que já é registrado.
 *
 * Não virou coluna nova de propósito: forma de pagamento e parcelas já estão
 * preenchidas em toda venda, e um segundo campo dizendo a mesma coisa é um campo
 * a mais para divergir do primeiro.
 */
export function tipoNegociacao(sale: ClinicSale): string {
  const partes: string[] = []
  if (sale.paymentMethod) partes.push(sale.paymentMethod)
  if (sale.installments && sale.installments > 1) partes.push(`${sale.installments}x`)
  else if (sale.paymentMethod && !sale.installments) partes.push('à vista')
  if (partes.length === 0) return '—'
  return partes.join(' · ')
}

export type SalesTarget = {
  id: string
  month: string
  kind: ClinicSaleKind
  /** Null = meta da clínica inteira. */
  sellerName: string | null
  targetCents: number
  targetCount: number
  note: string | null
}

export async function listSalesTargets(kind: ClinicSaleKind): Promise<SalesTarget[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('clinic_sales_targets')
    .select('id, month, kind, seller_name, target_cents, target_count, note')
    .eq('kind', kind)
    .order('month', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: String(row.id),
      month: String(row.month).slice(0, 7),
      kind: row.kind === 'protocolo' ? 'protocolo' : 'cirurgia',
      sellerName: row.seller_name != null && String(row.seller_name) ? String(row.seller_name) : null,
      targetCents: Number(row.target_cents ?? 0),
      targetCount: Number(row.target_count ?? 0),
      note: row.note != null ? String(row.note) : null,
    }
  })
}

/**
 * Grava a meta do mês. `month` chega como AAAA-MM e vira o dia 1: o banco guarda
 * date para não conviver com "2026-8" e "2026-08" na mesma coluna.
 */
export async function saveSalesTarget(payload: {
  month: string
  kind: ClinicSaleKind
  sellerName?: string | null
  targetCents: number
  targetCount: number
  note?: string | null
}): Promise<void> {
  const client = assertClient()
  if (!/^\d{4}-\d{2}$/.test(payload.month)) throw new Error('Escolha o mês da meta.')
  if (payload.targetCents <= 0 && payload.targetCount <= 0) {
    throw new Error('Informe a meta de faturamento ou a de quantidade.')
  }
  const vendedora = payload.sellerName?.trim() || null
  const linha = {
    month: `${payload.month}-01`,
    kind: payload.kind,
    seller_name: vendedora,
    target_cents: Math.max(0, Math.round(payload.targetCents)),
    target_count: Math.max(0, Math.round(payload.targetCount)),
    note: payload.note?.trim() || null,
  }

  // Procura antes de gravar em vez de upsert: o índice único do banco usa
  // coalesce(seller_name, '*') para que duas metas gerais do mesmo mês não
  // convivam, e o PostgREST não sabe apontar um onConflict para índice com
  // expressão — o upsert viraria insert e estouraria no índice.
  let busca = client
    .from('clinic_sales_targets')
    .select('id')
    .eq('month', linha.month)
    .eq('kind', linha.kind)
  busca = vendedora ? busca.eq('seller_name', vendedora) : busca.is('seller_name', null)
  const { data: existente, error: buscaErr } = await busca.maybeSingle()
  if (buscaErr) throw new Error(buscaErr.message)

  if (existente) {
    const { error } = await client
      .from('clinic_sales_targets')
      .update(linha)
      .eq('id', String((existente as { id: unknown }).id))
    if (error) throw new Error(error.message)
    return
  }
  const { error } = await client.from('clinic_sales_targets').insert(linha)
  if (error) throw new Error(error.message)
}

export async function deleteSalesTarget(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('clinic_sales_targets').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export type MetaProgresso = {
  metaCents: number
  metaQtd: number
  realizadoCents: number
  realizadoQtd: number
  pctValor: number
  pctQtd: number
  faltaCents: number
  /** Projeção linear pelo ritmo do mês até aqui. Só faz sentido no mês corrente. */
  projecaoCents: number
  diasDecorridos: number
  diasNoMes: number
}

/**
 * O quanto do mês já foi feito contra o que foi combinado.
 *
 * A projeção é régua de três com o dia de hoje, o mesmo cálculo que ela faz de
 * cabeça no meio do mês ("nesse ritmo a gente fecha em tanto"). Em mês passado o
 * ritmo não quer dizer nada, então a tela não mostra.
 */
export function progressoDaMeta(
  vendas: ClinicSale[],
  meta: SalesTarget | null,
  mes: string,
  hoje = new Date(),
): MetaProgresso {
  const realizadoCents = vendas.reduce((acc, s) => acc + s.valueCents, 0)
  const realizadoQtd = vendas.length
  const [ano, m] = mes.split('-').map(Number)
  const diasNoMes = new Date(ano, m, 0).getDate()
  const mesCorrente = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}` === mes
  const diasDecorridos = mesCorrente ? hoje.getDate() : diasNoMes
  const metaCents = meta?.targetCents ?? 0
  const metaQtd = meta?.targetCount ?? 0
  return {
    metaCents,
    metaQtd,
    realizadoCents,
    realizadoQtd,
    pctValor: metaCents > 0 ? Math.round((realizadoCents / metaCents) * 100) : 0,
    pctQtd: metaQtd > 0 ? Math.round((realizadoQtd / metaQtd) * 100) : 0,
    faltaCents: Math.max(metaCents - realizadoCents, 0),
    projecaoCents:
      diasDecorridos > 0 ? Math.round((realizadoCents / diasDecorridos) * diasNoMes) : realizadoCents,
    diasDecorridos,
    diasNoMes,
  }
}

/** Faturamento, custo e lucro de um conjunto de vendas. */
export function resultadoDasVendas(vendas: ClinicSale[]) {
  let receita = 0
  let material = 0
  let repasse = 0
  let imposto = 0
  let outros = 0
  for (const s of vendas) {
    receita += s.valueCents
    material += s.costMaterialsCents
    repasse += s.costDoctorCents
    imposto += s.taxCents
    outros += s.costOtherCents
  }
  const custo = material + repasse + imposto + outros
  return {
    receita,
    material,
    repasse,
    imposto,
    outros,
    custo,
    lucro: receita - custo,
    margem: receita > 0 ? Math.round(((receita - custo) / receita) * 100) : 0,
    /** Quantas vendas ainda não tiveram nenhum custo lançado. */
    semCusto: vendas.filter(
      (s) => s.costMaterialsCents + s.costDoctorCents + s.taxCents + s.costOtherCents === 0,
    ).length,
  }
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

/**
 * Vendedoras já registradas, para sugerir no campo sem fixar nome de gente no código.
 *
 * A lista não vem de uma constante com "Aline" e "Ingrid" porque quem fecha venda muda
 * (entra, sai, cobre férias) e nome fixo no código só se corrige com deploy. A primeira
 * venda de cada uma é digitada; da segunda em diante o nome já aparece na sugestão, que
 * é o que evita "Ingrid" e "ingrid " virarem duas pessoas no relatório.
 */
export async function listSellerNames(): Promise<string[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('clinic_sales')
    .select('seller_name')
    .not('seller_name', 'is', null)
    .order('sold_at', { ascending: false })
    .limit(1000)
  if (error) throw new Error(error.message)
  const nomes = new Set<string>()
  for (const r of data ?? []) {
    const nome = String((r as Record<string, unknown>).seller_name ?? '').trim()
    if (nome) nomes.add(nome)
  }
  return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

export type StaffMember = { id: number; nome: string; tipo: string }

export type AnesthesiaProvider = { id: string; nome: string; srgStaffId: number | null }

/**
 * Quem faz a anestesia: a lista da clínica, não a do centro cirúrgico.
 *
 * Vem de tabela própria porque o espelho da sala só cadastra PESSOA, e metade das
 * opções que a clínica usa é empresa (Grupo Ingá, Clínica Loviderm — o Grupo Ingá
 * já era caixa na conciliação do Shosp antes de existir aqui). O espelho também é
 * recarregado a cada sync, então nome corrigido nele volta ao errado sozinho, e
 * ele guarda quem não atende mais.
 */
export async function listAnesthesiaProviders(): Promise<AnesthesiaProvider[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('anesthesia_providers')
    .select('id, name, srg_staff_id, position')
    .eq('active', true)
    .order('position', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: String(row.id),
      nome: String(row.name ?? ''),
      srgStaffId: row.srg_staff_id != null ? Number(row.srg_staff_id) : null,
    }
  })
}

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

/**
 * Faturamento e conversão por médico, o relatório que hoje é digitado na mão.
 *
 * Quem vendeu é quem ATENDEU a consulta, não a coluna "MÉDICO" da planilha. A
 * própria planilha prova: na aba "Relatorio Dr Matheus" as duas colunas se
 * chamam "Médico para quem fechou" e "Médico que atendeu", e em 159 das 163
 * linhas do relatório dele a primeira é Matheus enquanto a segunda é Lorena em
 * 98 delas. Ou seja, a Lorena atende e fecha para o Matheus operar.
 */
export function salesByDoctor(sales: ClinicSale[]) {
  const map = new Map<string, { vendeu: number; valorCents: number; executa: number; followUp: number }>()
  const touch = (nome: string) => {
    const cur = map.get(nome) ?? { vendeu: 0, valorCents: 0, executa: 0, followUp: 0 }
    map.set(nome, cur)
    return cur
  }
  for (const s of sales) {
    if (s.status === 'cancelada') continue
    const vendedor = s.attendingDoctor ?? s.sellerDoctor
    if (vendedor) {
      const e = touch(vendedor)
      e.vendeu += 1
      e.valorCents += s.valueCents
      // fechou depois da consulta = veio de follow-up, não do impulso da sala
      const dias = diasAteFechar(s)
      if (dias != null && dias > 0) e.followUp += 1
    }
    if (s.performingDoctor) touch(s.performingDoctor).executa += 1
  }
  return [...map.entries()]
    .map(([nome, v]) => ({ nome, ...v, ticketCents: v.vendeu > 0 ? Math.round(v.valorCents / v.vendeu) : 0 }))
    .sort((a, b) => b.valorCents - a.valorCents)
}

/**
 * Dias entre a consulta e a venda. Null quando não dá para saber.
 *
 * As duas colunas são `date` no banco, então a conta é de calendário e não passa
 * perto de fuso horário: subtrair timestamp aqui inventaria um dia de diferença
 * dependendo da hora em que a tela é aberta.
 */
export function diasAteFechar(sale: ClinicSale): number | null {
  if (!sale.consultationAt || !sale.soldAt) return null
  const consulta = Date.parse(`${sale.consultationAt.slice(0, 10)}T12:00:00Z`)
  const venda = Date.parse(`${sale.soldAt.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(consulta) || Number.isNaN(venda)) return null
  return Math.round((venda - consulta) / 86_400_000)
}

export type FollowUpStats = {
  total: number
  /** Fechou na própria consulta. */
  noDia: number
  /** Fechou depois, com trabalho de follow-up no meio. */
  followUp: number
  semConsulta: number
  /** Consulta registrada DEPOIS da venda: ou é pré-operatório, ou é data errada. */
  consultaDepois: number
  /** Mediana, não média: existe venda fechada 1004 dias depois da consulta, e uma só dessas desloca a média inteira. */
  medianaDias: number
  valorNoDiaCents: number
  valorFollowUpCents: number
}

/**
 * O quanto o follow-up vende, separado do que fecha na hora.
 *
 * Sem isso a Central de Vendas só mostrava faturamento do mês, e o trabalho de
 * quem persegue o paciente que saiu da consulta sem fechar ficava invisível — na
 * base de hoje são 69 das 213 cirurgias, com mediana bem longe da média.
 */
export function followUpStats(sales: ClinicSale[]): FollowUpStats {
  const validas = sales.filter((s) => s.status !== 'cancelada')
  const stats: FollowUpStats = {
    total: validas.length,
    noDia: 0,
    followUp: 0,
    semConsulta: 0,
    consultaDepois: 0,
    medianaDias: 0,
    valorNoDiaCents: 0,
    valorFollowUpCents: 0,
  }
  const prazos: number[] = []
  for (const s of validas) {
    const dias = diasAteFechar(s)
    if (dias == null) {
      stats.semConsulta += 1
    } else if (dias < 0) {
      stats.consultaDepois += 1
    } else if (dias === 0) {
      stats.noDia += 1
      stats.valorNoDiaCents += s.valueCents
    } else {
      stats.followUp += 1
      stats.valorFollowUpCents += s.valueCents
      prazos.push(dias)
    }
  }
  if (prazos.length > 0) {
    prazos.sort((a, b) => a - b)
    const meio = Math.floor(prazos.length / 2)
    stats.medianaDias =
      prazos.length % 2 === 0 ? Math.round((prazos[meio - 1] + prazos[meio]) / 2) : prazos[meio]
  }
  return stats
}

/**
 * URL do calendário assinável da agenda cirúrgica.
 *
 * Vem por RPC porque o token mora em app_cron_secrets, que é service_role only.
 * A função só devolve para quem é da equipe. No Google Agenda: "Outras agendas",
 * "Da URL", colar, e as cirurgias passam a aparecer lá sozinhas.
 */
export async function getAgendaIcsUrl(): Promise<string | null> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_ics_cirurgias_url')
  if (error) throw new Error(error.message)
  return data ? String(data) : null
}

const gcalStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/**
 * Link que abre o Google Agenda com o evento já preenchido. Serve para o caso em
 * que a cirurgia acabou de ser marcada e precisa estar na agenda agora, sem
 * esperar o Google reler o calendário assinado.
 */
export function googleCalendarLink(sale: ClinicSale): string | null {
  if (!sale.scheduledAt) return null
  const inicio = new Date(sale.scheduledAt)
  const fim = new Date(inicio.getTime() + (sale.durationMinutes && sale.durationMinutes > 0 ? sale.durationMinutes : 480) * 60000)
  const detalhes = [
    sale.performingDoctor ? `Médico: ${sale.performingDoctor}` : '',
    sale.anesthetist ? `Anestesista: ${sale.anesthetist}` : '',
    sale.city ? `Cidade do paciente: ${sale.city}` : '',
    sale.hotelNeeded ? 'Precisa de hotel' : '',
  ].filter(Boolean).join('\n')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Cirurgia: ${sale.patientName} (${sale.procedureLabel})`,
    dates: `${gcalStamp(inicio)}/${gcalStamp(fim)}`,
    details: detalhes,
    location: sale.room || 'Instituto Lorena Visentainer',
    ctz: 'America/Sao_Paulo',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
