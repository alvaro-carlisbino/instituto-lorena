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
}

const ACCOUNT_COLS =
  'id, name, kind, bank_name, branch, number, opening_balance_cents, active, note, of_provider, of_account_id, of_last_sync_at'

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

/** Saldo atual por conta = saldo inicial + soma dos lançamentos (fin_transactions, já assinados). */
export async function accountBalances(): Promise<Map<string, number>> {
  const client = assertClient()
  const [accounts, txns] = await Promise.all([
    client.from('fin_accounts').select('id, opening_balance_cents'),
    client.from('fin_transactions').select('account_id, amount_cents'),
  ])
  if (accounts.error) throw new Error(accounts.error.message)
  if (txns.error) throw new Error(txns.error.message)
  const balances = new Map<string, number>()
  for (const a of accounts.data ?? []) balances.set(String(a.id), Number(a.opening_balance_cents ?? 0))
  for (const t of txns.data ?? []) {
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
  description: string | null
  counterparty: string | null
  source: TxnSource
  externalId: string | null
  reconciledRefType: 'payable' | 'receivable' | null
  reconciledRefId: string | null
  note: string | null
}

const TXN_COLS =
  'id, account_id, date, amount_cents, direction, category_id, description, counterparty, source, external_id, reconciled_ref_type, reconciled_ref_id, note'

function mapTxn(r: Record<string, unknown>): FinTransaction {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    date: String(r.date ?? ''),
    amountCents: Number(r.amount_cents ?? 0),
    direction: (r.direction === 'in' ? 'in' : 'out') as TxnDirection,
    categoryId: r.category_id != null ? String(r.category_id) : null,
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

export async function listTransactions(opts?: {
  accountId?: string
  from?: string
  to?: string
  onlyUnreconciled?: boolean
  limit?: number
}): Promise<FinTransaction[]> {
  const client = assertClient()
  let query = client.from('fin_transactions').select(TXN_COLS).order('date', { ascending: false }).limit(opts?.limit ?? 1000)
  if (opts?.accountId) query = query.eq('account_id', opts.accountId)
  if (opts?.from) query = query.gte('date', opts.from)
  if (opts?.to) query = query.lte('date', opts.to)
  if (opts?.onlyUnreconciled) query = query.is('reconciled_ref_id', null)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapTxn(r as Record<string, unknown>))
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

export async function listReceivables(): Promise<Receivable[]> {
  const client = assertClient()
  const { data, error } = await client.from('fin_receivables').select(RECEIVABLE_COLS).order('due_date').limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapReceivable(r as Record<string, unknown>))
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
      due_date: due.toISOString().slice(0, 10),
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
  const receivedOn = opts?.receivedOn ?? new Date().toISOString().slice(0, 10)
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
