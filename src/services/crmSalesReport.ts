import { supabase } from '@/lib/supabaseClient'

/**
 * Relatório de vendas do dia (polo de vendas / Tricopill) para o financeiro.
 * Consolida `rede_payments` (cartão) + `pagbank_checkouts` (Pix link e venda manual),
 * SÓ PAGAS, no dia escolhido. RLS dessas tabelas já é tenant_id = current_tenant_id(),
 * então só vêm as cobranças do polo ativo.
 *
 * Deduplica: a mesma venda costuma ser registrada 2x (link real + confirmação manual,
 * ou Pix sandbox + cartão). Agrupamos por IDENTIDADE (telefone/lead) + valor no dia e
 * mantemos a melhor linha (com Bling > link real > cartão > com produto). Cada venda
 * carrega o cadastro completo do cliente (nome, CPF, e-mail, endereço).
 */

export type SaleRow = {
  paidAt: string | null
  method: 'card' | 'pix'
  customerName: string
  product: string
  kit: string
  installments: number | null
  amountCents: number
  freightCents: number
  discountCents: number
  couponCode: string | null
  blingOrderId: string | null
  phone: string
  // cadastro completo (best-effort; vazio quando venda avulsa sem lead)
  leadId: string | null
  cpf: string
  email: string
  address: string
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

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const normProduct = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** Limites UTC do dia LOCAL (Brasília no navegador) da data YYYY-MM-DD. */
function dayBoundsIso(dateYmd: string): { startIso: string; endIso: string } {
  const [y, m, d] = dateYmd.split('-').map(Number)
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

type RawSale = {
  id: string
  src: 'rede' | 'pagbank'
  leadId: string
  customerName: string
  kit: string
  description: string
  amountCents: number
  freightCents: number
  installments: number | null
  discountCents: number
  couponCode: string | null
  blingOrderId: string | null
  paidAt: string | null
  phone: string
}

/** Pontua uma linha para escolher a representante do grupo (maior = melhor). */
function score(r: RawSale): number {
  let s = 0
  if (r.blingOrderId) s += 100 // já foi pro Bling = registro definitivo
  if (!r.id.startsWith('manual-')) s += 40 // pagamento real (link/webhook) > entrada manual
  if (r.src === 'rede') s += 20 // cartão é o método vivo; Pix PagBank é sandbox
  const prod = r.kit || r.description
  if (prod && prod.trim()) s += 10
  return s
}

/** Limites UTC do MÊS local (YYYY-MM). */
export function monthBoundsIso(monthYm: string): { startIso: string; endIso: string } {
  const [y, m] = monthYm.split('-').map(Number)
  const start = new Date(y, (m ?? 1) - 1, 1, 0, 0, 0, 0)
  const end = new Date(y, m ?? 1, 1, 0, 0, 0, 0)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

const emptyTotals = (): SalesReport['totals'] => ({ count: 0, totalCents: 0, cardCents: 0, pixCents: 0, discountCents: 0, cardCount: 0, pixCount: 0 })

/** Relatório de vendas pagas de UM DIA. */
export async function fetchSalesReport(dateYmd: string): Promise<SalesReport> {
  const { startIso, endIso } = dayBoundsIso(dateYmd)
  const { rows, totals } = await fetchSalesRowsInRange(startIso, endIso)
  return { date: dateYmd, rows, totals }
}

/** Núcleo: busca + deduplica as vendas PAGAS na janela [startIso, endIso). Reusado por dia e mês. */
export async function fetchSalesRowsInRange(startIso: string, endIso: string): Promise<{ rows: SaleRow[]; totals: SalesReport['totals'] }> {
  if (!supabase) return { rows: [], totals: emptyTotals() }

  // Janela por paid_at: pega só as PAGAS no período (paid_at não-nulo já exclui links pendentes).
  const [redeRes, pagRes] = await Promise.all([
    supabase
      .from('rede_payments')
      .select('id, lead_id, customer_name, kit, amount_cents, freight_cents, discount_cents, coupon_code, installments, status, paid_at, description, bling_order_id, phone')
      .gte('paid_at', startIso)
      .lt('paid_at', endIso),
    supabase
      .from('pagbank_checkouts')
      .select('checkout_id, lead_id, kit, amount_cents, discount_cents, coupon_code, status, paid_at, phone')
      .gte('paid_at', startIso)
      .lt('paid_at', endIso),
  ])

  const rede = (redeRes.error ? [] : redeRes.data ?? []) as Array<Record<string, unknown>>
  const pag = (pagRes.error ? [] : pagRes.data ?? []) as Array<Record<string, unknown>>

  // Normaliza tudo num formato único, só as realmente pagas.
  const raw: RawSale[] = []
  for (const r of rede) {
    if (!isPaid(r.status, r.paid_at)) continue
    raw.push({
      id: String(r.id ?? ''),
      src: 'rede',
      leadId: r.lead_id != null ? String(r.lead_id) : '',
      customerName: String(r.customer_name ?? '').trim(),
      kit: r.kit != null ? String(r.kit) : '',
      description: r.description != null ? String(r.description) : '',
      amountCents: Number(r.amount_cents) || 0,
      freightCents: Number(r.freight_cents) || 0,
      installments: r.installments != null ? Number(r.installments) : null,
      discountCents: Number(r.discount_cents) || 0,
      couponCode: r.coupon_code != null ? String(r.coupon_code) : null,
      blingOrderId: r.bling_order_id != null ? String(r.bling_order_id) : null,
      paidAt: (r.paid_at as string) ?? null,
      phone: String(r.phone ?? ''),
    })
  }
  for (const r of pag) {
    if (!isPaid(r.status, r.paid_at)) continue
    raw.push({
      id: String(r.checkout_id ?? ''),
      src: 'pagbank',
      leadId: r.lead_id != null ? String(r.lead_id) : '',
      customerName: '',
      kit: r.kit != null ? String(r.kit) : '',
      description: '',
      amountCents: Number(r.amount_cents) || 0,
      freightCents: 0,
      installments: null,
      discountCents: Number(r.discount_cents) || 0,
      couponCode: r.coupon_code != null ? String(r.coupon_code) : null,
      blingOrderId: null,
      paidAt: (r.paid_at as string) ?? null,
      phone: String(r.phone ?? ''),
    })
  }

  // Cadastro dos leads (nome completo, CPF, e-mail, endereço) + telefone p/ identidade.
  const leadIds = Array.from(new Set(raw.map((r) => r.leadId).filter((id) => id && !id.startsWith('site-'))))
  type LeadInfo = { name: string; phone: string; cpf: string; email: string; address: string }
  const leadInfo: Record<string, LeadInfo> = {}
  if (leadIds.length > 0) {
    const { data: leads } = await supabase.from('leads').select('id, patient_name, phone, custom_fields').in('id', leadIds)
    for (const l of (leads ?? []) as Array<Record<string, unknown>>) {
      const cf = (l.custom_fields ?? {}) as Record<string, unknown>
      const cad = (cf.cadastro ?? {}) as Record<string, unknown>
      const ent = (cf.entrega ?? {}) as Record<string, unknown>
      const s = (v: unknown) => (v == null ? '' : String(v).trim())
      const logradouro = s(ent.logradouro)
      const numero = s(ent.numero)
      const complemento = s(ent.complemento)
      const bairro = s(ent.bairro)
      const cidade = s(ent.cidade) || s(ent.municipio)
      const uf = s(ent.uf)
      const cep = s(ent.cep)
      const addrParts: string[] = []
      const linha1 = [logradouro, numero].filter(Boolean).join(', ')
      if (linha1) addrParts.push(complemento ? `${linha1} (${complemento})` : linha1)
      const linha2 = [bairro, [cidade, uf].filter(Boolean).join('/')].filter(Boolean).join(' - ')
      if (linha2) addrParts.push(linha2)
      if (cep) addrParts.push(`CEP ${cep}`)
      leadInfo[String(l.id)] = {
        name: s(cad.nomeCompleto) || s(l.patient_name),
        phone: s(l.phone),
        cpf: s(cad.cpf),
        email: s(cad.email) || s(cf.email),
        address: addrParts.join(' · '),
      }
    }
  }

  // Identidade p/ dedup: telefone (real no W-API) > lead > produto. Une link+manual e Pix+cartão.
  const identity = (r: RawSale): string => {
    const ph = digits(r.phone) || digits(leadInfo[r.leadId]?.phone)
    if (ph.length >= 8) return `T:${ph}`
    if (r.leadId) return `L:${r.leadId}`
    return `P:${normProduct(r.kit || r.description)}`
  }

  // Agrupa por identidade + valor no dia; mantém a de maior score (desempate: mais cedo).
  const groups = new Map<string, RawSale>()
  for (const r of raw) {
    const key = `${identity(r)}|${r.amountCents}`
    const cur = groups.get(key)
    if (!cur) {
      groups.set(key, r)
      continue
    }
    const better =
      score(r) > score(cur) ||
      (score(r) === score(cur) && (Date.parse(r.paidAt ?? '') || Infinity) < (Date.parse(cur.paidAt ?? '') || Infinity))
    if (better) groups.set(key, r)
  }

  const productOf = (r: RawSale): string => {
    if (r.kit && KIT_LABEL[r.kit]) return KIT_LABEL[r.kit]
    if (r.description.trim()) return r.description.trim()
    return r.kit || '—'
  }

  const rows: SaleRow[] = Array.from(groups.values()).map((r) => {
    const info = leadInfo[r.leadId]
    return {
      paidAt: r.paidAt,
      method: r.src === 'rede' ? 'card' : 'pix',
      customerName: info?.name || r.customerName || 'Cliente',
      product: productOf(r),
      kit: r.kit || '',
      installments: r.installments,
      amountCents: r.amountCents,
      freightCents: r.freightCents,
      discountCents: r.discountCents,
      couponCode: r.couponCode,
      blingOrderId: r.blingOrderId,
      phone: r.phone || info?.phone || '',
      leadId: r.leadId || null,
      cpf: info?.cpf || '',
      email: info?.email || '',
      address: info?.address || '',
    }
  })

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

  return { rows, totals }
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Gera o CSV do relatório (separador ';' — abre direto no Excel pt-BR). */
export function salesReportToCsv(report: SalesReport): string {
  const head = [
    'Hora', 'Cliente', 'CPF', 'Telefone', 'E-mail', 'Endereço',
    'Produto', 'Forma', 'Parcelas', 'Valor', 'Desconto', 'Cupom', 'Pedido Bling',
  ]
  const fmtHora = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
  const lines = report.rows.map((r) =>
    [
      fmtHora(r.paidAt),
      r.customerName,
      r.cpf,
      r.phone,
      r.email,
      r.address,
      r.product,
      r.method === 'card' ? 'Cartão' : 'Pix',
      r.method === 'card' && r.installments ? `${r.installments}x` : '',
      brl(r.amountCents),
      r.discountCents ? brl(r.discountCents) : '',
      r.couponCode ?? '',
      r.blingOrderId ?? '',
    ]
      .map((c) => `"${String(c).replace(/"/g, '""')}"`)
      .join(';'),
  )
  const total = `"";"";"";"";"";"";"";"";"TOTAL";"${brl(report.totals.totalCents)}";"";"";""`
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
