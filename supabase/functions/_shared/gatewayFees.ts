import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Taxa do gateway (adquirente) por modalidade — o que a Rede/Asaas retém da venda.
 *
 * Por que existe: o financeiro fecha o caixa pelo LÍQUIDO que caiu na conta, mas a API da
 * e.Rede NÃO devolve a taxa da transação (ela só aparece no extrato). Sem isso, a conta a
 * receber no Bling só podia ser baixada pelo bruto e o caixa nunca batia com o extrato
 * (reclamação do Kauan, 29/jul/2026).
 *
 * Config por polo em `tenant_integrations.<gateway>.fees`, percentuais:
 *   { "credito_avista": 1.32, "credito_parcelado": 3.19, "debito": 0.99, "pix": 0.99,
 *     "fixed_cents": 0 }
 *
 * REGRA DELIBERADA: modalidade sem taxa configurada devolve `null` — NUNCA um palpite. Taxa
 * chutada vira número errado no financeiro do cliente, que é pior que campo vazio. Com `null`
 * a conta a receber é criada e fica EM ABERTO para a baixa manual/pelo extrato.
 */
export type GatewayFeeConfig = {
  credito_avista?: number
  credito_parcelado?: number
  debito?: number
  pix?: number
  fixed_cents?: number
}

export type FeeQuote = { feeCents: number; netCents: number; pct: number; modality: string }

/** Modalidade da venda a partir do método + parcelas. */
export function feeModality(method: string | null | undefined, installments = 1): string {
  const m = String(method ?? '').trim().toLowerCase()
  if (m === 'pix') return 'pix'
  if (m === 'debit' || m === 'debito') return 'debito'
  if (m !== 'card' && m !== 'credit_card' && m !== 'cartao') return ''
  return Math.max(1, Math.round(Number(installments) || 1)) > 1 ? 'credito_parcelado' : 'credito_avista'
}

/**
 * Taxa em centavos para uma venda. `null` = não dá pra afirmar (modalidade desconhecida ou
 * sem taxa cadastrada) — o chamador NÃO deve baixar a conta sozinho nesse caso.
 */
export async function quoteGatewayFee(
  admin: SupabaseClient,
  tenantId: string,
  gateway: 'rede' | 'asaas',
  args: { method?: string | null; installments?: number; amountCents: number },
): Promise<FeeQuote | null> {
  const amountCents = Math.round(Number(args.amountCents) || 0)
  if (amountCents <= 0) return null
  const modality = feeModality(args.method, args.installments ?? 1)
  if (!modality) return null

  const { data } = await admin.from('tenant_integrations').select(gateway).eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as Record<string, unknown> | null)?.[gateway] ?? {}) as Record<string, unknown>
  const fees = (cfg.fees ?? {}) as GatewayFeeConfig
  const pct = Number(fees[modality as keyof GatewayFeeConfig])
  if (!Number.isFinite(pct) || pct < 0) return null

  const fixed = Math.max(0, Math.round(Number(fees.fixed_cents) || 0))
  const feeCents = Math.round((amountCents * pct) / 100) + fixed
  // Sanidade: taxa maior que o próprio valor (config errada) não pode virar líquido negativo.
  if (feeCents >= amountCents) return null
  return { feeCents, netCents: amountCents - feeCents, pct, modality }
}
