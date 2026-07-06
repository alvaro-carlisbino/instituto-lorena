import { supabase } from '@/lib/supabaseClient'

// Visão UNIFICADA de recebimentos do polo ativo (RLS): cartão (rede_payments) + Pix
// (pagbank_checkouts), normalizados num único formato para o painel financeiro e a
// conciliação bancária. Também concentra a conciliação (payment_reconciliation).

export type PaymentMethod = 'card' | 'pix'
export type PaymentStatus = 'paid' | 'pending' | 'failed'

export type UnifiedPayment = {
  /** rede_payments.id (cartão) OU pagbank_checkouts.checkout_id (Pix). */
  id: string
  method: PaymentMethod
  leadId: string | null
  customerName: string | null
  phone: string | null
  customerDoc: string | null
  amountCents: number
  description: string | null
  kit: string | null
  installments: number
  status: PaymentStatus
  tid: string | null
  returnCode: string | null
  blingOrderId: string | null
  createdAt: string
  paidAt: string | null
  /** Frete em centavos embutido no total (só Asaas grava; null = não informado). */
  freightCents: number | null
  /** ID do pedido no Melhor Envio (base p/ rastreio; só Asaas). */
  meOrderId: string | null
}

const PAID_STATUSES = new Set(['paid', 'pago', 'approved', 'available', 'completed'])
const FAIL_STATUSES = new Set(['failed', 'denied', 'declined', 'canceled', 'cancelled'])

function statusOf(raw: string, paidAt: string | null): PaymentStatus {
  if (paidAt || PAID_STATUSES.has(raw.toLowerCase())) return 'paid'
  if (FAIL_STATUSES.has(raw.toLowerCase())) return 'failed'
  return 'pending'
}
const asRec = (r: unknown) => r as Record<string, unknown>
const str = (v: unknown) => (v != null && String(v).trim() ? String(v) : null)

/** Lista cartão + Pix unificados, ordenados por criação (desc). RLS confina ao polo. */
export async function fetchUnifiedPayments(limit = 500): Promise<UnifiedPayment[]> {
  if (!supabase) return []
  const [asaas, rede, pix] = await Promise.all([
    supabase
      .from('asaas_payments')
      .select('id, lead_id, method, amount_cents, description, kit, installments, status, return_code, customer_name, phone, customer_doc, asaas_payment_id, bling_order_id, created_at, paid_at, freight_cents, me_order_id')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('rede_payments')
      .select('id, lead_id, method, amount_cents, description, kit, installments, status, tid, return_code, customer_name, phone, customer_doc, bling_order_id, created_at, paid_at')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('pagbank_checkouts')
      .select('checkout_id, lead_id, amount_cents, kit, status, customer_name, phone, customer_doc, bling_order_id, created_at, paid_at')
      .order('created_at', { ascending: false })
      .limit(limit),
  ])

  const rows: UnifiedPayment[] = []

  if (!asaas.error) {
    for (const r of asaas.data ?? []) {
      const rec = asRec(r)
      const paidAt = rec.paid_at != null ? String(rec.paid_at) : null
      rows.push({
        id: String(rec.id ?? ''),
        method: String(rec.method ?? 'card') === 'pix' ? 'pix' : 'card',
        leadId: str(rec.lead_id),
        customerName: str(rec.customer_name),
        phone: str(rec.phone),
        customerDoc: str(rec.customer_doc),
        amountCents: Number(rec.amount_cents ?? 0),
        description: str(rec.description),
        kit: str(rec.kit),
        installments: Number(rec.installments ?? 1),
        status: statusOf(String(rec.status ?? 'pending'), paidAt),
        tid: str(rec.asaas_payment_id),
        returnCode: str(rec.return_code),
        blingOrderId: str(rec.bling_order_id),
        createdAt: String(rec.created_at ?? ''),
        paidAt,
        freightCents: rec.freight_cents != null ? Number(rec.freight_cents) : null,
        meOrderId: str(rec.me_order_id),
      })
    }
  }

  if (!rede.error) {
    for (const r of rede.data ?? []) {
      const rec = asRec(r)
      const paidAt = rec.paid_at != null ? String(rec.paid_at) : null
      rows.push({
        id: String(rec.id ?? ''),
        // e.Rede processa cartão E Pix — respeitar a coluna method (antes era 'card' fixo,
        // e todo Pix da Rede aparecia como Cartão no painel).
        method: String(rec.method ?? 'card') === 'pix' ? 'pix' : 'card',
        leadId: str(rec.lead_id),
        customerName: str(rec.customer_name),
        phone: str(rec.phone),
        customerDoc: str(rec.customer_doc),
        amountCents: Number(rec.amount_cents ?? 0),
        description: str(rec.description),
        kit: str(rec.kit),
        installments: Number(rec.installments ?? 1),
        status: statusOf(String(rec.status ?? 'pending'), paidAt),
        tid: str(rec.tid),
        returnCode: str(rec.return_code),
        blingOrderId: str(rec.bling_order_id),
        createdAt: String(rec.created_at ?? ''),
        paidAt,
        freightCents: null,
        meOrderId: null,
      })
    }
  }

  if (!pix.error) {
    for (const r of pix.data ?? []) {
      const rec = asRec(r)
      const paidAt = rec.paid_at != null ? String(rec.paid_at) : null
      rows.push({
        id: String(rec.checkout_id ?? ''),
        method: 'pix',
        leadId: str(rec.lead_id),
        customerName: str(rec.customer_name),
        phone: str(rec.phone),
        customerDoc: str(rec.customer_doc),
        amountCents: Number(rec.amount_cents ?? 0),
        description: rec.kit != null ? `Tricopill ${String(rec.kit).replace('_', ' ')}` : null,
        kit: str(rec.kit),
        installments: 1,
        status: statusOf(String(rec.status ?? 'created'), paidAt),
        tid: null,
        returnCode: null,
        blingOrderId: str(rec.bling_order_id),
        createdAt: String(rec.created_at ?? ''),
        paidAt,
        freightCents: null,
        meOrderId: null,
      })
    }
  }

  rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return rows
}

