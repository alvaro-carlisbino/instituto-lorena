import { supabase } from '@/lib/supabaseClient'

export type PagbankKit = '1_mes' | '3_meses' | '5_meses'

export const PAGBANK_KIT_LABELS: Record<PagbankKit, string> = {
  '1_mes': '1 frasco — 1 mês (Pix R$ 189,05)',
  '3_meses': '3 frascos — 3 meses + 1 grátis (Pix R$ 567,15)',
  '5_meses': '5 frascos — 5 meses (Pix R$ 949,05)',
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
}

/** Lista os links de pagamento gerados (audit table), do polo ativo (RLS). */
export async function fetchPagbankCheckouts(limit = 50): Promise<PagbankCheckoutRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('pagbank_checkouts')
    .select('checkout_id, lead_id, amount_cents, kit, pay_link, status, created_at, paid_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    checkoutId: String((r as Record<string, unknown>).checkout_id ?? ''),
    leadId: (r as Record<string, unknown>).lead_id != null ? String((r as Record<string, unknown>).lead_id) : null,
    amountCents: Number((r as Record<string, unknown>).amount_cents ?? 0),
    kit: (r as Record<string, unknown>).kit != null ? String((r as Record<string, unknown>).kit) : null,
    payLink: String((r as Record<string, unknown>).pay_link ?? ''),
    status: String((r as Record<string, unknown>).status ?? 'created'),
    createdAt: String((r as Record<string, unknown>).created_at ?? ''),
    paidAt: (r as Record<string, unknown>).paid_at != null ? String((r as Record<string, unknown>).paid_at) : null,
  }))
}
