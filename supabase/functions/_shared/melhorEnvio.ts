import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { isMaringa, resolveCepBrasil } from './cep.ts'

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
  /** Nome do serviço normalizado: 'PAC', 'SEDEX', 'Entrega interna', etc. */
  service: string
  serviceId: number
  company: string
  priceCents: number
  deliveryDays: number | null
  /** True = entrega interna (praça local, ex.: Maringá) — não é Correios. */
  internal?: boolean
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

/**
 * Caixa REAL por kit do Tricopill (peso + dimensões), calibrada com a cotação real dos
 * Correios (Melhor Envio prod, 16/jun): 1 frasco ≈ 0,3 kg; 4 frascos ≈ 0,65 kg; 5 ≈ 0,9 kg.
 * Sem isto a cotação usava SEMPRE a caixa padrão (0,3 kg = 1 frasco), cobrando frete de
 * 1 frasco num pedido de 4 (ex.: R$31,96 quando o real é R$37,49). O frete agora escala
 * com o kit, tanto no que a IA COBRA (resolveFreightCents) quanto no que ela COTA na conversa.
 */
const KIT_BOXES: Record<string, FreteBox> = {
  '1_mes': { weightKg: 0.3, lengthCm: 16, widthCm: 11, heightCm: 11 },
  '3_meses': { weightKg: 0.75, lengthCm: 20, widthCm: 15, heightCm: 12 },
  '5_meses': { weightKg: 0.95, lengthCm: 22, widthCm: 16, heightCm: 13 },
}

/** Normaliza variações de kit ('3 meses', '3+1', 'kit3', '4 frascos') para a chave canônica. */
function normalizeKitKeyLocal(raw: unknown): string | null {
  const s = String(raw ?? '').toLowerCase().replace(/[^0-9a-z]/g, '')
  if (!s) return null
  if (s.includes('5')) return '5_meses'
  if (s.includes('4') || s.includes('3')) return '3_meses' // 3+1 = 4 frascos
  if (s.includes('1')) return '1_mes'
  return null
}

/** Caixa do kit (peso/dimensões reais). null quando o kit é desconhecido (cai na caixa padrão). */
export function boxForKit(kitRaw: unknown): FreteBox | null {
  const key = normalizeKitKeyLocal(kitRaw)
  return key ? KIT_BOXES[key] : null
}

/** Chaves de kit conhecidas (p/ cotar por kit na conversa). */
export const KIT_KEYS = Object.keys(KIT_BOXES)

/**
 * Margem de segurança no frete COBRADO do cliente (política "nunca cobrar menos que o custo").
 * Aplica `FRETE_MARKUP_PCT` (default 10%) e arredonda PRA CIMA até `FRETE_ROUND_CENTS`
 * (default 100 = próximo R$1). Ex.: custo R$37,49 → ×1,10 = 41,24 → arredonda → R$42,00.
 * Só vale p/ Correios/transportadora — NÃO mexe na entrega interna de Maringá (taxa local fixa).
 * Usado no que a IA COBRA (resolveFreightCents) e no que ela MOSTRA (snapshot.frete).
 * A etiqueta em si paga o custo real (sem markup) — isto é só o que o cliente paga.
 */
export function applyFreightMarkup(rawCents: number, opts?: { internal?: boolean }): number {
  if (opts?.internal) return rawCents
  if (!Number.isFinite(rawCents) || rawCents <= 0) return rawCents
  const pctRaw = Number((Deno.env.get('FRETE_MARKUP_PCT') ?? '').trim().replace(',', '.'))
  const pct = Number.isFinite(pctRaw) && pctRaw >= 0 ? pctRaw : 0.1
  const roundRaw = Number((Deno.env.get('FRETE_ROUND_CENTS') ?? '').trim())
  const round = Number.isFinite(roundRaw) && roundRaw >= 1 ? Math.round(roundRaw) : 100
  const marked = rawCents * (1 + pct)
  return Math.ceil(marked / round) * round
}

