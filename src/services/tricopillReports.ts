import { supabase } from '@/lib/supabaseClient'
import { fetchSalesRowsInRange, monthBoundsIso, type SaleRow } from './crmSalesReport'

/**
 * Relatórios MENSAIS do Tricopill (financeiro/fechamento). Reusa o núcleo de vendas
 * (`fetchSalesRowsInRange`, já deduplicado) e agrega: fechamento (totais, por produto,
 * por forma, ticket, frete, cupons) + assinaturas. Envios vêm do edge crm-shipments-report.
 */

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csvRow = (cells: unknown[]) => cells.map(csvCell).join(';')

export type MonthlyClose = {
  count: number
  totalCents: number
  productCents: number
  freightCents: number
  discountCents: number
  cardCents: number
  pixCents: number
  cardCount: number
  pixCount: number
  ticketCents: number
  byProduct: Array<{ product: string; count: number; cents: number }>
  byCoupon: Array<{ code: string; count: number; discountCents: number }>
}

export type SubsSummary = {
  active: number
  paused: number
  canceled: number
  mrrCents: number
  rows: Array<{ name: string; plan: string; status: string; monthlyCents: number; paidCycles: number }>
}

export type MonthlyReport = {
  month: string
  sales: SaleRow[]
  close: MonthlyClose
  subs: SubsSummary
}

async function fetchSubsSummary(): Promise<SubsSummary> {
  const empty: SubsSummary = { active: 0, paused: 0, canceled: 0, mrrCents: 0, rows: [] }
  if (!supabase) return empty
  const { data, error } = await supabase
    .from('asaas_subscriptions')
    .select('customer_name, cadence, units_per_shipment, monthly_value_cents, paid_cycles, status')
    .eq('tenant_id', 'tricopill')
  if (error) return empty
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    name: String(r.customer_name ?? 'Cliente'),
    plan: `${Number(r.units_per_shipment ?? 0)}un/${String(r.cadence ?? '')}`,
    status: String(r.status ?? ''),
    monthlyCents: Number(r.monthly_value_cents ?? 0),
    paidCycles: Number(r.paid_cycles ?? 0),
  }))
  const isActive = (s: string) => s === 'active' || s === 'ACTIVE'
  const isPaused = (s: string) => s === 'paused' || s === 'INACTIVE'
  const isCanceled = (s: string) => s === 'canceled' || s === 'cancelled'
  return {
    active: rows.filter((r) => isActive(r.status)).length,
    paused: rows.filter((r) => isPaused(r.status)).length,
    canceled: rows.filter((r) => isCanceled(r.status)).length,
    mrrCents: rows.filter((r) => isActive(r.status)).reduce((s, r) => s + r.monthlyCents, 0),
    rows: rows.sort((a, b) => b.monthlyCents - a.monthlyCents),
  }
}

export async function fetchMonthlyReport(month: string): Promise<MonthlyReport> {
  const { startIso, endIso } = monthBoundsIso(month)
  const [{ rows, totals }, subs] = await Promise.all([fetchSalesRowsInRange(startIso, endIso), fetchSubsSummary()])

  const freightCents = rows.reduce((s, r) => s + r.freightCents, 0)
  const productCents = totals.totalCents - freightCents

  const byProductMap = new Map<string, { count: number; cents: number }>()
  for (const r of rows) {
    const k = r.product || '—'
    const e = byProductMap.get(k) ?? { count: 0, cents: 0 }
    e.count += 1
    e.cents += r.amountCents
    byProductMap.set(k, e)
  }
  const byCouponMap = new Map<string, { count: number; discountCents: number }>()
  for (const r of rows) {
    if (!r.couponCode) continue
    const e = byCouponMap.get(r.couponCode) ?? { count: 0, discountCents: 0 }
    e.count += 1
    e.discountCents += r.discountCents
    byCouponMap.set(r.couponCode, e)
  }

  const close: MonthlyClose = {
    count: totals.count,
    totalCents: totals.totalCents,
    productCents,
    freightCents,
    discountCents: totals.discountCents,
    cardCents: totals.cardCents,
    pixCents: totals.pixCents,
    cardCount: totals.cardCount,
    pixCount: totals.pixCount,
    ticketCents: totals.count ? Math.round(totals.totalCents / totals.count) : 0,
    byProduct: [...byProductMap.entries()].map(([product, v]) => ({ product, ...v })).sort((a, b) => b.cents - a.cents),
    byCoupon: [...byCouponMap.entries()].map(([code, v]) => ({ code, ...v })).sort((a, b) => b.count - a.count),
  }

  return { month, sales: rows, close, subs }
}

