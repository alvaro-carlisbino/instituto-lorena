import { supabase } from '@/lib/supabaseClient'

async function invoke(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: unknown }).context as { json?: () => Promise<unknown>; clone?: () => Response } | undefined
    try {
      if (ctx && typeof ctx.json === 'function') {
        const b = (await (ctx.clone ? ctx.clone() : (ctx as unknown as Response)).json()) as { message?: string; error?: string }
        msg = b?.message || b?.error || msg
      }
    } catch {
      // ignore
    }
    throw new Error(String(msg || 'Falha na operação'))
  }
  return (data ?? {}) as Record<string, unknown>
}

export type Coupon = {
  code: string
  kind: 'percent' | 'fixed'
  value: number // percent: 1..100 | fixed: centavos
  active: boolean
  valid_from: string | null
  valid_until: string | null
  max_uses: number | null
  uses: number
  min_amount_cents: number
  note: string | null
  created_at: string | null
}

export async function listCoupons(): Promise<Coupon[]> {
  const p = await invoke('crm-coupons', { action: 'list' })
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha ao listar cupons'))
  return (p.coupons as Coupon[]) ?? []
}

export type CouponInput = {
  code: string
  kind: 'percent' | 'fixed'
  value: number
  active?: boolean
  valid_from?: string | null
  valid_until?: string | null
  max_uses?: number | null
  min_amount_cents?: number
  note?: string | null
}

export async function upsertCoupon(input: CouponInput): Promise<string> {
  const p = await invoke('crm-coupons', { action: 'upsert', ...input })
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha ao salvar cupom'))
  return String(p.code ?? input.code)
}

export async function setCouponActive(code: string, active: boolean): Promise<void> {
  const p = await invoke('crm-coupons', { action: 'set_active', code, active })
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha'))
}

export async function deleteCoupon(code: string): Promise<void> {
  const p = await invoke('crm-coupons', { action: 'delete', code })
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha'))
}
