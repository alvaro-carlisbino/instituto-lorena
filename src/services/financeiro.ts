import { diaLocal, hojeLocal } from '@/lib/diaLocal'
import { buscarTudo } from '@/lib/supabasePaginate'
import { supabase } from '@/lib/supabaseClient'
import type { Payable } from '@/services/estoqueCompras'

// Financeiro da CLÍNICA (razão próprio: banco/caixa é a fonte) e do Tricopill por RLS.
// Todas as tabelas fin_* são multi-tenant com tenant_id default current_tenant_id() —
// o insert NÃO manda tenant_id; a RLS isola clínica × Tricopill sozinha.
// Dinheiro sempre em CENTAVOS. Datas em 'yyyy-mm-dd'.

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

// ─────────────────────────────────────────────────────────── contas / caixa

export type AccountKind = 'banco' | 'caixa' | 'carteira'

export type FinAccount = {
  id: string
  name: string
  kind: AccountKind
  bankName: string | null
  branch: string | null
  number: string | null
  openingBalanceCents: number
  active: boolean
  note: string | null
  /** Vínculo Open Finance (Pluggy): quando preenchido, a conta sincroniza sozinha. */
  ofProvider: string | null
  ofAccountId: string | null
  ofLastSyncAt: string | null
  /** Saldo que o banco informou. Em conta de cartão o significado varia por banco. */
  ofBalanceCents: number | null
  /** QUANDO O BANCO FOI LIDO, segundo o provedor. Não é a hora em que gravamos. */
  ofBalanceAt: string | null
  ofStatus: string | null
  /** Motivo do último sync que falhou. Preenchido = a conta parou de receber extrato. */
  ofLastError: string | null
  /** Extra do banco: no cartão traz fechamento, vencimento e limite da fatura. */
  ofMeta: OfAccountMeta | null
  /** Cartão: fatura do ciclo aberto, fatura fechada a vencer e dívida total. */
  ofBillOpenCents: number | null
  ofBillDueCents: number | null
  ofDebtTotalCents: number | null
  ofBillCloseDate: string | null
  ofBillDueDate: string | null
  /** Incidente aberto no provedor: os números podem vir degradados. */
  ofProviderNote: string | null
}

export type OfAccountMeta = {
  subtype?: string | null
  owner?: string | null
  /** true = saldo lido do banco na hora; false = último retrato guardado pelo provedor. */
  realtime?: boolean
  credit?: {
    brand?: string
    balanceCloseDate?: string
    balanceDueDate?: string
    creditLimit?: string
    availableCreditLimit?: string
  } | null
  bank?: { transferNumber?: string; closingBalance?: string } | null
}

const ACCOUNT_COLS =
  'id, name, kind, bank_name, branch, number, opening_balance_cents, active, note, of_provider, of_account_id, of_last_sync_at, of_balance_cents, of_balance_at, of_status, of_last_error, of_meta, of_bill_open_cents, of_bill_due_cents, of_debt_total_cents, of_bill_close_date, of_bill_due_date, of_provider_note'

function mapAccount(r: Record<string, unknown>): FinAccount {
  const kind = (r.kind === 'caixa' || r.kind === 'carteira' ? r.kind : 'banco') as AccountKind
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    kind,
    bankName: r.bank_name != null ? String(r.bank_name) : null,
    branch: r.branch != null ? String(r.branch) : null,
    number: r.number != null ? String(r.number) : null,
    openingBalanceCents: Number(r.opening_balance_cents ?? 0),
    active: Boolean(r.active),
    note: r.note != null ? String(r.note) : null,
    ofProvider: r.of_provider != null ? String(r.of_provider) : null,
    ofAccountId: r.of_account_id != null ? String(r.of_account_id) : null,
    ofLastSyncAt: r.of_last_sync_at != null ? String(r.of_last_sync_at) : null,
    ofBalanceCents: r.of_balance_cents != null ? Number(r.of_balance_cents) : null,
    ofBalanceAt: r.of_balance_at != null ? String(r.of_balance_at) : null,
    ofStatus: r.of_status != null ? String(r.of_status) : null,
    ofLastError: r.of_last_error != null ? String(r.of_last_error) : null,
    ofMeta: (r.of_meta as OfAccountMeta | null) ?? null,
    ofBillOpenCents: r.of_bill_open_cents != null ? Number(r.of_bill_open_cents) : null,
    ofBillDueCents: r.of_bill_due_cents != null ? Number(r.of_bill_due_cents) : null,
    ofDebtTotalCents: r.of_debt_total_cents != null ? Number(r.of_debt_total_cents) : null,
    ofBillCloseDate: r.of_bill_close_date != null ? String(r.of_bill_close_date) : null,
    ofBillDueDate: r.of_bill_due_date != null ? String(r.of_bill_due_date) : null,
    ofProviderNote: r.of_provider_note != null ? String(r.of_provider_note) : null,
  }
}

export async function listAccounts(includeInactive = false): Promise<FinAccount[]> {
  const client = assertClient()
  let query = client.from('fin_accounts').select(ACCOUNT_COLS).order('name')
  if (!includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapAccount(r as Record<string, unknown>))
}

export async function upsertAccount(payload: {
  id?: string
  name: string
  kind: AccountKind
  bankName?: string | null
  branch?: string | null
  number?: string | null
  openingBalanceCents?: number
  active?: boolean
  note?: string | null
}): Promise<FinAccount> {
  const client = assertClient()
  const row: Record<string, unknown> = {
    name: payload.name.trim(),
    kind: payload.kind,
    bank_name: payload.bankName?.trim() || null,
    branch: payload.branch?.trim() || null,
    number: payload.number?.trim() || null,
    active: payload.active ?? true,
    note: payload.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  if (payload.openingBalanceCents !== undefined) row.opening_balance_cents = Math.round(payload.openingBalanceCents)
  const query = payload.id
    ? client.from('fin_accounts').update(row).eq('id', payload.id)
    : client.from('fin_accounts').insert(row)
  const { data, error } = await query.select(ACCOUNT_COLS).single()
  if (error) throw new Error(error.message)
  return mapAccount(data as Record<string, unknown>)
}

/**
 * Saldo atual por conta = saldo inicial + soma dos lançamentos (fin_transactions, assinados).
 *
 * PAGINA de verdade. A versão anterior fazia um `select` cru em fin_transactions, e o
 * PostgREST daqui corta em 1.000 linhas sem erro e sem aviso: com 1.339 lançamentos na
 * clínica, o "Saldo total" da tela somava só parte deles e mostrava um número errado com
 * cara de certo. Ver [[postgrest_teto_1000_linhas]].
 */
export async function accountBalances(): Promise<Map<string, number>> {
  const client = assertClient()
  const [accounts, txns] = await Promise.all([
    client.from('fin_accounts').select('id, opening_balance_cents'),
    buscarTudo<{ account_id: string; amount_cents: number }>(
      () => client.from('fin_transactions').select('account_id, amount_cents').order('id', { ascending: true }),
      { rotulo: 'fin_transactions (saldos)', maxPaginas: 50 },
    ),
  ])
  if (accounts.error) throw new Error(accounts.error.message)
  const balances = new Map<string, number>()
  for (const a of accounts.data ?? []) balances.set(String(a.id), Number(a.opening_balance_cents ?? 0))
  for (const t of txns) {
    const id = String(t.account_id)
    balances.set(id, (balances.get(id) ?? 0) + Number(t.amount_cents ?? 0))
  }
  return balances
}

// ─────────────────────────────────────────────────────── plano de contas

export type CategoryKind = 'receita' | 'despesa'

export type FinCategory = {
  id: string
  name: string
  kind: CategoryKind
  parentId: string | null
  active: boolean
}

function mapCategory(r: Record<string, unknown>): FinCategory {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    kind: (r.kind === 'receita' ? 'receita' : 'despesa') as CategoryKind,
    parentId: r.parent_id != null ? String(r.parent_id) : null,
    active: Boolean(r.active),
  }
}

