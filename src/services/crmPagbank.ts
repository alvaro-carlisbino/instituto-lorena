import { supabase } from '@/lib/supabaseClient'

export type PagbankKit = '1_mes' | '3_meses' | '5_meses'

export const PAGBANK_KIT_LABELS: Record<PagbankKit, string> = {
  '1_mes': '1 frasco — R$ 199,00',
  '3_meses': '3+1 frascos (4) — Pix R$ 567,00 / cartão R$ 597,00',
  '5_meses': '5 frascos — Pix R$ 662,15 / cartão R$ 697,00',
}

export type PagbankLinkResult = { ok: true; payLink: string; label: string; amountCents: number }

/**
 * Gera um Link de Pagamento PagBank (Pix + cartão). `leadId` opcional: com lead,
 * o pagamento move o lead para "Pago"; sem lead, gera um link avulso (fora do chat).
 */
export async function generatePagbankLink(args: {
  leadId?: string
  kit: PagbankKit
  customerName?: string
  phone?: string
  freightCents?: number
  couponCode?: string
}): Promise<PagbankLinkResult> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.functions.invoke('crm-pagbank-checkout', {
    body: {
      ...(args.leadId ? { leadId: args.leadId } : {}),
      kit: args.kit,
      ...(args.customerName ? { customerName: args.customerName } : {}),
      ...(args.phone ? { phone: args.phone } : {}),
      ...(args.freightCents && args.freightCents > 0 ? { freightCents: args.freightCents } : {}),
      ...(args.couponCode?.trim() ? { couponCode: args.couponCode.trim() } : {}),
    },
  })
  if (error) {
    const ctx = (error as { context?: { body?: unknown } }).context
    const msg = ctx && typeof ctx.body === 'string' ? ctx.body : error.message
    throw new Error(String(msg || 'Falha ao gerar link PagBank'))
  }
  const p = (data ?? {}) as { ok?: boolean; payLink?: string; label?: string; amountCents?: number; message?: string }
  if (!p.ok || !p.payLink) throw new Error(String(p.message || 'Falha ao gerar link PagBank'))
  return { ok: true, payLink: p.payLink, label: String(p.label ?? ''), amountCents: Number(p.amountCents ?? 0) }
}

export type PagbankCheckoutRow = {
  checkoutId: string
  leadId: string | null
  amountCents: number
  kit: string | null
  payLink: string
  status: string
  createdAt: string
  paidAt: string | null
  customerName: string | null
  method: 'pix' | 'card'
}

const PAID_STATUSES = new Set(['paid', 'pago', 'approved', 'available', 'completed'])
function normalizeStatus(status: string, paidAt: string | null): string {
  return paidAt || PAID_STATUSES.has(status.toLowerCase()) ? 'paid' : status
}
function asRec(r: unknown): Record<string, unknown> {
  return r as Record<string, unknown>
}

/**
 * Lista TODOS os links de pagamento do polo ativo (RLS): Pix (PagBank) + cartão (Rede),
 * unificados e ordenados por data. Inclui nome do cliente e quando foi pago.
 */
export async function fetchPagbankCheckouts(limit = 50): Promise<PagbankCheckoutRow[]> {
  if (!supabase) return []
  const [pb, rede] = await Promise.all([
    supabase
      .from('pagbank_checkouts')
      .select('checkout_id, lead_id, amount_cents, kit, pay_link, status, created_at, paid_at')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('rede_payments')
      .select('id, lead_id, method, amount_cents, kit, status, created_at, paid_at, customer_name')
      .order('created_at', { ascending: false })
      .limit(limit),
  ])
  if (pb.error) throw new Error(pb.error.message)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const rows: PagbankCheckoutRow[] = []

  for (const r of pb.data ?? []) {
    const rec = asRec(r)
    const paidAt = rec.paid_at != null ? String(rec.paid_at) : null
    rows.push({
      checkoutId: String(rec.checkout_id ?? ''),
      leadId: rec.lead_id != null ? String(rec.lead_id) : null,
      amountCents: Number(rec.amount_cents ?? 0),
      kit: rec.kit != null ? String(rec.kit) : null,
      payLink: String(rec.pay_link ?? ''),
      status: normalizeStatus(String(rec.status ?? 'created'), paidAt),
      createdAt: String(rec.created_at ?? ''),
      paidAt,
      customerName: null,
      method: 'pix',
    })
  }

  // rede_payments pode não existir/erro de permissão em alguns polos → best-effort.
  if (!rede.error) {
    for (const r of rede.data ?? []) {
      const rec = asRec(r)
      const paidAt = rec.paid_at != null ? String(rec.paid_at) : null
      const id = String(rec.id ?? '')
      rows.push({
        checkoutId: id,
        leadId: rec.lead_id != null ? String(rec.lead_id) : null,
        amountCents: Number(rec.amount_cents ?? 0),
        kit: rec.kit != null ? String(rec.kit) : null,
        payLink: origin ? `${origin}/pagar/${id}` : `/pagar/${id}`,
        status: normalizeStatus(String(rec.status ?? 'pending'), paidAt),
        createdAt: String(rec.created_at ?? ''),
        paidAt,
        customerName: rec.customer_name != null && String(rec.customer_name).trim() ? String(rec.customer_name) : null,
        method: String(rec.method ?? 'card') === 'pix' ? 'pix' : 'card',
      })
    }
  }

  rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return rows.slice(0, limit)
}
