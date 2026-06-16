import { supabase } from '@/lib/supabaseClient'

export type FreteOption = {
  service: string
  company: string
  priceReais: number
  priceCents: number
  deliveryDays: number | null
  /** True = entrega interna (praça local, ex.: Maringá), não Correios. */
  internal: boolean
}

export type FreteQuoteResult = {
  ok: boolean
  fromCep: string
  toCep: string
  options: FreteOption[]
  debug: string
}

/**
 * Cota o frete real (Melhor Envio: Correios PAC/SEDEX) por CEP, via edge crm-frete-quote.
 * Maringá volta como "Entrega interna" (praça local). O endpoint responde sempre 200 com
 * o flag `ok` — então tratamos "sem cotação" pela flag, não por erro HTTP.
 */
export async function quoteFrete(args: {
  toCep: string
  tenantId?: string
  weight?: number
  length?: number
  width?: number
  height?: number
}): Promise<FreteQuoteResult> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const body: Record<string, unknown> = { toCep: args.toCep.replace(/\D/g, '') }
  if (args.tenantId) body.tenantId = args.tenantId
  if (args.weight) body.weight = args.weight
  if (args.length) body.length = args.length
  if (args.width) body.width = args.width
  if (args.height) body.height = args.height

  const { data, error } = await supabase.functions.invoke('crm-frete-quote', { body })
  if (error) throw new Error(error.message || 'Falha ao cotar frete')

  const p = (data ?? {}) as Record<string, unknown>
  const options: FreteOption[] = Array.isArray(p.options)
    ? (p.options as Array<Record<string, unknown>>).map((o) => ({
        service: String(o.service ?? ''),
        company: String(o.company ?? ''),
        priceReais: Number(o.price_reais ?? 0),
        priceCents: Number(o.price_cents ?? 0),
        deliveryDays: o.delivery_days == null ? null : Number(o.delivery_days),
        internal: o.internal === true,
      }))
    : []
  return {
    ok: p.ok === true,
    fromCep: String(p.from_cep ?? ''),
    toCep: String(p.to_cep ?? ''),
    options,
    debug: String(p.debug ?? ''),
  }
}