// ---- Envios (Melhor Envio) via edge autenticada ----
export type Shipment = {
  cliente: string
  tracking: string | null
  status: string
  service: string
  postedAt: string | null
  cep: string
  cidade: string
  priceCents: number
}

export async function fetchShipmentsReport(month: string): Promise<Shipment[]> {
  if (!supabase) return []
  const { data, error } = await supabase.functions.invoke('crm-shipments-report', { body: { month } })
  if (error) throw new Error(error.message)
  return ((data as { shipments?: Shipment[] } | null)?.shipments ?? [])
}

// ---- CSVs (separador ';' — abrem direto no Excel pt-BR) ----
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '')
const STATUS_PT: Record<string, string> = { active: 'Ativa', ACTIVE: 'Ativa', paused: 'Pausada', INACTIVE: 'Pausada', canceled: 'Cancelada', cancelled: 'Cancelada' }

export function salesCsv(rows: SaleRow[]): string {
  const head = ['Data', 'Cliente', 'CPF', 'Telefone', 'E-mail', 'Endereço', 'Produto', 'Forma', 'Parcelas', 'Frete', 'Valor', 'Desconto', 'Cupom', 'Pedido Bling']
  const lines = rows.map((r) =>
    csvRow([
      fmtDate(r.paidAt), r.customerName, r.cpf, r.phone, r.email, r.address, r.product,
      r.method === 'card' ? 'Cartão' : 'Pix', r.method === 'card' && r.installments ? `${r.installments}x` : '',
      r.freightCents ? brl(r.freightCents) : '', brl(r.amountCents), r.discountCents ? brl(r.discountCents) : '',
      r.couponCode ?? '', r.blingOrderId ?? '',
    ]),
  )
  return [csvRow(head), ...lines].join('\n')
}

export function closeCsv(c: MonthlyClose): string {
  const out: string[] = [csvRow(['Fechamento', 'Valor'])]
  out.push(csvRow(['Vendas', c.count]))
  out.push(csvRow(['Receita total', brl(c.totalCents)]))
  out.push(csvRow(['Produtos', brl(c.productCents)]))
  out.push(csvRow(['Frete arrecadado', brl(c.freightCents)]))
  out.push(csvRow(['Descontos', brl(c.discountCents)]))
  out.push(csvRow(['Ticket médio', brl(c.ticketCents)]))
  out.push(csvRow(['Cartão', `${brl(c.cardCents)} (${c.cardCount})`]))
  out.push(csvRow(['Pix', `${brl(c.pixCents)} (${c.pixCount})`]))
  out.push('')
  out.push(csvRow(['Por produto', 'Qtd', 'Valor']))
  for (const p of c.byProduct) out.push(csvRow([p.product, p.count, brl(p.cents)]))
  if (c.byCoupon.length) {
    out.push('')
    out.push(csvRow(['Cupom', 'Usos', 'Desconto']))
    for (const cp of c.byCoupon) out.push(csvRow([cp.code, cp.count, brl(cp.discountCents)]))
  }
  return out.join('\n')
}

export function subsCsv(s: SubsSummary): string {
  const head = ['Cliente', 'Plano', 'Status', 'Valor/mês', 'Ciclos pagos']
  const lines = s.rows.map((r) => csvRow([r.name, r.plan, STATUS_PT[r.status] ?? r.status, brl(r.monthlyCents), r.paidCycles]))
  const resumo = csvRow([`Ativas: ${s.active} · Pausadas: ${s.paused} · Canceladas: ${s.canceled} · MRR: ${brl(s.mrrCents)}`])
  return [resumo, '', csvRow(head), ...lines].join('\n')
}

export function shipmentsCsv(rows: Shipment[]): string {
  const head = ['Cliente', 'Rastreio', 'Status', 'Serviço', 'Postado', 'Cidade', 'CEP', 'Frete']
  const lines = rows.map((r) => csvRow([r.cliente, r.tracking ?? '', r.status, r.service, fmtDate(r.postedAt), r.cidade, r.cep, r.priceCents ? brl(r.priceCents) : '']))
  return [csvRow(head), ...lines].join('\n')
}

/** Baixa um CSV no navegador (BOM para acento abrir certo no Excel). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