export async function listCategories(kind?: CategoryKind, includeInactive = false): Promise<FinCategory[]> {
  const client = assertClient()
  let query = client.from('fin_categories').select('id, name, kind, parent_id, active').order('name')
  if (kind) query = query.eq('kind', kind)
  if (!includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapCategory(r as Record<string, unknown>))
}

export async function upsertCategory(payload: {
  id?: string
  name: string
  kind: CategoryKind
  parentId?: string | null
  active?: boolean
}): Promise<FinCategory> {
  const client = assertClient()
  const row: Record<string, unknown> = {
    name: payload.name.trim(),
    kind: payload.kind,
    parent_id: payload.parentId || null,
    active: payload.active ?? true,
  }
  const query = payload.id
    ? client.from('fin_categories').update(row).eq('id', payload.id)
    : client.from('fin_categories').insert(row)
  const { data, error } = await query.select('id, name, kind, parent_id, active').single()
  if (error) throw new Error(error.message)
  return mapCategory(data as Record<string, unknown>)
}

// ───────────────────────────────────────────────── lançamentos de caixa (razão)

export type TxnDirection = 'in' | 'out'
export type TxnSource = 'manual' | 'ofx' | 'csv' | 'payable' | 'receivable' | 'openfinance'

export type FinTransaction = {
  id: string
  accountId: string
  date: string
  amountCents: number // assinado: entrada > 0, saída < 0
  direction: TxnDirection
  categoryId: string | null
  /** centro de custo da saída; mesmo vocabulário de payable_installments */
  costCenter: string | null
  description: string | null
  counterparty: string | null
  source: TxnSource
  externalId: string | null
  reconciledRefType: 'payable' | 'receivable' | null
  reconciledRefId: string | null
  note: string | null
}

const TXN_COLS =
  'id, account_id, date, amount_cents, direction, category_id, cost_center, description, counterparty, source, external_id, reconciled_ref_type, reconciled_ref_id, note'

function mapTxn(r: Record<string, unknown>): FinTransaction {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    date: String(r.date ?? ''),
    amountCents: Number(r.amount_cents ?? 0),
    direction: (r.direction === 'in' ? 'in' : 'out') as TxnDirection,
    categoryId: r.category_id != null ? String(r.category_id) : null,
    costCenter: r.cost_center != null ? String(r.cost_center) : null,
    description: r.description != null ? String(r.description) : null,
    counterparty: r.counterparty != null ? String(r.counterparty) : null,
    source: (['ofx', 'csv', 'payable', 'receivable', 'openfinance'].includes(String(r.source)) ? r.source : 'manual') as TxnSource,
    externalId: r.external_id != null ? String(r.external_id) : null,
    reconciledRefType:
      r.reconciled_ref_type === 'payable' || r.reconciled_ref_type === 'receivable'
        ? (r.reconciled_ref_type as 'payable' | 'receivable')
        : null,
    reconciledRefId: r.reconciled_ref_id != null ? String(r.reconciled_ref_id) : null,
    note: r.note != null ? String(r.note) : null,
  }
}

/**
 * Lançamentos da conta. `limit` acima de 1.000 PAGINA de verdade.
 *
 * O PostgREST daqui tem max_rows = 1000: `.limit(5000)` devolvia 1.000 linhas, sem erro e
 * sem aviso. O fluxo de caixa pedia 5.000 e somava 1.000 como se fosse o mês inteiro, e a
 * conciliação com o Shosp era pior — como a ordem é data DESC, o corte come as entradas
 * mais ANTIGAS, então toda venda do começo do período apareceria como "não caiu no banco".
 * Divergência inventada no lugar exato onde a tela promete a verdade.
 */
export async function listTransactions(opts?: {
  accountId?: string
  from?: string
  to?: string
  onlyUnreconciled?: boolean
  limit?: number
}): Promise<FinTransaction[]> {
  const client = assertClient()
  const teto = opts?.limit ?? 1000
  const montar = () => {
    // `id` como desempate: data sozinha repete muito, e sem ordem determinística o
    // PostgREST não promete a mesma linha na mesma página entre uma busca e outra.
    let q = client
      .from('fin_transactions')
      .select(TXN_COLS)
      .order('date', { ascending: false })
      .order('id', { ascending: false })
    if (opts?.accountId) q = q.eq('account_id', opts.accountId)
    if (opts?.from) q = q.gte('date', opts.from)
    if (opts?.to) q = q.lte('date', opts.to)
    if (opts?.onlyUnreconciled) q = q.is('reconciled_ref_id', null)
    return q
  }

  if (teto <= 1000) {
    const { data, error } = await montar().limit(teto)
    if (error) throw new Error(error.message)
    return (data ?? []).map((r) => mapTxn(r as Record<string, unknown>))
  }

  const rows = await buscarTudo<Record<string, unknown>>(montar, {
    rotulo: 'fin_transactions',
    maxPaginas: Math.ceil(teto / 1000),
  })
  return rows.slice(0, teto).map((r) => mapTxn(r))
}

export type NewTransaction = {
  accountId: string
  date: string
  /** magnitude POSITIVA; o sinal é aplicado pela direction */
  amountCents: number
  direction: TxnDirection
  categoryId?: string | null
  description?: string | null
  counterparty?: string | null
  source?: TxnSource
  externalId?: string | null
  reconciledRefType?: 'payable' | 'receivable' | null
  reconciledRefId?: string | null
  note?: string | null
}

