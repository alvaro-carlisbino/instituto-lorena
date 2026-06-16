import { supabase } from '@/lib/supabaseClient'

/**
 * Relatório de vendas do dia (polo de vendas / Tricopill) para o financeiro.
 * Consolida `rede_payments` (cartão) + `pagbank_checkouts` (Pix link e venda manual),
 * só PAGAS, no dia escolhido. RLS dessas tabelas já é tenant_id = current_tenant_id(),
 * então só vêm as cobranças do polo ativo. Nome do cliente vem do lead (ou customer_name).
 */

export type SaleRow = {
  paidAt: string | null
  method: 'card' | 'pix'
  customerName: string
  product: string
  installments: number | null
  amountCents: number
  discountCents: number
  couponCode: string | null
  blingOrderId: string | null
  phone: string
}

export type SalesReport = {
  date: string // YYYY-MM-DD
  rows: SaleRow[]
  totals: {
    count: number
    totalCents: number
    cardCents: number
    pixCents: number
    discountCents: number
    cardCount: number
    pixCount: number
  }
}

const PAID = new Set(['paid', 'pago', 'available', 'approved', 'completed'])
const isPaid = (status: unknown, paidAt: unknown) =>
  (paidAt != null && String(paidAt).length > 0) || (typeof status === 'string' && PAID.has(status.toLowerCase()))

const KIT_LABEL: Record<string, string> = {
  '1_mes': '1 frasco',
  '3_meses': 'Kit 3+1 (4 frascos)',
  '5_meses': '5 frascos',
}

