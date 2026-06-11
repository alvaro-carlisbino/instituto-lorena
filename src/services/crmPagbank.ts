import { supabase } from '@/lib/supabaseClient'

export type PagbankKit = '1_mes' | '3_meses' | '5_meses'

export const PAGBANK_KIT_LABELS: Record<PagbankKit, string> = {
  '1_mes': '1 frasco — 1 mês (R$ 199)',
  '3_meses': '3 frascos — 3 meses + 1 grátis (R$ 597)',
  '5_meses': '5 frascos — 5 meses (R$ 999)',
}

export type PagbankLinkResult = { ok: true; payLink: string; label: string; amountCents: number }

/** Gera um Link de Pagamento PagBank (Pix + cartão) para o lead via edge function. */
export async function generatePagbankLink(args: {
  leadId: string
  kit: PagbankKit
}): Promise<PagbankLinkResult> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.functions.invoke('crm-pagbank-checkout', {
    body: { leadId: args.leadId, kit: args.kit },
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