function txnRow(t: NewTransaction): Record<string, unknown> {
  const magnitude = Math.abs(Math.round(t.amountCents))
  const signed = t.direction === 'out' ? -magnitude : magnitude
  return {
    account_id: t.accountId,
    date: t.date,
    amount_cents: signed,
    direction: t.direction,
    category_id: t.categoryId || null,
    description: t.description?.trim() || null,
    counterparty: t.counterparty?.trim() || null,
    source: t.source ?? 'manual',
    external_id: t.externalId || null,
    reconciled_ref_type: t.reconciledRefType || null,
    reconciled_ref_id: t.reconciledRefId || null,
    note: t.note?.trim() || null,
  }
}

export async function createTransaction(t: NewTransaction): Promise<string> {
  const client = assertClient()
  const { data, error } = await client.from('fin_transactions').insert(txnRow(t)).select('id').single()
  if (error) throw new Error(error.message)
  return String((data as { id: unknown }).id)
}

/** Insere vários lançamentos (import de extrato). Dedup por (conta, external_id) fica na
 *  unique index parcial — usamos upsert ignore pra não estourar em reimport. Retorna quantos
 *  ENTRARAM de fato (novos). */
export async function importTransactions(rows: NewTransaction[]): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 }
  const client = assertClient()
  let inserted = 0
  let skipped = 0
  // upsert com ignoreDuplicates respeita a unique index parcial (external_id not null).
  for (const chunk of chunkArray(rows, 200)) {
    const { data, error } = await client
      .from('fin_transactions')
      .upsert(chunk.map(txnRow), { onConflict: 'tenant_id,account_id,external_id', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(error.message)
    const got = (data ?? []).length
    inserted += got
    skipped += chunk.length - got
  }
  return { inserted, skipped }
}

export async function deleteTransaction(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('fin_transactions').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ──────────────────────────────────────────────────────── contas a receber

export type ReceivableStatus = 'aberto' | 'recebido' | 'cancelado'

export type Receivable = {
  id: string
  description: string
  customerName: string | null
  leadId: string | null
  categoryId: string | null
  accountId: string | null
  dueDate: string
  amountCents: number
  status: ReceivableStatus
  receivedAt: string | null
  method: string | null
  note: string | null
}

const RECEIVABLE_COLS =
  'id, description, customer_name, lead_id, category_id, account_id, due_date, amount_cents, status, received_at, method, note'

function mapReceivable(r: Record<string, unknown>): Receivable {
  const status: ReceivableStatus =
    r.status === 'recebido' || r.status === 'cancelado' ? (r.status as ReceivableStatus) : 'aberto'
  return {
    id: String(r.id),
    description: String(r.description ?? ''),
    customerName: r.customer_name != null ? String(r.customer_name) : null,
    leadId: r.lead_id != null ? String(r.lead_id) : null,
    categoryId: r.category_id != null ? String(r.category_id) : null,
    accountId: r.account_id != null ? String(r.account_id) : null,
    dueDate: String(r.due_date ?? ''),
    amountCents: Number(r.amount_cents ?? 0),
    status,
    receivedAt: r.received_at != null ? String(r.received_at) : null,
    method: r.method != null ? String(r.method) : null,
    note: r.note != null ? String(r.note) : null,
  }
}

/**
 * Contas a receber, com filtro e paginação de verdade.
 *
 * Isto era `.order('due_date').limit(500)` — sem filtro nenhum e ordenado do MAIS ANTIGO.
 * Enquanto a clínica tinha meia dúzia de lançamentos ninguém viu. Depois que o ano de vendas
 * do Shosp entrou (3.353 contas, R$ 13,2 milhões), a tela passou a enxergar só as 500 mais
 * velhas — ago a nov/2025 — e nunca alcançava o mês corrente: "Recebido no mês" dava R$ 0,00
 * com R$ 410 mil recebidos em agosto. Truncar em silêncio de novo, o mesmo erro de
 * [[postgrest_teto_1000_linhas]], só que com `limit` menor que o teto do servidor.
 *
 * Agora o chamador diz o que quer. Sem filtro continua trazendo tudo, mas paginado — nunca
 * um número menor com cara de completo.
 */
export async function listReceivables(opts?: {
  status?: ReceivableStatus
  /** filtra por `due_date` */
  from?: string
  to?: string
}): Promise<Receivable[]> {
  const client = assertClient()
  const montar = () => {
    let q = client
      .from('fin_receivables')
      .select(RECEIVABLE_COLS)
      // `id` como desempate: due_date repete muito e sem ordem determinística o PostgREST
      // não promete a mesma linha na mesma página entre duas buscas.
      .order('due_date', { ascending: false })
      .order('id', { ascending: false })
    if (opts?.status) q = q.eq('status', opts.status)
    if (opts?.from) q = q.gte('due_date', opts.from)
    if (opts?.to) q = q.lte('due_date', opts.to)
    return q
  }
  const rows = await buscarTudo<Record<string, unknown>>(montar, {
    rotulo: 'fin_receivables',
    maxPaginas: 20,
  })
  return rows.map((r) => mapReceivable(r))
}

export async function createReceivables(payload: {
  description: string
  customerName?: string | null
  leadId?: string | null
  categoryId?: string | null
  accountId?: string | null
  amountCents: number
  firstDueDate: string
  installments: number
  method?: string | null
  note?: string
}): Promise<void> {
  const client = assertClient()
  const n = Math.max(1, Math.round(payload.installments))
  const rows = Array.from({ length: n }, (_, i) => {
    const due = new Date(`${payload.firstDueDate}T12:00:00`)
    due.setMonth(due.getMonth() + i)
    return {
      description: n > 1 ? `${payload.description.trim()} (${i + 1}/${n})` : payload.description.trim(),
      customer_name: payload.customerName?.trim() || null,
      lead_id: payload.leadId || null,
      category_id: payload.categoryId || null,
      account_id: payload.accountId || null,
      amount_cents: Math.round(payload.amountCents),
      due_date: diaLocal(due),
      method: payload.method || null,
      note: payload.note?.trim() || null,
    }
  })
  const { error } = await client.from('fin_receivables').insert(rows)
  if (error) throw new Error(error.message)
}

/** Baixa: marca recebido e — se uma conta for informada — grava a ENTRADA no razão de caixa. */
export async function receiveReceivable(
  r: Receivable,
  opts?: { accountId?: string | null; receivedOn?: string; createTxn?: boolean },
): Promise<void> {
  const client = assertClient()
  const accountId = opts?.accountId ?? r.accountId
  const receivedOn = opts?.receivedOn ?? hojeLocal()
  const { error } = await client
    .from('fin_receivables')
    .update({
      status: 'recebido',
      received_at: new Date(`${receivedOn}T12:00:00`).toISOString(),
      received_amount_cents: r.amountCents,
      account_id: accountId || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', r.id)
  if (error) throw new Error(error.message)
  if ((opts?.createTxn ?? true) && accountId) {
    await createTransaction({
      accountId,
      date: receivedOn,
      amountCents: r.amountCents,
      direction: 'in',
      categoryId: r.categoryId,
      description: r.description,
      counterparty: r.customerName,
      source: 'receivable',
      reconciledRefType: 'receivable',
      reconciledRefId: r.id,
    })
  }
}

export async function setReceivableStatus(id: string, status: ReceivableStatus): Promise<void> {
  const client = assertClient()
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (status !== 'recebido') patch.received_at = null
  const { error } = await client.from('fin_receivables').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

// ───────────────────────────────────────────────────────────── recorrentes

export type RecurringKind = 'payable' | 'receivable'

export type Recurring = {
  id: string
  kind: RecurringKind
  description: string
  categoryId: string | null
  accountId: string | null
  supplierId: string | null
  amountCents: number
  dayOfMonth: number
  paymentMethod: string | null
  active: boolean
  lastGeneratedOn: string | null
}

const RECURRING_COLS =
  'id, kind, description, category_id, account_id, supplier_id, amount_cents, day_of_month, payment_method, active, last_generated_on'

function mapRecurring(r: Record<string, unknown>): Recurring {
  return {
    id: String(r.id),
    kind: (r.kind === 'receivable' ? 'receivable' : 'payable') as RecurringKind,
    description: String(r.description ?? ''),
    categoryId: r.category_id != null ? String(r.category_id) : null,
    accountId: r.account_id != null ? String(r.account_id) : null,
    supplierId: r.supplier_id != null ? String(r.supplier_id) : null,
    amountCents: Number(r.amount_cents ?? 0),
    dayOfMonth: Number(r.day_of_month ?? 1),
    paymentMethod: r.payment_method != null ? String(r.payment_method) : null,
    active: Boolean(r.active),
    lastGeneratedOn: r.last_generated_on != null ? String(r.last_generated_on) : null,
  }
}

export async function listRecurring(): Promise<Recurring[]> {
  const client = assertClient()
  const { data, error } = await client.from('fin_recurring').select(RECURRING_COLS).order('day_of_month')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapRecurring(r as Record<string, unknown>))
}

export async function upsertRecurring(payload: {
  id?: string
  kind: RecurringKind
  description: string
  categoryId?: string | null
  accountId?: string | null
  supplierId?: string | null
  amountCents: number
  dayOfMonth: number
  paymentMethod?: string | null
  active?: boolean
}): Promise<void> {
  const client = assertClient()
  const row: Record<string, unknown> = {
    kind: payload.kind,
    description: payload.description.trim(),
    category_id: payload.categoryId || null,
    account_id: payload.accountId || null,
    supplier_id: payload.supplierId || null,
    amount_cents: Math.round(payload.amountCents),
    day_of_month: Math.min(28, Math.max(1, Math.round(payload.dayOfMonth))),
    payment_method: payload.paymentMethod || null,
    active: payload.active ?? true,
    updated_at: new Date().toISOString(),
  }
  const query = payload.id
    ? client.from('fin_recurring').update(row).eq('id', payload.id)
    : client.from('fin_recurring').insert(row)
  const { error } = await query
  if (error) throw new Error(error.message)
}

export async function setRecurringActive(id: string, active: boolean): Promise<void> {
  const client = assertClient()
  const { error } = await client
    .from('fin_recurring')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─────────────────────────────────────────── conciliação (motor de casamento)

export type MatchSuggestion = {
  transaction: FinTransaction
  refType: 'payable' | 'receivable'
  refId: string
  refDescription: string
  refDueDate: string
  refAmountCents: number
  dayGap: number
}

/** Casa lançamentos NÃO conciliados × contas em aberto por valor exato + proximidade de data.
 *  O sinal do lançamento decide o lado: saída → payable, entrada → receivable. Mesmo espírito
 *  do casamento em cascata de nfeImport.suggestItemPlan. */
export function suggestMatches(
  transactions: FinTransaction[],
  openPayables: Payable[],
  openReceivables: Receivable[],
  windowDays = 5,
): MatchSuggestion[] {
  const out: MatchSuggestion[] = []
  const usedPayable = new Set<string>()
  const usedReceivable = new Set<string>()
  const dayDiff = (a: string, b: string) =>
    Math.abs(Math.round((new Date(`${a}T12:00:00`).getTime() - new Date(`${b}T12:00:00`).getTime()) / 86400000))

  for (const t of transactions) {
    if (t.reconciledRefId) continue
    const magnitude = Math.abs(t.amountCents)
    if (t.direction === 'out') {
      // saída → contas a pagar em aberto
      const cands = openPayables
        .filter((p) => p.status === 'aberto' && !usedPayable.has(p.id) && p.amountCents === magnitude)
        .map((p) => ({ p, gap: dayDiff(t.date, p.dueDate) }))
        .filter((c) => c.gap <= windowDays)
        .sort((a, b) => a.gap - b.gap)
      const best = cands[0]
      if (best) {
        usedPayable.add(best.p.id)
        out.push({
          transaction: t,
          refType: 'payable',
          refId: best.p.id,
          refDescription: best.p.description,
          refDueDate: best.p.dueDate,
          refAmountCents: best.p.amountCents,
          dayGap: best.gap,
        })
      }
    } else {
      // entrada → contas a receber em aberto
      const cands = openReceivables
        .filter((r) => r.status === 'aberto' && !usedReceivable.has(r.id) && r.amountCents === magnitude)
        .map((r) => ({ r, gap: dayDiff(t.date, r.dueDate) }))
        .filter((c) => c.gap <= windowDays)
        .sort((a, b) => a.gap - b.gap)
      const best = cands[0]
      if (best) {
        usedReceivable.add(best.r.id)
        out.push({
          transaction: t,
          refType: 'receivable',
          refId: best.r.id,
          refDescription: best.r.description,
          refDueDate: best.r.dueDate,
          refAmountCents: best.r.amountCents,
          dayGap: best.gap,
        })
      }
    }
  }
  return out
}

/** Confirma um casamento: liga o lançamento à conta e dá baixa nela (pago/recebido). NÃO cria
 *  novo fin_transaction — o lançamento do extrato JÁ é o dinheiro real. */
export async function confirmMatch(
  transactionId: string,
  refType: 'payable' | 'receivable',
  refId: string,
  categoryId?: string | null,
): Promise<void> {
  const client = assertClient()
  const patch: Record<string, unknown> = { reconciled_ref_type: refType, reconciled_ref_id: refId }
  if (categoryId) patch.category_id = categoryId
  const { error: txnErr } = await client.from('fin_transactions').update(patch).eq('id', transactionId)
  if (txnErr) throw new Error(txnErr.message)

  if (refType === 'payable') {
    const { error } = await client
      .from('payable_installments')
      .update({ status: 'pago', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', refId)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await client
      .from('fin_receivables')
      .update({ status: 'recebido', received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', refId)
    if (error) throw new Error(error.message)
  }
}

// ──────────────────────────────────────────────── fluxo de caixa / DRE

export type CashflowMonth = {
  month: string // 'yyyy-mm'
  realizedInCents: number
  realizedOutCents: number
  /** previsto = contas a receber/pagar em aberto com vencimento no mês */
  plannedInCents: number
  plannedOutCents: number
}

export type CashflowByCategory = { categoryId: string | null; kind: CategoryKind; realizedCents: number }

export type Cashflow = {
  months: CashflowMonth[]
  byCategory: CashflowByCategory[]
}

/** Fluxo de caixa: realizado (fin_transactions) + previsto (AP/AR em aberto), por mês.
 *  Recebe as listas já carregadas pra evitar buscas duplicadas na página. */
export function buildCashflow(
  transactions: FinTransaction[],
  openPayables: Payable[],
  openReceivables: Receivable[],
  categories: FinCategory[],
): Cashflow {
  const monthOf = (iso: string) => iso.slice(0, 7)
  const months = new Map<string, CashflowMonth>()
  const ensure = (m: string) => {
    let row = months.get(m)
    if (!row) {
      row = { month: m, realizedInCents: 0, realizedOutCents: 0, plannedInCents: 0, plannedOutCents: 0 }
      months.set(m, row)
    }
    return row
  }
  for (const t of transactions) {
    const row = ensure(monthOf(t.date))
    if (t.amountCents >= 0) row.realizedInCents += t.amountCents
    else row.realizedOutCents += -t.amountCents
  }
  for (const p of openPayables) if (p.status === 'aberto') ensure(monthOf(p.dueDate)).plannedOutCents += p.amountCents
  for (const r of openReceivables) if (r.status === 'aberto') ensure(monthOf(r.dueDate)).plannedInCents += r.amountCents

  const catKind = new Map(categories.map((c) => [c.id, c.kind] as const))
  const byCatMap = new Map<string, CashflowByCategory>()
  for (const t of transactions) {
    const key = t.categoryId ?? '∅'
    let row = byCatMap.get(key)
    if (!row) {
      const kind: CategoryKind = t.amountCents >= 0 ? 'receita' : 'despesa'
      row = { categoryId: t.categoryId, kind: (t.categoryId && catKind.get(t.categoryId)) || kind, realizedCents: 0 }
      byCatMap.set(key, row)
    }
    row.realizedCents += Math.abs(t.amountCents)
  }

  return {
    months: Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month)),
    byCategory: Array.from(byCatMap.values()),
  }
}

// ───────────────────────────────────────────────────────────────── utils

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ──────────────────────────────────────────── quem é quem no extrato
//
// Regras de classificação de pagador recorrente, declaradas na tela de conciliação.
// Ver a migration 20260811190000: existe porque nenhum regex adivinha que
// "PIX TRANSF INSTITU16/07" é a conta irmã do grupo, e não a venda de um paciente.

export type ReconcileRule = {
  id: string
  pattern: string
  classe: 'adquirente' | 'deposito' | 'nao_venda' | 'venda'
  label: string | null
}

const RULE_COLS = 'id, pattern, classe, label'

export async function listReconcileRules(): Promise<ReconcileRule[]> {
  const client = assertClient()
  const { data, error } = await client.from('fin_reconcile_rules').select(RULE_COLS).order('pattern')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: String(row.id),
      pattern: String(row.pattern ?? ''),
      classe: row.classe as ReconcileRule['classe'],
      label: (row.label as string | null) ?? null,
    }
  })
}

export async function saveReconcileRule(payload: {
  pattern: string
  classe: ReconcileRule['classe']
  label?: string | null
}): Promise<ReconcileRule> {
  const client = assertClient()
  // `tenant_id` fica com o default da tabela (current_tenant_id()) — mandar do cliente
  // seria confiar no chamador pra decidir de quem é a regra.
  const { data, error } = await client
    .from('fin_reconcile_rules')
    .upsert(
      { pattern: payload.pattern.trim(), classe: payload.classe, label: payload.label?.trim() || null },
      { onConflict: 'tenant_id, pattern' },
    )
    .select(RULE_COLS)
    .single()
  if (error) throw new Error(error.message)
  const row = data as Record<string, unknown>
  return {
    id: String(row.id),
    pattern: String(row.pattern ?? ''),
    classe: row.classe as ReconcileRule['classe'],
    label: (row.label as string | null) ?? null,
  }
}

export async function deleteReconcileRule(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('fin_reconcile_rules').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Primeiro e último dia com extrato de uma conta.
 *
 * A tela precisa disso pra não cobrar do banco um período que o banco nunca entregou: o
 * fin_transactions da clínica começa em 12/mai/2026, e o export do Shosp vem com um ano
 * inteiro. Conciliar tudo geraria milhares de "não caiu no banco" que só dizem que o
 * extrato daquele mês não foi importado.
 */
export async function bankCoverage(accountId?: string): Promise<{ from: string; to: string } | null> {
  const client = assertClient()
  const base = () => {
    let q = client.from('fin_transactions').select('date')
    if (accountId) q = q.eq('account_id', accountId)
    return q
  }
  const [min, max] = await Promise.all([
    base().order('date', { ascending: true }).limit(1).maybeSingle(),
    base().order('date', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (min.error) throw new Error(min.error.message)
  if (max.error) throw new Error(max.error.message)
  const from = (min.data as { date?: string } | null)?.date
  const to = (max.data as { date?: string } | null)?.date
  return from && to ? { from, to } : null
}

// ──────────────────────────────────────────── cirurgia foi paga?
//
// A regra da casa é "não se opera sem 100% pago". Ver a migration 20260811200000: o vínculo é
// por CPF (cirurgia → prontuário do Shosp → paciente → conta a receber), com queda pra nome
// quando a cirurgia não tem prontuário. `vinculo` diz qual dos dois foi usado — sem isso a
// tela volta a misturar "não pagou" com "não consegui casar o nome".

export type VinculoCirurgia = 'cpf' | 'nome' | 'sem_pagamento' | 'sem_vinculo'

export type CirurgiaPagamento = {
  surgeryId: number
  dia: string
  paciente: string
  prontuario: string | null
  status: string | null
  vinculo: VinculoCirurgia
  recebidoCents: number
  recebidoQtd: number
  primeiroPagamento: string | null
  ultimoPagamento: string | null
  formas: string[]
  emEspecieCents: number
}

export async function listCirurgiasPagamento(de: string, ate: string): Promise<CirurgiaPagamento[]> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_cirurgias_pagamento', { p_de: de, p_ate: ate })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    surgeryId: Number(r.surgery_id),
    dia: String(r.dia ?? ''),
    paciente: String(r.paciente ?? ''),
    prontuario: (r.prontuario as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    vinculo: (r.vinculo as VinculoCirurgia) ?? 'sem_vinculo',
    recebidoCents: Number(r.recebido_cents ?? 0),
    recebidoQtd: Number(r.recebido_qtd ?? 0),
    primeiroPagamento: (r.primeiro_pagamento as string | null) ?? null,
    ultimoPagamento: (r.ultimo_pagamento as string | null) ?? null,
    formas: (r.formas as string[] | null) ?? [],
    emEspecieCents: Number(r.em_especie_cents ?? 0),
  }))
}

// ──────────────────────────────────────────── fechamento de caixa (dinheiro vivo)
//
// Ver a migration 20260811210000. Entrega de dinheiro NÃO vira lançamento em fin_transactions
// quando o destino é depósito: o extrato já entra sozinho pelo Open Finance e lançar aqui
// também contaria o mesmo dinheiro duas vezes. A entrega é o rastro de quem tirou do caixa.

export type CashDestination = 'deposito' | 'despesa' | 'cofre' | 'outro'

export type CashHandover = {
  id: string
  handedAt: string
  amountCents: number
  fromPerson: string
  toPerson: string
  destination: CashDestination
  accountId: string | null
  note: string | null
}

export type CaixaMes = {
  mes: string
  recebidoCents: number
  entregueCents: number
  depositadoCents: number
  despesaCents: number
  sobraCents: number
}

const HANDOVER_COLS = 'id, handed_at, amount_cents, from_person, to_person, destination, account_id, note'

const mapHandover = (r: Record<string, unknown>): CashHandover => ({
  id: String(r.id),
  handedAt: String(r.handed_at ?? ''),
  amountCents: Number(r.amount_cents ?? 0),
  fromPerson: String(r.from_person ?? ''),
  toPerson: String(r.to_person ?? ''),
  destination: (r.destination as CashDestination) ?? 'outro',
  accountId: (r.account_id as string | null) ?? null,
  note: (r.note as string | null) ?? null,
})

export async function listCashHandovers(de: string, ate: string): Promise<CashHandover[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('fin_cash_handovers')
    .select(HANDOVER_COLS)
    .gte('handed_at', de)
    .lte('handed_at', ate)
    .order('handed_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapHandover(r as Record<string, unknown>))
}

export async function createCashHandover(payload: {
  handedAt: string
  amountCents: number
  fromPerson: string
  toPerson: string
  destination: CashDestination
  accountId?: string | null
  note?: string | null
}): Promise<CashHandover> {
  const client = assertClient()
  // `tenant_id` e `created_by` ficam com o default da tabela — mandar do cliente seria
  // confiar no chamador pra dizer de quem é o dinheiro e quem registrou.
  const { data, error } = await client
    .from('fin_cash_handovers')
    .insert({
      handed_at: payload.handedAt,
      amount_cents: Math.abs(Math.round(payload.amountCents)),
      from_person: payload.fromPerson.trim(),
      to_person: payload.toPerson.trim(),
      destination: payload.destination,
      account_id: payload.destination === 'deposito' ? (payload.accountId || null) : null,
      note: payload.note?.trim() || null,
    })
    .select(HANDOVER_COLS)
    .single()
  if (error) throw new Error(error.message)
  return mapHandover(data as Record<string, unknown>)
}

export async function deleteCashHandover(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('fin_cash_handovers').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listCaixaDinheiro(de: string, ate: string): Promise<CaixaMes[]> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_caixa_dinheiro', { p_de: de, p_ate: ate })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    mes: String(r.mes ?? ''),
    recebidoCents: Number(r.recebido_cents ?? 0),
    entregueCents: Number(r.entregue_cents ?? 0),
    depositadoCents: Number(r.depositado_cents ?? 0),
    despesaCents: Number(r.despesa_cents ?? 0),
    sobraCents: Number(r.sobra_cents ?? 0),
  }))
}

// ──────────────────────────────────────────── a receber do adquirente
//
// Ver a migration 20260811220000. É o "conta a receber" de verdade da clínica: parcela de
// cartão já vendida e ainda não vencida. NÃO desconta antecipação — o extrato não diz quais
// parcelas foram adiantadas, só o total. Por isso o número é um teto, e a tela diz isso.

export type AdquirenteMes = { mes: string; parcelas: number; amountCents: number }

export async function listAdquirenteAReceber(): Promise<AdquirenteMes[]> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_adquirente_a_receber', {})
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    mes: String(r.mes ?? ''),
    parcelas: Number(r.parcelas ?? 0),
    amountCents: Number(r.amount_cents ?? 0),
  }))
}