/** Limites UTC do dia LOCAL (Brasília no navegador) da data YYYY-MM-DD. */
function dayBoundsIso(dateYmd: string): { startIso: string; endIso: string } {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

export async function fetchSalesReport(dateYmd: string): Promise<SalesReport> {
  const empty: SalesReport = {
    date: dateYmd,
    rows: [],
    totals: { count: 0, totalCents: 0, cardCents: 0, pixCents: 0, discountCents: 0, cardCount: 0, pixCount: 0 },
  }
  if (!supabase) return empty

  const { startIso, endIso } = dayBoundsIso(dateYmd)

  // Janela por created_at OU paid_at: pega pagas no dia (paid_at) mesmo que criadas antes.
  const [redeRes, pagRes] = await Promise.all([
    supabase
      .from('rede_payments')
      .select('lead_id, customer_name, kit, amount_cents, discount_cents, coupon_code, installments, status, paid_at, description, bling_order_id, phone')
      .gte('paid_at', startIso)
      .lt('paid_at', endIso),
    supabase
      .from('pagbank_checkouts')
      .select('lead_id, kit, amount_cents, discount_cents, coupon_code, status, paid_at, phone')
      .gte('paid_at', startIso)
      .lt('paid_at', endIso),
  ])

  const rede = (redeRes.error ? [] : redeRes.data ?? []) as Array<Record<string, unknown>>
  const pag = (pagRes.error ? [] : pagRes.data ?? []) as Array<Record<string, unknown>>

  // Nomes dos leads.
  const leadIds = Array.from(
    new Set(
      [...rede, ...pag]
        .map((r) => (r.lead_id != null ? String(r.lead_id) : ''))
        .filter((id) => id && !id.startsWith('site-')),
    ),
  )
  const names: Record<string, string> = {}
  if (leadIds.length > 0) {
    const { data: leads } = await supabase.from('leads').select('id, patient_name').in('id', leadIds)
    for (const l of (leads ?? []) as Array<{ id: string; patient_name?: string }>) {
      names[l.id] = String(l.patient_name ?? '').trim()
    }
  }

  const productOf = (kit: unknown, description: unknown): string => {
    const k = kit != null ? String(kit) : ''
    if (k && KIT_LABEL[k]) return KIT_LABEL[k]
    if (description != null && String(description).trim()) return String(description).trim()
    return k || '—'
  }

  const rows: SaleRow[] = []
  for (const r of rede) {
    if (!isPaid(r.status, r.paid_at)) continue
    const leadId = r.lead_id != null ? String(r.lead_id) : ''
    rows.push({
      paidAt: (r.paid_at as string) ?? null,
      method: 'card',
      customerName: names[leadId] || String(r.customer_name ?? '').trim() || 'Cliente',
      product: productOf(r.kit, r.description),
      installments: r.installments != null ? Number(r.installments) : null,
      amountCents: Number(r.amount_cents) || 0,
      discountCents: Number(r.discount_cents) || 0,
      couponCode: r.coupon_code != null ? String(r.coupon_code) : null,
      blingOrderId: r.bling_order_id != null ? String(r.bling_order_id) : null,
      phone: String(r.phone ?? ''),
    })
  }
  for (const r of pag) {
    if (!isPaid(r.status, r.paid_at)) continue
    const leadId = r.lead_id != null ? String(r.lead_id) : ''
    rows.push({
      paidAt: (r.paid_at as string) ?? null,
      method: 'pix',
      customerName: names[leadId] || 'Cliente',
      product: productOf(r.kit, null),
      installments: null,
      amountCents: Number(r.amount_cents) || 0,
      discountCents: Number(r.discount_cents) || 0,
      couponCode: r.coupon_code != null ? String(r.coupon_code) : null,
      blingOrderId: null,
      phone: String(r.phone ?? ''),
    })
  }

  rows.sort((a, b) => (Date.parse(a.paidAt ?? '') || 0) - (Date.parse(b.paidAt ?? '') || 0))

  const totals = rows.reduce(
    (acc, r) => {
      acc.count += 1
      acc.totalCents += r.amountCents
      acc.discountCents += r.discountCents
      if (r.method === 'card') {
        acc.cardCents += r.amountCents
        acc.cardCount += 1
      } else {
        acc.pixCents += r.amountCents
        acc.pixCount += 1
      }
      return acc
    },
    { count: 0, totalCents: 0, cardCents: 0, pixCents: 0, discountCents: 0, cardCount: 0, pixCount: 0 },
  )

  return { date: dateYmd, rows, totals }
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Gera o CSV do relatório (separador ';' — abre direto no Excel pt-BR). */
export function salesReportToCsv(report: SalesReport): string {
  const head = ['Hora', 'Cliente', 'Produto', 'Forma', 'Parcelas', 'Valor', 'Desconto', 'Cupom', 'Telefone', 'Pedido Bling']
  const fmtHora = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
  const lines = report.rows.map((r) =>
    [
      fmtHora(r.paidAt),
      r.customerName,
      r.product,
      r.method === 'card' ? 'Cartão' : 'Pix',
      r.method === 'card' && r.installments ? `${r.installments}x` : '',
      brl(r.amountCents),
      r.discountCents ? brl(r.discountCents) : '',
      r.couponCode ?? '',
      r.phone,
      r.blingOrderId ?? '',
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(';'),
  )
  const total = `"";"";"";"";"TOTAL";"${brl(report.totals.totalCents)}";"";"";"";""`
  return [head.map((h) => `"${h}"`).join(';'), ...lines, total].join('\n')
}

/** Texto resumido pra colar no WhatsApp/financeiro. */
export function salesReportToText(report: SalesReport): string {
  const t = report.totals
  const fmtHora = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
  const [y, m, d] = report.date.split('-')
  const linhas = report.rows.map(
    (r) =>
      `• ${fmtHora(r.paidAt)} — ${r.customerName} — ${r.product} — ${r.method === 'card' ? `Cartão${r.installments ? ' ' + r.installments + 'x' : ''}` : 'Pix'} — ${brl(r.amountCents)}`,
  )
  return [
    `📊 Vendas do dia ${d}/${m}/${y}`,
    '',
    ...linhas,
    '',
    `Total: ${brl(t.totalCents)} em ${t.count} venda(s)`,
    `Cartão: ${brl(t.cardCents)} (${t.cardCount}) · Pix: ${brl(t.pixCents)} (${t.pixCount})`,
    t.discountCents ? `Descontos: ${brl(t.discountCents)}` : '',
  ]
    .filter((l) => l !== '')
    .join('\n')
}
