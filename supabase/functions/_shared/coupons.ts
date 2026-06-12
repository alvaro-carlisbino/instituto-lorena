import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Cupons de desconto (tabela public.coupons, escopo por tenant).
 * - `quoteCoupon` valida o código e devolve o desconto aplicável sobre um valor base.
 * - O uso (`uses`) NÃO é contado aqui: só quando o pagamento confirma, via
 *   `incrementCouponUse` chamado pelos webhooks/aprovação (carrinho abandonado
 *   não queima o cupom).
 */

export type CouponRow = {
  tenant_id: string
  code: string
  kind: 'percent' | 'fixed'
  value: number
  active: boolean
  valid_from: string | null
  valid_until: string | null
  max_uses: number | null
  uses: number
  min_amount_cents: number
}

export type CouponQuote = {
  applied: boolean
  code: string | null
  kind?: 'percent' | 'fixed'
  value?: number
  discountCents: number
  finalCents: number
  /** Motivo de não-aplicação (not_found | inactive | not_started | expired | exhausted | below_min | no_effect). */
  reason?: string
}

/** Normaliza o código: maiúsculas, só [A-Z0-9_-], até 40 chars. */
export function normalizeCouponCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 40)
}

export function formatBRLCents(cents: number): string {
  return (Math.round(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Cota o desconto de um cupom sobre `baseCents`. Nunca falha: se o cupom não
 * existir/valer, devolve `applied:false` com o valor cheio e um `reason`.
 */
export async function quoteCoupon(
  admin: SupabaseClient,
  tenantId: string,
  rawCode: string | null | undefined,
  baseCents: number,
): Promise<CouponQuote> {
  const base = Math.round(Number(baseCents) || 0)
  const noDiscount = (reason?: string, code: string | null = null): CouponQuote => ({
    applied: false,
    code,
    discountCents: 0,
    finalCents: base,
    reason,
  })

  const code = normalizeCouponCode(String(rawCode ?? ''))
  if (!code) return noDiscount()
  if (!tenantId) return noDiscount('not_found', code)

  let row: CouponRow | null = null
  try {
    const { data } = await admin
      .from('coupons')
      .select('tenant_id, code, kind, value, active, valid_from, valid_until, max_uses, uses, min_amount_cents')
      .eq('tenant_id', tenantId)
      .eq('code', code)
      .maybeSingle()
    row = (data as CouponRow | null) ?? null
  } catch {
    return noDiscount('not_found', code)
  }
  if (!row) return noDiscount('not_found', code)
  if (!row.active) return noDiscount('inactive', code)

  const now = Date.now()
  if (row.valid_from && Date.parse(row.valid_from) > now) return noDiscount('not_started', code)
  if (row.valid_until && Date.parse(row.valid_until) < now) return noDiscount('expired', code)
  if (row.max_uses != null && row.uses >= row.max_uses) return noDiscount('exhausted', code)
  if (row.min_amount_cents && base < row.min_amount_cents) return noDiscount('below_min', code)

  let discount = row.kind === 'percent' ? Math.round((base * row.value) / 100) : Math.round(row.value)
  // Nunca deixa o valor final abaixo de R$ 1,00 (limite mínimo dos gateways).
  discount = Math.max(0, Math.min(discount, base - 100))
  if (discount <= 0) return noDiscount('no_effect', code)

  return {
    applied: true,
    code,
    kind: row.kind,
    value: row.value,
    discountCents: discount,
    finalCents: base - discount,
  }
}

/** Conta um uso do cupom (atómico via RPC). Best-effort: nunca lança. */
export async function incrementCouponUse(
  admin: SupabaseClient,
  tenantId: string,
  rawCode: string | null | undefined,
): Promise<void> {
  const code = normalizeCouponCode(String(rawCode ?? ''))
  if (!code || !tenantId) return
  try {
    await admin.rpc('increment_coupon_use', { p_tenant: tenantId, p_code: code })
  } catch {
    // best-effort — não bloqueia o fluxo de pagamento
  }
}