/** Entradas do mês nas contas BANCO — o número de caixa, sem cartão nem gaveta. */
export async function entrouNaContaNoPeriodo(de: string, ate: string): Promise<number> {
  const contas = (await listAccounts()).filter((c) => c.kind === 'banco').map((c) => c.id)
  if (contas.length === 0) return 0
  const rows = await buscarTudo<{ amount_cents: number }>(
    () =>
      assertClient()
        .from('fin_transactions')
        .select('amount_cents, id')
        .in('account_id', contas)
        .eq('direction', 'in')
        .gte('date', de)
        .lte('date', ate)
        .order('id'),
    { rotulo: 'fin_transactions (entrou na conta)', maxPaginas: 10 },
  )
  return rows.reduce((s, r) => s + Math.abs(Number(r.amount_cents ?? 0)), 0)
}

// ──────────────────────────────────────────── extrato classificável
//
// Ver a migration 20260811230000. `fin_transactions.category_id` existia e nada escrevia nele —
// por isso o contas a pagar da clínica conhece R$ 122 mil enquanto o extrato mostra R$ 1,2 mi
// de saída só em julho. Classificar o extrato É construir a despesa.

/** Muda o que dá pra mudar num lançamento do banco. Valor e data vêm do extrato e não se editam. */
export async function updateTransaction(
  id: string,
  patch: {
    categoryId?: string | null
    note?: string | null
    counterparty?: string | null
    costCenter?: string | null
  },
): Promise<void> {
  const client = assertClient()
  const row: Record<string, unknown> = {}
  if (patch.categoryId !== undefined) row.category_id = patch.categoryId || null
  if (patch.costCenter !== undefined) row.cost_center = patch.costCenter || null
  if (patch.note !== undefined) row.note = patch.note?.trim() || null
  if (patch.counterparty !== undefined) row.counterparty = patch.counterparty?.trim() || null
  if (Object.keys(row).length === 0) return
  const { error } = await client.from('fin_transactions').update(row).eq('id', id)
  if (error) throw new Error(error.message)
}

