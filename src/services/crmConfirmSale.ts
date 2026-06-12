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

export type ConfirmSaleInput = {
  leadId: string
  mode: 'kit' | 'custom'
  kit?: string
  amountCents?: number
  description?: string
  paymentMethod: 'pix' | 'card' | 'other'
  installments?: number
  couponCode?: string
  createBlingOrder?: boolean
}

export type ConfirmSaleResult = {
  amountCents: number
  discountCents: number
  couponCode: string | null
  method: string
  blingOrderId: string | null
  blingNote: string | null
}

export async function confirmSale(input: ConfirmSaleInput): Promise<ConfirmSaleResult> {
  const body: Record<string, unknown> = {
    leadId: input.leadId,
    paymentMethod: input.paymentMethod,
    createBlingOrder: input.createBlingOrder !== false,
  }
  if (input.mode === 'kit') body.kit = input.kit
  else {
    body.amountCents = input.amountCents
    body.description = input.description
  }
  if (input.paymentMethod === 'card') body.installments = input.installments ?? 1
  if (input.couponCode?.trim()) body.couponCode = input.couponCode.trim()

  const p = await invoke('crm-confirm-sale', body)
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha ao confirmar venda'))
  return {
    amountCents: Number(p.amountCents ?? 0),
    discountCents: Number(p.discountCents ?? 0),
    couponCode: (p.couponCode as string | null) ?? null,
    method: String(p.method ?? ''),
    blingOrderId: (p.blingOrderId as string | null) ?? null,
    blingNote: (p.blingNote as string | null) ?? null,
  }
}