// === Conciliação bancária (payment_reconciliation) ===

export type ReconciliationRow = {
  paymentId: string
  method: PaymentMethod
  bankRef: string | null
  bankAmountCents: number | null
  matchedSource: string | null
  note: string | null
  reconciledAt: string
}

/** Chave canônica método:pagamento para indexar no front. */
export const reconKey = (method: PaymentMethod, paymentId: string) => `${method}:${paymentId}`

export async function fetchReconciliations(): Promise<Map<string, ReconciliationRow>> {
  const map = new Map<string, ReconciliationRow>()
  if (!supabase) return map
  const { data, error } = await supabase
    .from('payment_reconciliation')
    .select('payment_id, payment_method, bank_ref, bank_amount_cents, matched_source, note, reconciled_at')
  if (error) throw new Error(error.message)
  for (const r of data ?? []) {
    const rec = asRec(r)
    const method = (String(rec.payment_method ?? 'card') === 'pix' ? 'pix' : 'card') as PaymentMethod
    const paymentId = String(rec.payment_id ?? '')
    map.set(reconKey(method, paymentId), {
      paymentId,
      method,
      bankRef: str(rec.bank_ref),
      bankAmountCents: rec.bank_amount_cents != null ? Number(rec.bank_amount_cents) : null,
      matchedSource: str(rec.matched_source),
      note: str(rec.note),
      reconciledAt: String(rec.reconciled_at ?? ''),
    })
  }
  return map
}

/**
 * Marca um pagamento como conciliado (cria/atualiza). Update-primeiro, insert-se-novo:
 * a RLS confina por polo, então (payment_id, método) é único dentro do polo.
 */
export async function markReconciled(args: {
  paymentId: string
  method: PaymentMethod
  bankRef?: string | null
  bankAmountCents?: number | null
  note?: string | null
  matchedSource?: 'manual' | 'csv_import'
}): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const payload = {
    bank_ref: args.bankRef ?? null,
    bank_amount_cents: args.bankAmountCents ?? null,
    note: args.note ?? null,
    matched_source: args.matchedSource ?? 'manual',
    reconciled_at: new Date().toISOString(),
  }
  const { data: upd, error: updErr } = await supabase
    .from('payment_reconciliation')
    .update(payload)
    .eq('payment_id', args.paymentId)
    .eq('payment_method', args.method)
    .select('id')
  if (updErr) throw new Error(updErr.message)
  if (upd && upd.length > 0) return
  const { error: insErr } = await supabase.from('payment_reconciliation').insert({
    payment_id: args.paymentId,
    payment_method: args.method,
    ...payload,
  })
  if (insErr) throw new Error(insErr.message)
}

export async function unmarkReconciled(paymentId: string, method: PaymentMethod): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { error } = await supabase
    .from('payment_reconciliation')
    .delete()
    .eq('payment_id', paymentId)
    .eq('payment_method', method)
  if (error) throw new Error(error.message)
}