export type CategoryRule = {
  id: string
  pattern: string
  categoryId: string
  direction: 'in' | 'out' | null
  costCenter: string | null
}

export async function listCategoryRules(): Promise<CategoryRule[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('fin_category_rules')
    .select('id, pattern, category_id, direction, cost_center')
    .order('pattern')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: String(row.id),
      pattern: String(row.pattern ?? ''),
      categoryId: String(row.category_id ?? ''),
      direction: (row.direction as 'in' | 'out' | null) ?? null,
      costCenter: (row.cost_center as string | null) ?? null,
    }
  })
}

/**
 * Salva a regra e já carimba os lançamentos que casam. Devolve quantos foram carimbados.
 *
 * As duas coisas juntas de propósito: o valor da regra é não ter que classificar
 * "PIX ENVIADO LAVANDERIA B" de novo no mês que vem E não ter que voltar nos meses passados.
 */
export async function saveCategoryRule(payload: {
  pattern: string
  categoryId: string
  direction?: 'in' | 'out' | null
  sobrescrever?: boolean
  /** carimbado junto: quem diz "isto é lavanderia" já sabe que é Infraestrutura */
  costCenter?: string | null
}): Promise<{ ruleId: string | null; carimbados: number }> {
  const client = assertClient()
  const pattern = payload.pattern.trim()
  const { data: regra, error } = await client.from('fin_category_rules').upsert(
    {
      pattern,
      category_id: payload.categoryId,
      direction: payload.direction ?? null,
      cost_center: payload.costCenter ?? null,
    },
    { onConflict: 'tenant_id, pattern, direction' },
  ).select('id').maybeSingle()
  // Regra repetida não é erro pro usuário: ele quer o carimbo, e o carimbo roda igual.
  if (error && !/duplicate|conflict/i.test(error.message)) throw new Error(error.message)
  // O id volta pra gravar o RASTRO no lançamento: sem saber qual regra carimbou o quê,
  // desfazer uma regra errada vira caça manual linha por linha.
  const ruleId = (regra as { id?: string } | null)?.id ?? null
  const { data, error: err2 } = await client.rpc('crm_aplicar_regra_categoria', {
    p_pattern: pattern,
    p_category_id: payload.categoryId,
    p_direction: payload.direction ?? null,
    p_sobrescrever: payload.sobrescrever ?? false,
    p_cost_center: payload.costCenter ?? null,
    p_rule_id: ruleId,
  })
  if (err2) throw new Error(err2.message)
  return { ruleId, carimbados: Number(data ?? 0) }
}