function envNum(key: string, fallback: number): number {
  const raw = (Deno.env.get(key) ?? '').trim().replace(',', '.')
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Valor da entrega interna de Maringá em centavos (default R$ 15,00; aceita 0 = grátis). */
function maringaCents(): number {
  const raw = (Deno.env.get('FRETE_MARINGA_CENTS') ?? '').trim()
  const n = Number(raw)
  return raw !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 1500
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
  opts?: {
    insuranceCents?: number
    servicesCsv?: string
    box?: FreteBox
    /** Cidade já resolvida (evita 2ª chamada ViaCEP quando o caller já tem). */
    cityInfo?: { localidade?: string; uf?: string }
  },
): Promise<FreteQuote> {
  const toCep = onlyDigits(rawToCep)
  const fromCep = onlyDigits(Deno.env.get('MELHOR_ENVIO_FROM_CEP') || '87014180')
  const services = (opts?.servicesCsv ?? Deno.env.get('MELHOR_ENVIO_SERVICES') ?? '1,2').trim()

  const empty = (debug: string): FreteQuote => ({ ok: false, fromCep, toCep, options: [], debug })

  if (toCep.length !== 8) return empty('invalid_to_cep')
  if (fromCep.length !== 8) return empty('invalid_from_cep')

  // Maringá = praça local: entrega INTERNA (não cota Correios). Vale mesmo sem ME conectado.
  const cityInfo = opts?.cityInfo ?? (await resolveCepBrasil(toCep))
  if (isMaringa(cityInfo)) {
    return {
      ok: true,
      fromCep,
      toCep,
      options: [
        { service: 'Entrega interna', serviceId: 0, company: 'Maringá (local)', priceCents: maringaCents(), deliveryDays: null, internal: true },
      ],
      debug: 'maringa_interno',
    }
  }

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

// ─── Geração de etiqueta (carrinho → compra → etiqueta → impressão) ───────────
//
// Fluxo oficial da Melhor Envio para emitir uma etiqueta:
//   1) POST /me/cart            adiciona o frete ao carrinho (from/to/produtos/volume) → cartId
//   2) POST /me/shipment/checkout   COMPRA (debita saldo da carteira ME) — gasta dinheiro real
//   3) POST /me/shipment/generate   gera a etiqueta (emite o código de rastreio nos Correios)
//   4) POST /me/shipment/print      devolve a URL do PDF para impressão
//
// `finalize=false` (default) para SÓ no passo 1: o operador revisa e paga no painel ME.
// IDs de serviço Correios: 1 = PAC, 2 = SEDEX.

const onlyDigitsStr = (s: unknown) => String(s ?? '').replace(/\D/g, '')

export type MeAddress = {
  name?: string
  phone?: string
  email?: string
  document?: string // CPF
  companyDocument?: string // CNPJ
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

export type MeProduct = { name: string; quantity: number; unitaryValueCents: number }

export type MeShipmentInput = {
  to: MeAddress
  /** Remetente; se ausente, usa o configurado no polo (tenant_integrations.melhorenvio.sender) / env. */
  from?: MeAddress
  serviceId: number
  products: MeProduct[]
  box?: FreteBox
  insuranceCents?: number
  /** true = compra + gera etiqueta + imprime; false = só adiciona ao carrinho. */
  finalize?: boolean
  /** Declaração não-comercial (sem NF) — default true para venda direta. */
  nonCommercial?: boolean
}

export type MeShipmentResult = {
  ok: boolean
  cartId: string | null
  finalized: boolean
  tracking: string | null
  protocol: string | null
  printUrl: string | null
  /** Etapa em que parou: 'cart' | 'checkout' | 'generate' | 'print'. */
  stage: string
  error?: string
}

/** Remetente persistido por polo (tenant_integrations.melhorenvio.sender), com fallback em env. */
export async function getMeSender(admin: SupabaseClient, tenantId: string): Promise<MeAddress> {
  let saved: Record<string, unknown> = {}
  try {
    const { data } = await admin
      .from('tenant_integrations')
      .select('melhorenvio')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const cfg = ((data as { melhorenvio?: Record<string, unknown> } | null)?.melhorenvio ?? {}) as Record<string, unknown>
    if (cfg.sender && typeof cfg.sender === 'object') saved = cfg.sender as Record<string, unknown>
  } catch {
    // best-effort
  }
  const pick = (k: string, env: string, fb = '') =>
    String((saved[k] as string | undefined) ?? (Deno.env.get(env) ?? '') ?? fb).trim()
  return {
    name: pick('name', 'MELHOR_ENVIO_FROM_NAME', 'Instituto Lorena'),
    phone: pick('phone', 'MELHOR_ENVIO_FROM_PHONE'),
    email: pick('email', 'MELHOR_ENVIO_FROM_EMAIL'),
    document: pick('document', 'MELHOR_ENVIO_FROM_DOCUMENT'),
    companyDocument: pick('companyDocument', 'MELHOR_ENVIO_FROM_CNPJ'),
    address: pick('address', 'MELHOR_ENVIO_FROM_ADDRESS'),
    number: pick('number', 'MELHOR_ENVIO_FROM_NUMBER'),
    complement: pick('complement', 'MELHOR_ENVIO_FROM_COMPLEMENT'),
    district: pick('district', 'MELHOR_ENVIO_FROM_DISTRICT'),
    city: pick('city', 'MELHOR_ENVIO_FROM_CITY', 'Maringá'),
    stateAbbr: pick('stateAbbr', 'MELHOR_ENVIO_FROM_STATE', 'PR'),
    postalCode: onlyDigitsStr(pick('postalCode', 'MELHOR_ENVIO_FROM_CEP', '87014180')),
  }
}

/** Salva/atualiza o remetente do polo (merge no objeto melhorenvio, preserva os tokens). */
export async function setMeSender(admin: SupabaseClient, tenantId: string, sender: MeAddress): Promise<void> {
  const { data } = await admin
    .from('tenant_integrations')
    .select('melhorenvio')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const current = ((data as { melhorenvio?: Record<string, unknown> } | null)?.melhorenvio ?? {}) as Record<string, unknown>
  const clean: MeAddress = { ...sender, postalCode: onlyDigitsStr(sender.postalCode), phone: onlyDigitsStr(sender.phone) }
  await admin.from('tenant_integrations').upsert({
    tenant_id: tenantId,
    melhorenvio: { ...current, sender: clean, updated_at: new Date().toISOString() },
  })
}

/** Valida que um remetente tem os campos mínimos exigidos pela ME para emitir etiqueta. */
export function meSenderMissing(s: MeAddress): string[] {
  const miss: string[] = []
  if (!s.name) miss.push('nome')
  if (!s.phone) miss.push('telefone')
  if (!s.document && !s.companyDocument) miss.push('CPF ou CNPJ')
  if (!s.address) miss.push('rua')
  if (!s.number) miss.push('número')
  if (!s.district) miss.push('bairro')
  if (!s.city) miss.push('cidade')
  if (!s.stateAbbr) miss.push('UF')
  if (onlyDigitsStr(s.postalCode).length !== 8) miss.push('CEP')
  return miss
}

function meAddressToApi(a: MeAddress): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: a.name ?? '',
    phone: onlyDigitsStr(a.phone),
    email: a.email ?? '',
    address: a.address ?? '',
    number: a.number ?? 's/n',
    complement: a.complement ?? '',
    district: a.district ?? '',
    city: a.city ?? '',
    state_abbr: (a.stateAbbr ?? '').toUpperCase().slice(0, 2),
    country_id: 'BR',
    postal_code: onlyDigitsStr(a.postalCode),
    note: a.note ?? '',
  }
  if (a.document) out.document = onlyDigitsStr(a.document)
  if (a.companyDocument) out.company_document = onlyDigitsStr(a.companyDocument)
  if (a.stateRegister) out.state_register = a.stateRegister
  return out
}

async function meApiPost(token: string, path: string, body: unknown): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const res = await fetch(`${melhorEnvioBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': meUserAgent(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  return { ok: res.ok, status: res.status, data, text }
}

/**
 * Emite (ou só carrinho) uma etiqueta na Melhor Envio. Conta única do polo (token OAuth no banco).
 * Devolve o que conseguiu até parar; em erro, `stage` indica a etapa e `error` o motivo.
 */
export async function createMeShipment(
  admin: SupabaseClient,
  tenantId: string,
  input: MeShipmentInput,
): Promise<MeShipmentResult> {
  const fail = (stage: string, error: string, partial?: Partial<MeShipmentResult>): MeShipmentResult => ({
    ok: false, cartId: null, finalized: false, tracking: null, protocol: null, printUrl: null, stage, error, ...partial,
  })

  if (!melhorEnvioConfigured()) return fail('cart', 'client_not_configured')
  const token = await getValidMeToken(admin, tenantId)
  if (!token) return fail('cart', 'not_connected')

  const from = input.from ?? (await getMeSender(admin, tenantId))
  const missingFrom = meSenderMissing(from)
  if (missingFrom.length) return fail('cart', `remetente_incompleto: ${missingFrom.join(', ')}`)

  const box = input.box ?? {}
  const insuranceReais = Math.max(0, (input.insuranceCents ?? 0) / 100)
  const cartBody = {
    service: input.serviceId,
    from: meAddressToApi(from),
    to: meAddressToApi(input.to),
    products: input.products.map((p) => ({
      name: p.name.slice(0, 120),
      quantity: String(Math.max(1, Math.round(p.quantity))),
      unitary_value: (Math.max(0, p.unitaryValueCents) / 100).toFixed(2),
    })),
    volumes: [
      {
        height: box.heightCm && box.heightCm > 0 ? box.heightCm : envNum('FRETE_BOX_HEIGHT_CM', 10),
        width: box.widthCm && box.widthCm > 0 ? box.widthCm : envNum('FRETE_BOX_WIDTH_CM', 20),
        length: box.lengthCm && box.lengthCm > 0 ? box.lengthCm : envNum('FRETE_BOX_LENGTH_CM', 20),
        weight: box.weightKg && box.weightKg > 0 ? box.weightKg : envNum('FRETE_BOX_WEIGHT_KG', 0.3),
      },
    ],
    options: {
      insurance_value: insuranceReais,
      receipt: false,
      own_hand: false,
      reverse: false,
      non_commercial: input.nonCommercial !== false,
    },
  }

  // 1) Carrinho
  const cart = await meApiPost(token, '/api/v2/me/cart', cartBody)
  if (!cart.ok || !cart.data?.id) {
    const detail = cart.data?.message || cart.data?.errors ? JSON.stringify(cart.data).slice(0, 300) : cart.text.slice(0, 300)
    return fail('cart', `http_${cart.status}: ${detail}`)
  }
  const cartId = String(cart.data.id)
  const protocol = cart.data.protocol ? String(cart.data.protocol) : null

  if (!input.finalize) {
    return { ok: true, cartId, finalized: false, tracking: null, protocol, printUrl: null, stage: 'cart' }
  }

  // 2) Compra (debita saldo da carteira ME)
  const checkout = await meApiPost(token, '/api/v2/me/shipment/checkout', { orders: [cartId] })
  if (!checkout.ok) {
    return fail('checkout', `http_${checkout.status}: ${checkout.text.slice(0, 300)}`, { cartId, protocol })
  }

  // 3) Gera etiqueta (emite rastreio)
  const gen = await meApiPost(token, '/api/v2/me/shipment/generate', { orders: [cartId] })
  if (!gen.ok) {
    return fail('generate', `http_${gen.status}: ${gen.text.slice(0, 300)}`, { cartId, protocol, finalized: true })
  }
  // A resposta de generate é { "<cartId>": { tracking, ... } }
  let tracking: string | null = null
  try {
    const entry = gen.data?.[cartId] ?? Object.values(gen.data ?? {})[0]
    if (entry && typeof entry === 'object') tracking = (entry as Record<string, unknown>).tracking ? String((entry as Record<string, unknown>).tracking) : null
  } catch {
    // ignore
  }

  // 4) Impressão (URL do PDF)
  let printUrl: string | null = null
  const print = await meApiPost(token, '/api/v2/me/shipment/print', { mode: 'private', orders: [cartId] })
  if (print.ok && print.data?.url) printUrl = String(print.data.url)

  return { ok: true, cartId, finalized: true, tracking, protocol, printUrl, stage: printUrl ? 'print' : 'generate' }
}