// === Import de extrato bancário (CSV) → match por valor + data ===

export type BankStatementLine = { rawIndex: number; dateMs: number | null; amountCents: number; ref: string }
export type BankMatchResult = {
  matched: Array<{ payment: UnifiedPayment; line: BankStatementLine }>
  unmatchedLines: BankStatementLine[]
  parsedCount: number
}

/** Detecta delimitador e parseia valores BR ("1.234,56") ou US ("1234.56"). */
function parseAmountToCents(raw: string): number {
  const s = String(raw ?? '').replace(/[R$\s]/g, '').trim()
  if (!s) return NaN
  // BR: vírgula decimal. US: ponto decimal. Heurística: se tem vírgula, é decimal BR.
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normalized)
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : NaN
}
function parseDateMs(raw: string): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})/)
  if (br) {
    const y = br[3].length === 2 ? 2000 + Number(br[3]) : Number(br[3])
    const d = new Date(y, Number(br[2]) - 1, Number(br[1]))
    return Number.isNaN(d.getTime()) ? null : d.getTime()
  }
  const iso = new Date(s)
  return Number.isNaN(iso.getTime()) ? null : iso.getTime()
}

/**
 * Parseia um CSV de extrato (Rede/PagBank/banco) em linhas {data, valor, ref}. Procura por
 * colunas que pareçam valor e data; cai num modo tolerante (qualquer coluna numérica = valor).
 */
export function parseBankStatementCsv(text: string): BankStatementLine[] {
  const raw = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (raw.length === 0) return []
  const delim = (raw[0].match(/;/g)?.length ?? 0) >= (raw[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const split = (line: string) => line.split(delim).map((c) => c.replace(/^"|"$/g, '').trim())
  // Detecta cabeçalho: 1ª linha sem nenhum valor numérico plausível.
  const first = split(raw[0])
  const headerHasAmount = first.some((c) => Number.isFinite(parseAmountToCents(c)))
  const dataLines = headerHasAmount ? raw : raw.slice(1)
  const lines: BankStatementLine[] = []
  dataLines.forEach((line, i) => {
    const cells = split(line)
    let amountCents = NaN
    let dateMs: number | null = null
    let ref = ''
    for (const c of cells) {
      if (dateMs == null) { const d = parseDateMs(c); if (d != null && /\d{2,4}/.test(c) && c.length >= 6) dateMs = d }
      const a = parseAmountToCents(c)
      if (Number.isFinite(a) && a > 0 && !Number.isNaN(a)) amountCents = a
      if (!ref && c.length >= 6 && /[A-Za-z0-9]/.test(c) && Number.isNaN(parseAmountToCents(c))) ref = c
    }
    if (Number.isFinite(amountCents)) lines.push({ rawIndex: i, dateMs, amountCents, ref })
  })
  return lines
}

/**
 * Casa linhas do extrato com pagamentos PAGOS por valor exato (centavos) e data próxima
 * (±toleranceDays). Greedy 1-para-1: cada pagamento e cada linha casam no máximo uma vez.
 * Devolve casados + linhas sem correspondência (NUNCA descarta em silêncio).
 */
export function matchStatementToPayments(
  lines: BankStatementLine[],
  payments: UnifiedPayment[],
  toleranceDays = 5,
): BankMatchResult {
  const tolMs = toleranceDays * 86_400_000
  const paid = payments.filter((p) => p.status === 'paid')
  const usedPayment = new Set<string>()
  const matched: BankMatchResult['matched'] = []
  const unmatchedLines: BankStatementLine[] = []

  for (const line of lines) {
    const candidates = paid.filter(
      (p) => !usedPayment.has(reconKey(p.method, p.id)) && p.amountCents === line.amountCents,
    )
    // Prefere o pagamento com data paga mais próxima da linha do extrato.
    let best: UnifiedPayment | null = null
    let bestDelta = Infinity
    for (const p of candidates) {
      const pMs = p.paidAt ? new Date(p.paidAt).getTime() : NaN
      const delta = line.dateMs != null && Number.isFinite(pMs) ? Math.abs(pMs - line.dateMs) : 0
      if (line.dateMs != null && Number.isFinite(pMs) && delta > tolMs) continue
      if (delta < bestDelta) { best = p; bestDelta = delta }
    }
    if (best) {
      usedPayment.add(reconKey(best.method, best.id))
      matched.push({ payment: best, line })
    } else {
      unmatchedLines.push(line)
    }
  }
  return { matched, unmatchedLines, parsedCount: lines.length }
}