export async function deleteCategoryRule(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('fin_category_rules').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export type ExtratoDia = {
  dia: string
  entrouCents: number
  saiuCents: number
  saidaClassificadaCents: number
}

export async function listExtratoPorDia(de: string, ate: string): Promise<ExtratoDia[]> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_extrato_por_dia', { p_de: de, p_ate: ate })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    dia: String(r.dia ?? ''),
    entrouCents: Number(r.entrou_cents ?? 0),
    saiuCents: Number(r.saiu_cents ?? 0),
    saidaClassificadaCents: Number(r.saida_classificada_cents ?? 0),
  }))
}

export type SaidaCategoria = { categoria: string; categoryId: string | null; qtd: number; amountCents: number }

export async function listSaidaPorCategoria(de: string, ate: string): Promise<SaidaCategoria[]> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_saida_por_categoria', { p_de: de, p_ate: ate })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    categoria: String(r.categoria ?? ''),
    categoryId: (r.category_id as string | null) ?? null,
    qtd: Number(r.qtd ?? 0),
    amountCents: Number(r.amount_cents ?? 0),
  }))
}

/**
 * TUDO que saiu no período: o que o banco pagou + a conta a pagar que ainda não apareceu
 * no extrato.
 *
 * Sem a união, /gastos mostrava R$ 122 mil do ano (só o que veio de XML de nota) e o extrato
 * mostrava R$ 1,2 milhão só em julho — e as duas telas estavam "certas", cada uma olhando
 * metade. A conta a pagar já conciliada fica de fora de propósito: ela e o lançamento do
 * banco são o mesmo dinheiro.
 */
