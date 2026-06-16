import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Melhor Envio — agregador que cota Correios (PAC/SEDEX) e transportadoras SEM exigir
 * contrato próprio. Autenticação por OAuth2 (authorization_code + refresh), igual ao Bling.
 *
 * O token (access + refresh) fica em `tenant_integrations.melhorenvio` por polo (tenant_id),
 * então é UM só ponto de verdade no banco — consumido tanto pelo CRM (bot de vendas) quanto
 * pelo site oficial do Tricopill (mesmo Supabase).
 *
 * Fluxo de conexão (uma vez, por admin): edge `crm-frete-oauth` → autoriza no painel ME →
 * callback troca o `code` por tokens e persiste aqui.
 *
 * Secrets/env (NUNCA hardcode credenciais):
 *   MELHOR_ENVIO_CLIENT_ID       Client ID do app (painel ME → Aplicativos)
 *   MELHOR_ENVIO_CLIENT_SECRET   Client Secret do app
 *   MELHOR_ENVIO_SANDBOX         'true' → sandbox.melhorenvio.com.br; senão produção
 *   MELHOR_ENVIO_REDIRECT_URI    Deve bater EXATO com a "URL de redirecionamento" do app
 *   MELHOR_ENVIO_SCOPES          Escopos (default cobre cotação + futura geração de etiqueta)
 *   MELHOR_ENVIO_USER_AGENT      Identificação OBRIGATÓRIA pela ME: "App Nome (email@dominio)"
 *   MELHOR_ENVIO_FROM_CEP        CEP de origem (default 87014180 — Maringá)
 *   MELHOR_ENVIO_SERVICES        IDs de serviço (default "1,2" = Correios PAC e SEDEX)
 *   FRETE_BOX_WEIGHT_KG / _LENGTH_CM / _WIDTH_CM / _HEIGHT_CM   Caixa padrão (override no body)
 *   FRETE_INSURANCE_CENTS        Valor segurado opcional em centavos (default 0)
 */

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '')

const DEFAULT_SCOPES =
  'shipping-calculate shipping-companies cart-read cart-write shipping-checkout ' +
  'shipping-generate shipping-preview shipping-print shipping-cancel shipping-tracking ' +
  'ecommerce-shipping orders-read products-read'

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

export type FreteBox = {
  weightKg?: number
  lengthCm?: number
  widthCm?: number
  heightCm?: number
}

