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

// ─── Geração de etiqueta (Melhor Envio) via edge crm-frete-ship ───────────────

export type MeAddress = {
  name?: string
  phone?: string
  email?: string
  document?: string
  companyDocument?: string
  stateRegister?: string
  address?: string
  number?: string
  complement?: string
  district?: string
  city?: string
  stateAbbr?: string
  postalCode?: string
  note?: string
}

export type ShipConfig = {
  connected: boolean
  sandbox: boolean | null
  sender: MeAddress
  senderMissing: string[]
}

export type ShipProduct = { name: string; quantity: number; unitaryValueCents: number }

export type ShipResult = {
  ok: boolean
  finalized: boolean
  cartId: string | null
  tracking: string | null
  protocol: string | null
  printUrl: string | null
  stage: string
}

async function shipInvoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.functions.invoke('crm-frete-ship', { body })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: unknown }).context as { json?: () => Promise<unknown>; clone?: () => Response } | undefined
    try {
      if (ctx && typeof ctx.json === 'function') {
        const b = (await (ctx.clone ? ctx.clone() : (ctx as unknown as Response)).json()) as {
          message?: string
          error?: string
          missing?: string[]
        }
        msg = b?.message || (b?.missing ? `Faltam dados: ${b.missing.join(', ')}` : '') || b?.error || msg
      }
    } catch {
      // ignore
    }
    throw new Error(String(msg || 'Falha no envio'))
  }
  return (data ?? {}) as Record<string, unknown>
}

export async function getShipConfig(): Promise<ShipConfig> {
  const p = await shipInvoke({ action: 'get_config' })
  return {
    connected: p.connected === true,
    sandbox: typeof p.sandbox === 'boolean' ? p.sandbox : null,
    sender: (p.sender ?? {}) as MeAddress,
    senderMissing: Array.isArray(p.senderMissing) ? (p.senderMissing as string[]) : [],
  }
}

export async function saveShipSender(sender: MeAddress): Promise<ShipConfig> {
  const p = await shipInvoke({ action: 'set_sender', sender })
  return {
    connected: true,
    sandbox: null,
    sender: (p.sender ?? {}) as MeAddress,
    senderMissing: Array.isArray(p.senderMissing) ? (p.senderMissing as string[]) : [],
  }
}

export async function createShipment(args: {
  leadId?: string
  serviceId: number
  to: MeAddress
  products: ShipProduct[]
  box?: { weightKg?: number; lengthCm?: number; widthCm?: number; heightCm?: number }
  insuranceCents?: number
  finalize?: boolean
  nonCommercial?: boolean
}): Promise<ShipResult> {
  const p = await shipInvoke({ action: 'create', ...args })
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha ao gerar envio'))
  return {
    ok: true,
    finalized: p.finalized === true,
    cartId: (p.cartId as string | null) ?? null,
    tracking: (p.tracking as string | null) ?? null,
    protocol: (p.protocol as string | null) ?? null,
    printUrl: (p.printUrl as string | null) ?? null,
    stage: String(p.stage ?? ''),
  }
}