export type SaidaTudo = {
  origem: 'banco' | 'a pagar'
  id: string
  data: string
  descricao: string
  contraparte: string
  amountCents: number
  categoria: string | null
  centroCusto: string | null
  conciliado: boolean
}

export async function listSaidasTudo(de: string, ate: string): Promise<SaidaTudo[]> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_saidas_tudo', { p_de: de, p_ate: ate })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    origem: (r.origem as SaidaTudo['origem']) ?? 'banco',
    id: String(r.id ?? ''),
    data: String(r.data ?? ''),
    descricao: String(r.descricao ?? ''),
    contraparte: String(r.contraparte ?? ''),
    amountCents: Number(r.amount_cents ?? 0),
    categoria: (r.categoria as string | null) ?? null,
    centroCusto: (r.centro_custo as string | null) ?? null,
    conciliado: Boolean(r.conciliado),
  }))
}

// ──────────────────────────────────────────── configuração do financeiro
//
// Ver a migration 20260811250000. Centro de custo era um array `const` no fonte: criar
// "Tricoscopia" ou renomear "SPA" exigia deploy. Enquanto for código, o financeiro depende de
// programador pra mudar a própria estrutura de custo.

export type CostCenter = { id: string; name: string; active: boolean; sortOrder: number }

export async function listCostCenters(includeInactive = false): Promise<CostCenter[]> {
  const client = assertClient()
  let q = client.from('fin_cost_centers').select('id, name, active, sort_order').order('sort_order').order('name')
  if (!includeInactive) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: String(row.id),
      name: String(row.name ?? ''),
      active: Boolean(row.active),
      sortOrder: Number(row.sort_order ?? 100),
    }
  })
}

export async function upsertCostCenter(payload: {
  id?: string
  name: string
  active?: boolean
  sortOrder?: number
}): Promise<void> {
  const client = assertClient()
  const row: Record<string, unknown> = { name: payload.name.trim() }
  if (payload.active !== undefined) row.active = payload.active
  if (payload.sortOrder !== undefined) row.sort_order = payload.sortOrder
  const { error } = payload.id
    ? await client.from('fin_cost_centers').update(row).eq('id', payload.id)
    : await client.from('fin_cost_centers').insert(row)
  if (error) throw new Error(error.message)
}

/**
 * Renomear um centro precisa arrastar quem já usa o nome antigo.
 *
 * `cost_center` é TEXTO nas duas tabelas que o consomem (herança de quando era array no fonte).
 * Sem esta varredura, renomear "SPA" para "Estética" deixaria todo o histórico órfão num centro
 * que não existe mais na lista — e o relatório por centro de custo passaria a ter uma linha
 * fantasma que ninguém consegue selecionar.
 */
export async function renameCostCenter(id: string, de: string, para: string): Promise<void> {
  const client = assertClient()
  const novo = para.trim()
  const { error } = await client.from('fin_cost_centers').update({ name: novo }).eq('id', id)
  if (error) throw new Error(error.message)
  const a = await client.from('fin_transactions').update({ cost_center: novo }).eq('cost_center', de)
  if (a.error) throw new Error(a.error.message)
  const b = await client.from('payable_installments').update({ cost_center: novo }).eq('cost_center', de)
  if (b.error) throw new Error(b.error.message)
  const c = await client.from('fin_category_rules').update({ cost_center: novo }).eq('cost_center', de)
  if (c.error) throw new Error(c.error.message)
}