function envNum(key: string, fallback: number): number {
  const raw = (Deno.env.get(key) ?? '').trim().replace(',', '.')
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// ─── OAuth2: configuração do app ────────────────────────────────────────────

export function melhorEnvioSandbox(): boolean {
  return (Deno.env.get('MELHOR_ENVIO_SANDBOX') ?? '').trim().toLowerCase() === 'true'
}

export function melhorEnvioBaseUrl(): string {
  return melhorEnvioSandbox() ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br'
}

export function meClientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId = (Deno.env.get('MELHOR_ENVIO_CLIENT_ID') ?? '').trim()
  const clientSecret = (Deno.env.get('MELHOR_ENVIO_CLIENT_SECRET') ?? '').trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function meRedirectUri(): string {
  return (Deno.env.get('MELHOR_ENVIO_REDIRECT_URI') ?? '').trim()
}

export function meUserAgent(): string {
  return (Deno.env.get('MELHOR_ENVIO_USER_AGENT') ?? '').trim() ||
    'Instituto Lorena CRM (contato@institutolorena.com.br)'
}

/** True quando o APP (client_id/secret) está configurado — gate barato pré-cotação. */
export function melhorEnvioConfigured(): boolean {
  return meClientCreds() != null
}

/** URL de autorização do ME (passo 1 do OAuth). */
export function meAuthorizeUrl(state: string): string {
  const creds = meClientCreds()
  if (!creds) throw new Error('melhor_envio_client_not_configured')
  const scopes = (Deno.env.get('MELHOR_ENVIO_SCOPES') ?? '').trim() || DEFAULT_SCOPES
  const u = new URL(`${melhorEnvioBaseUrl()}/oauth/authorize`)
  u.searchParams.set('client_id', creds.clientId)
  u.searchParams.set('redirect_uri', meRedirectUri())
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('state', state)
  u.searchParams.set('scope', scopes)
  return u.toString()
}

type MeTokenResponse = {
  token_type?: string
  expires_in?: number
  access_token?: string
  refresh_token?: string
  error?: string
  message?: string
  hint?: string
}

async function postToken(body: Record<string, string>): Promise<MeTokenResponse> {
  const creds = meClientCreds()
  if (!creds) throw new Error('melhor_envio_client_not_configured')
  const res = await fetch(`${melhorEnvioBaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': meUserAgent(),
    },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, ...body }),
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  let parsed: MeTokenResponse = {}
  try {
    parsed = text ? (JSON.parse(text) as MeTokenResponse) : {}
  } catch {
    parsed = {}
  }
  if (!res.ok || !parsed.access_token) {
    throw new Error(`melhor_envio_token_${res.status}: ${text.slice(0, 300)}`)
  }
  return parsed
}

async function persistMeTokens(
  admin: SupabaseClient,
  tenantId: string,
  tok: MeTokenResponse,
): Promise<void> {
  // expires_in costuma ser ~30 dias; guarda margem de 1h.
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in ?? 2592000) - 3600) * 1000).toISOString()
  const { data } = await admin
    .from('tenant_integrations')
    .select('melhorenvio')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const current = ((data as { melhorenvio?: Record<string, unknown> } | null)?.melhorenvio ?? {}) as Record<
    string,
    unknown
  >
  const next = {
    ...current,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? current.refresh_token,
    expires_at: expiresAt,
    sandbox: melhorEnvioSandbox(),
    connected_at: current.connected_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  await admin.from('tenant_integrations').upsert({ tenant_id: tenantId, melhorenvio: next })
}

/** Troca o authorization_code por tokens e persiste no polo. */
export async function meExchangeCode(admin: SupabaseClient, tenantId: string, code: string): Promise<void> {
  const tok = await postToken({
    grant_type: 'authorization_code',
    redirect_uri: meRedirectUri(),
    code,
  })
  await persistMeTokens(admin, tenantId, tok)
}

/** Access_token válido (renova via refresh_token se expirado). null = não conectado/indisponível. */
export async function getValidMeToken(admin: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data } = await admin
    .from('tenant_integrations')
    .select('melhorenvio')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const cfg = ((data as { melhorenvio?: Record<string, unknown> } | null)?.melhorenvio ?? {}) as Record<
    string,
    unknown
  >
  const access = typeof cfg.access_token === 'string' ? cfg.access_token : ''
  const refresh = typeof cfg.refresh_token === 'string' ? cfg.refresh_token : ''
  const expiresAt = typeof cfg.expires_at === 'string' ? Date.parse(cfg.expires_at) : 0

  if (access && expiresAt && Date.now() < expiresAt) return access
  if (!refresh) return access || null

  // Expirado: renova. Best-effort — falha de refresh NÃO derruba o chamador (bot/site):
  // só significa "ME indisponível"; devolve null e loga.
  try {
    const scopes = (Deno.env.get('MELHOR_ENVIO_SCOPES') ?? '').trim() || DEFAULT_SCOPES
    const tok = await postToken({ grant_type: 'refresh_token', refresh_token: refresh, scope: scopes })
    await persistMeTokens(admin, tenantId, tok)
    return tok.access_token ?? null
  } catch (e) {
    console.warn('[melhor-envio] refresh token falhou:', e instanceof Error ? e.message : String(e))
    return null
  }
}

export function meConnectionStatus(cfg: Record<string, unknown> | null | undefined): {
  connected: boolean
  connectedAt: string | null
  sandbox: boolean | null
  expiresAt: string | null
} {
  const c = (cfg ?? {}) as Record<string, unknown>
  return {
    connected: typeof c.refresh_token === 'string' && c.refresh_token.length > 0,
    connectedAt: typeof c.connected_at === 'string' ? c.connected_at : null,
    sandbox: typeof c.sandbox === 'boolean' ? c.sandbox : null,
    expiresAt: typeof c.expires_at === 'string' ? c.expires_at : null,
  }
}

// ─── Cotação ────────────────────────────────────────────────────────────────

export async function quoteFreteMelhorEnvio(
  admin: SupabaseClient,
  tenantId: string,
  rawToCep: string,
  opts?: { insuranceCents?: number; servicesCsv?: string; box?: FreteBox },
): Promise<FreteQuote> {
  const toCep = onlyDigits(rawToCep)
  const fromCep = onlyDigits(Deno.env.get('MELHOR_ENVIO_FROM_CEP') || '87014180')
  const services = (opts?.servicesCsv ?? Deno.env.get('MELHOR_ENVIO_SERVICES') ?? '1,2').trim()

  const empty = (debug: string): FreteQuote => ({ ok: false, fromCep, toCep, options: [], debug })

  if (toCep.length !== 8) return empty('invalid_to_cep')
  if (fromCep.length !== 8) return empty('invalid_from_cep')
  if (!melhorEnvioConfigured()) return empty('client_not_configured')

  const token = await getValidMeToken(admin, tenantId)
  if (!token) return empty('not_connected')

  const insuranceReais = Math.max(0, (opts?.insuranceCents ?? envNum('FRETE_INSURANCE_CENTS', 0)) / 100)
  const box = opts?.box ?? {}
  const body = {
    from: { postal_code: fromCep },
    to: { postal_code: toCep },
    package: {
      weight: box.weightKg && box.weightKg > 0 ? box.weightKg : envNum('FRETE_BOX_WEIGHT_KG', 0.3),
      length: box.lengthCm && box.lengthCm > 0 ? box.lengthCm : envNum('FRETE_BOX_LENGTH_CM', 20),
      width: box.widthCm && box.widthCm > 0 ? box.widthCm : envNum('FRETE_BOX_WIDTH_CM', 20),
      height: box.heightCm && box.heightCm > 0 ? box.heightCm : envNum('FRETE_BOX_HEIGHT_CM', 10),
    },
    options: { insurance_value: insuranceReais, receipt: false, own_hand: false },
    services,
  }

  try {
    const res = await fetch(`${melhorEnvioBaseUrl()}/api/v2/me/shipment/calculate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        // A Melhor Envio REJEITA requisições sem User-Agent identificando o app + e-mail.
        'User-Agent': meUserAgent(),
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
