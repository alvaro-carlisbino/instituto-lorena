// Cotação de frete via Melhor Envio (agregador — cota Correios PAC/SEDEX e transportadoras
// SEM exigir contrato próprio com os Correios). Usado pelo bot de vendas (Tricopill) para
// cotar o frete REAL pelo CEP do cliente, no lugar do valor manual por cidade do prompt.
//
// Config por env/secret (NUNCA hardcode token/medidas no código):
//   MELHOR_ENVIO_TOKEN       Bearer token (painel Melhor Envio → app/token com escopo shipping-calculate)
//   MELHOR_ENVIO_SANDBOX     'true' usa sandbox.melhorenvio.com.br; qualquer outra coisa = produção
//   MELHOR_ENVIO_FROM_CEP    CEP de origem (default 87014180 — clínica Maringá)
//   MELHOR_ENVIO_USER_AGENT  Identificação OBRIGATÓRIA pela ME: "App Nome (email@dominio)"
//   MELHOR_ENVIO_SERVICES    IDs de serviço (default "1,2" = Correios PAC e SEDEX)
//   FRETE_BOX_WEIGHT_KG      Peso da caixa padrão (kg)       — caixa única p/ todos os kits
//   FRETE_BOX_LENGTH_CM      Comprimento da caixa (cm)
//   FRETE_BOX_WIDTH_CM       Largura da caixa (cm)
//   FRETE_BOX_HEIGHT_CM      Altura da caixa (cm)
//   FRETE_INSURANCE_CENTS    Valor segurado opcional em centavos (default 0)

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '')

export type FreteOption = {
  /** Nome do serviço normalizado: 'PAC', 'SEDEX', etc. */
  service: string
  serviceId: number
  company: string
  priceCents: number
  deliveryDays: number | null
}

export type FreteQuote = {
  ok: boolean
  fromCep: string
  toCep: string
  options: FreteOption[]
  debug: string
}

function envNum(key: string, fallback: number): number {
  const raw = (Deno.env.get(key) ?? '').trim().replace(',', '.')
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** True quando há token configurado (≥20 chars) — usado pra pular a cotação sem quebrar o fluxo. */
export function melhorEnvioConfigured(): boolean {
  return (Deno.env.get('MELHOR_ENVIO_TOKEN') ?? '').trim().length >= 20
}

export async function quoteFreteMelhorEnvio(
  rawToCep: string,
  opts?: { insuranceCents?: number; servicesCsv?: string },
): Promise<FreteQuote> {
  const toCep = onlyDigits(rawToCep)
  const fromCep = onlyDigits(Deno.env.get('MELHOR_ENVIO_FROM_CEP') || '87014180')
  const base = (Deno.env.get('MELHOR_ENVIO_SANDBOX') ?? '').trim().toLowerCase() === 'true'
    ? 'https://sandbox.melhorenvio.com.br'
    : 'https://melhorenvio.com.br'
  const token = (Deno.env.get('MELHOR_ENVIO_TOKEN') ?? '').trim()
  const userAgent = (Deno.env.get('MELHOR_ENVIO_USER_AGENT') ?? '').trim() ||
    'Instituto Lorena CRM (contato@institutolorena.com.br)'
  const services = (opts?.servicesCsv ?? Deno.env.get('MELHOR_ENVIO_SERVICES') ?? '1,2').trim()

  const empty = (debug: string): FreteQuote => ({ ok: false, fromCep, toCep, options: [], debug })

  if (token.length < 20) return empty('no_token')
  if (toCep.length !== 8) return empty('invalid_to_cep')
  if (fromCep.length !== 8) return empty('invalid_from_cep')

  const insuranceReais = Math.max(0, (opts?.insuranceCents ?? envNum('FRETE_INSURANCE_CENTS', 0)) / 100)
  const body = {
    from: { postal_code: fromCep },
    to: { postal_code: toCep },
    package: {
      weight: envNum('FRETE_BOX_WEIGHT_KG', 0.5),
      length: envNum('FRETE_BOX_LENGTH_CM', 20),
      width: envNum('FRETE_BOX_WIDTH_CM', 15),
      height: envNum('FRETE_BOX_HEIGHT_CM', 10),
    },
    options: { insurance_value: insuranceReais, receipt: false, own_hand: false },
    services,
  }

  try {
    const res = await fetch(`${base}/api/v2/me/shipment/calculate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        // A Melhor Envio REJEITA requisições sem User-Agent identificando o app + e-mail.
        'User-Agent': userAgent,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    if (!res.ok) return empty(`http_${res.status}:${text.slice(0, 160)}`)
    let arr: unknown
    try {
      arr = JSON.parse(text)
    } catch {
      return empty(`bad_json:${text.slice(0, 120)}`)
    }
    if (!Array.isArray(arr)) return empty(`not_array:${text.slice(0, 120)}`)

    const options: FreteOption[] = []
    for (const item of arr as Array<Record<string, unknown>>) {
      // A ME devolve itens com {error:"..."} quando o serviço não atende o CEP/medidas.
      if (!item || item.error) continue
      const priceRaw = String(item.price ?? item.custom_price ?? '')
      const price = Number(priceRaw.replace(',', '.'))
      if (!Number.isFinite(price) || price <= 0) continue
      const name = String(item.name ?? '').trim()
      const company = String((item.company as Record<string, unknown> | undefined)?.name ?? 'Correios')
      const dtRaw = item.delivery_time != null ? Number(item.delivery_time) : NaN
      options.push({
        service: name || `servico_${item.id}`,
        serviceId: Number(item.id ?? 0),
        company,
        priceCents: Math.round(price * 100),
        deliveryDays: Number.isFinite(dtRaw) ? dtRaw : null,
      })
    }
    if (options.length === 0) return empty(`no_options:${text.slice(0, 160)}`)
    options.sort((a, b) => a.priceCents - b.priceCents)
    return { ok: true, fromCep, toCep, options, debug: `ok_${options.length}` }
  } catch (e) {
    return empty(`exception:${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`)
  }
}

/** Acha a opção de um serviço pelo nome ('PAC'/'SEDEX', case-insensitive). */
export function pickFreteOption(q: FreteQuote, service: string): FreteOption | null {
  const s = service.trim().toLowerCase()
  if (!s) return null
  return (
    q.options.find((o) => o.service.toLowerCase() === s) ??
    q.options.find((o) => o.service.toLowerCase().includes(s)) ??
    null
  )
}