export async function deleteCostCenter(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('fin_cost_centers').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Quantos lançamentos cada regra carimbou — dá peso à regra na tela de configuração. */
export async function listRuleUsage(): Promise<Map<string, { usos: number; amountCents: number }>> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_regras_categoria_uso')
  if (error) throw new Error(error.message)
  const m = new Map<string, { usos: number; amountCents: number }>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    m.set(String(r.rule_id), { usos: Number(r.usos ?? 0), amountCents: Number(r.amount_cents ?? 0) })
  }
  return m
}

/** Desfaz o carimbo de uma regra. O que foi classificado à mão não é tocado. */
export async function undoCategoryRule(ruleId: string): Promise<number> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_desfazer_regra_categoria', { p_rule_id: ruleId })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

/** Editar conta a receber. Faltava: dava pra criar, receber e cancelar, e só. */
export async function updateReceivable(
  id: string,
  patch: {
    description?: string
    customerName?: string | null
    customerDoc?: string | null
    amountCents?: number
    dueDate?: string
    method?: string | null
    categoryId?: string | null
    accountId?: string | null
    note?: string | null
  },
): Promise<void> {
  const client = assertClient()
  const row: Record<string, unknown> = {}
  if (patch.description !== undefined) row.description = patch.description.trim()
  if (patch.customerName !== undefined) row.customer_name = patch.customerName?.trim() || null
  if (patch.customerDoc !== undefined) row.customer_doc = patch.customerDoc?.replace(/\D/g, '') || null
  if (patch.amountCents !== undefined) row.amount_cents = Math.abs(Math.round(patch.amountCents))
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate
  if (patch.method !== undefined) row.method = patch.method || null
  if (patch.categoryId !== undefined) row.category_id = patch.categoryId || null
  if (patch.accountId !== undefined) row.account_id = patch.accountId || null
  if (patch.note !== undefined) row.note = patch.note?.trim() || null
  if (Object.keys(row).length === 0) return
  const { error } = await client.from('fin_receivables').update(row).eq('id', id)
  if (error) throw new Error(error.message)
}

// ──────────────────────────────────────────── rateio de lançamento
//
// Ver a migration 20260811260000. Um PIX que pagou duas coisas só tinha saídas ruins:
// classificar tudo como uma (e mentir) ou deixar sem categoria (e sumir do relatório).
// O rateio mora em tabela própria — `fin_transactions` é o que o BANCO disse, e isso não se
// mexe: no dia que a conciliação discordar do extrato, ninguém saberia qual dos dois foi
// alterado.

export type Split = {
  id: string
  amountCents: number
  categoryId: string | null
  costCenter: string | null
  note: string | null
}

export async function listSplits(transactionId: string): Promise<Split[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('fin_transaction_splits')
    .select('id, amount_cents, category_id, cost_center, note')
    .eq('transaction_id', transactionId)
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: String(row.id),
      amountCents: Number(row.amount_cents ?? 0),
      categoryId: (row.category_id as string | null) ?? null,
      costCenter: (row.cost_center as string | null) ?? null,
      note: (row.note as string | null) ?? null,
    }
  })
}

/** Substitui o rateio inteiro. Lista vazia apaga o rateio e o lançamento volta a valer cheio. */
export async function saveSplits(
  transactionId: string,
  itens: Array<{ amountCents: number; categoryId?: string | null; costCenter?: string | null; note?: string | null }>,
): Promise<number> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_salvar_rateio', {
    p_transaction_id: transactionId,
    p_itens: itens.map((i) => ({
      amount_cents: Math.abs(Math.round(i.amountCents)),
      category_id: i.categoryId ?? null,
      cost_center: i.costCenter ?? null,
      note: i.note ?? null,
    })),
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

// ──────────────────────────────────────────── vendas do Shosp, já no banco
//
// A conciliação Shosp pedia UPLOAD da mesma planilha que a importação de vendas já tinha
// subido. Duas telas, o mesmo arquivo, duas vezes — e a conciliação só existia no dia em que
// alguém tivesse o arquivo em mãos. Agora que a venda mora em `fin_receivables` com CPF,
// parcelas, caixa e forma crua, dá pra conciliar direto do banco.

export type VendaShosp = {
  externalId: string
  date: string
  patient: string
  amountCents: number
  method: string
  methodRaw: string
  installments: number
  caixa: string
}

export async function listVendasShosp(de: string, ate: string): Promise<VendaShosp[]> {
  const rows = await buscarTudo<Record<string, unknown>>(
    () =>
      assertClient()
        .from('fin_receivables')
        .select('external_id, due_date, customer_name, amount_cents, method, method_raw, installments, caixa, id')
        .eq('source', 'shosp')
        .gte('due_date', de)
        .lte('due_date', ate)
        .order('due_date')
        .order('id'),
    { rotulo: 'fin_receivables (shosp)', maxPaginas: 20 },
  )
  return rows.map((r) => ({
    externalId: String(r.external_id ?? ''),
    date: String(r.due_date ?? ''),
    patient: String(r.customer_name ?? ''),
    amountCents: Number(r.amount_cents ?? 0),
    method: String(r.method ?? 'outro'),
    methodRaw: String(r.method_raw ?? ''),
    installments: Number(r.installments ?? 1),
    caixa: String(r.caixa ?? ''),
  }))
}

// ──────────────────────────────────────────── sugestão de categoria por IA
//
// A função `crm-classificar-gastos` NÃO escreve nada: devolve sugestão. Quem grava é o usuário
// aprovando, e a aprovação passa pelo mesmo `saveCategoryRule` de sempre. IA carimbando sozinha
// o razão de uma clínica é o mesmo que não ter conferência — e erro de classificação contamina
// o DRE inteiro sem ninguém perceber.

export type SugestaoIA = {
  padrao: string
  qtd: number
  amountCents: number
  categoryId: string
  categoria: string
  costCenter: string
  confianca: number
  motivo: string
}

export async function sugerirCategoriasIA(opts?: {
  de?: string
  ate?: string
  limite?: number
}): Promise<{ sugestoes: SugestaoIA[]; pagadores: number; descartadas: number }> {
  const client = assertClient()
  const { data, error } = await client.functions.invoke('crm-classificar-gastos', {
    body: { de: opts?.de, ate: opts?.ate, limite: opts?.limite ?? 30 },
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Record<string, unknown>
  if (r.error) throw new Error(String(r.message ?? r.error))
  return {
    sugestoes: (r.sugestoes as SugestaoIA[]) ?? [],
    pagadores: Number(r.pagadores ?? 0),
    // Quantas o modelo devolveu e a gente recusou por id inválido. Silêncio aqui esconderia
    // alucinação — se esse número for alto, a sugestão inteira merece desconfiança.
    descartadas: Number(r.descartadas ?? 0),
  }
}
