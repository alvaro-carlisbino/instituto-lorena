import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { isLocalDeliveryCity, isMaringaRegion, resolveCepBrasil } from './cep.ts'
import { brPhoneVariants, insertInteraction } from './crm.ts'

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
 *   MELHOR_ENVIO_SERVICES        IDs de serviço p/ RESTRINGIR a cotação (ex.: "1,2" = só Correios
 *                                PAC/SEDEX). Default VAZIO = cota TODAS as transportadoras da conta.
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
 * Valor declarado (seguro) por kit, em centavos — DEVE bater com o que a etiqueta real declara
 * (autoShipToCart usa o valor do produto). Os Correios cobram o seguro/valor declarado como % do
 * valor, então a cotação e a cobrança PRECISAM incluir o mesmo seguro; senão a etiqueta sai
 * SEMPRE mais cara que o cotado (~R$5/pedido). Usa o maior preço por kit (cartão) p/ nunca
 * cobrar a MENOS que o seguro real. Kit desconhecido → null (cai no seguro padrão/0).
 */
const KIT_DECLARED_VALUE_CENTS: Record<string, number> = {
  '1_mes': 19900,
  '3_meses': 59700,
  '5_meses': 99500, // acompanha o preço do kit 5 (R$995); estava 69700 do preço antigo
}

/** Valor declarado (seguro) p/ um kit. null quando o kit é desconhecido. */
export function declaredValueCentsForKit(kitRaw: unknown): number | null {
  const key = normalizeKitKeyLocal(kitRaw)
  return key ? KIT_DECLARED_VALUE_CENTS[key] : null
}

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

/**
 * Valor da entrega interna da equipe em centavos, por praça:
 *  - Maringá:                         R$ 15,00 (override FRETE_MARINGA_CENTS)
 *  - Região (Sarandi/Paiçandu/Marialva): R$ 20,00 (override FRETE_REGIAO_CENTS)
 * Ambos aceitam 0 = grátis. Sem `cityInfo` (cidade desconhecida) assume Maringá (R$ 15)
 * por compatibilidade. Exportado p/ o executor de ops cobrar o frete certo no fechamento
 * (modo entrega_local_maringa).
 */
export function localDeliveryCents(cityInfo?: { localidade?: string; uf?: string } | null): number {
  if (isMaringaRegion(cityInfo)) {
    const raw = (Deno.env.get('FRETE_REGIAO_CENTS') ?? '').trim()
    const n = Number(raw)
    return raw !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 2000
  }
  const raw = (Deno.env.get('FRETE_MARINGA_CENTS') ?? '').trim()
  const n = Number(raw)
  return raw !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 1500
}

/**
 * Kits com FRETE GRÁTIS (alavanca de ticket — incentiva subir pro kit maior). Default: só
 * o kit de 5 meses. Override por env `FRETE_GRATIS_KITS` = csv de chaves canônicas
 * (ex.: "5_meses,3_meses"; "none" desliga). O frete grátis vale em QUALQUER modalidade
 * (entrega local ou Correios) — o servidor zera tanto no que COBRA (resolveFreightCents)
 * quanto no que MOSTRA (snapshot.frete.por_kit).
 */
export function isFreeShippingKit(kitRaw: unknown): boolean {
  const key = normalizeKitKeyLocal(kitRaw)
  if (!key) return false
  const raw = (Deno.env.get('FRETE_GRATIS_KITS') ?? '').trim().toLowerCase()
  if (raw === 'none') return false
  const set = raw ? new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)) : new Set(['5_meses'])
  return set.has(key)
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

/**
 * Piso de peso (kg) p/ COTAR e COMPRAR frete: nunca abaixo disso, mesmo que a caixa do kit
 * seja mais leve. Regra do negócio (Álvaro 20/jun): "o peso padrão é 0,7kg" — evita sub-cotar
 * e perder dinheiro no envio (ex.: 1 frasco antes cotava 0,3kg). Kits mais pesados (3+1=0,75;
 * 5=0,95) seguem com o peso real, que já é maior que o piso.
 */
const FRETE_MIN_WEIGHT_KG = 0.7

/** Peso (kg) p/ a cotação/etiqueta: maior entre a caixa do kit, o default e o piso de 0,7kg. */
function resolveWeightKg(box: FreteBox): number {
  const fromBox = box.weightKg && box.weightKg > 0 ? box.weightKg : envNum('FRETE_BOX_WEIGHT_KG', 0.7)
  return Math.max(FRETE_MIN_WEIGHT_KG, fromBox)
}

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
  // VAZIO por padrão = Melhor Envio devolve TODAS as transportadoras habilitadas na conta
  // (Correios PAC/SEDEX + Jadlog, Loggi, Azul, etc.), ordenadas do mais barato. Só restringe
  // se `servicesCsv`/env vier preenchido (ex.: "1,2" p/ só Correios).
  const services = (opts?.servicesCsv ?? Deno.env.get('MELHOR_ENVIO_SERVICES') ?? '').trim()

  const empty = (debug: string): FreteQuote => ({ ok: false, fromCep, toCep, options: [], debug })

  if (toCep.length !== 8) return empty('invalid_to_cep')
  if (fromCep.length !== 8) return empty('invalid_from_cep')

  // Praça local: entrega INTERNA da equipe (não cota Correios). Vale mesmo sem ME conectado.
  // Taxa por praça: Maringá R$ 15, região (Sarandi/Paiçandu/Marialva) R$ 20 (localDeliveryCents).
  const cityInfo = opts?.cityInfo ?? (await resolveCepBrasil(toCep))
  if (isLocalDeliveryCity(cityInfo)) {
    return {
      ok: true,
      fromCep,
      toCep,
      options: [
        { service: 'Entrega interna', serviceId: 0, company: 'Maringá e região (local)', priceCents: localDeliveryCents(cityInfo), deliveryDays: null, internal: true },
      ],
      debug: 'entrega_interna_local',
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
      weight: resolveWeightKg(box),
      length: box.lengthCm && box.lengthCm > 0 ? box.lengthCm : envNum('FRETE_BOX_LENGTH_CM', 20),
      width: box.widthCm && box.widthCm > 0 ? box.widthCm : envNum('FRETE_BOX_WIDTH_CM', 20),
      height: box.heightCm && box.heightCm > 0 ? box.heightCm : envNum('FRETE_BOX_HEIGHT_CM', 10),
    },
    options: { insurance_value: insuranceReais, receipt: false, own_hand: false },
    // Só envia o filtro de serviços quando explicitamente definido; sem ele a ME cota tudo.
    ...(services ? { services } : {}),
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

  // Agência de POSTAGEM (ponto onde a etiqueta é despachada — ex.: PEGAKI/Frete Fácil).
  // Configurável por polo em tenant_integrations.melhorenvio.agency (ID numérico da agência no
  // Melhor Envio). Sem isso, o ME usa a agência padrão da conta. NÃO tem relação com o token/login.
  let agencyId: number | null = null
  try {
    const { data: meRow } = await admin.from('tenant_integrations').select('melhorenvio').eq('tenant_id', tenantId).maybeSingle()
    const meCfg = ((meRow as { melhorenvio?: Record<string, unknown> } | null)?.melhorenvio ?? {}) as Record<string, unknown>
    const a = Number(meCfg.agency)
    if (Number.isFinite(a) && a > 0) agencyId = a
  } catch {
    // best-effort: sem config → agência padrão da conta
  }

  const cartBody = {
    service: input.serviceId,
    ...(agencyId ? { agency: agencyId } : {}),
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
        weight: resolveWeightKg(box),
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

/**
 * Lê o status + rastreio de um pedido no Melhor Envio (GET /me/orders/{id}). Usado pelo rastreio
 * "ler do painel": o operador compra a etiqueta no painel ME e o sistema puxa o status depois.
 * Enquanto o envio estiver só no CARRINHO (não comprado), a ME pode devolver 404/sem tracking —
 * tratado como "ainda sem rastreio".
 */
export async function meOrderStatus(
  admin: SupabaseClient,
  tenantId: string,
  orderId: string,
): Promise<{ ok: boolean; status: string | null; tracking: string | null; error?: string }> {
  if (!melhorEnvioConfigured()) return { ok: false, status: null, tracking: null, error: 'client_not_configured' }
  const token = await getValidMeToken(admin, tenantId)
  if (!token) return { ok: false, status: null, tracking: null, error: 'not_connected' }
  try {
    const res = await fetch(`${melhorEnvioBaseUrl()}/api/v2/me/orders/${encodeURIComponent(orderId)}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': meUserAgent() },
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, status: null, tracking: null, error: `http_${res.status}: ${text.slice(0, 120)}` }
    const data = (text ? JSON.parse(text) : {}) as Record<string, unknown>
    const status = data.status != null ? String(data.status) : null
    const tracking =
      data.tracking != null ? String(data.tracking) : data.self_tracking != null ? String(data.self_tracking) : null
    return { ok: true, status, tracking }
  } catch (e) {
    return { ok: false, status: null, tracking: null, error: (e instanceof Error ? e.message : String(e)).slice(0, 140) }
  }
}

export type AutoShipResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  cartId?: string | null
  error?: string
}

/**
 * Envio AUTOMÁTICO no fechamento: monta o frete no CARRINHO do Melhor Envio (NÃO compra —
 * o operador paga no painel). Best-effort: NUNCA lança (o chamador é o fluxo de pagamento).
 * Lê o endereço capturado em `lead.custom_fields.entrega` (cep/numero/complemento/service)
 * + cadastro. Pula Maringá (entrega interna) e endereço incompleto, devolvendo `reason`.
 */
export async function autoShipToCart(
  admin: SupabaseClient,
  tenantId: string,
  opts: {
    lead: { id: string; patient_name?: string | null; phone?: string | null; custom_fields?: Record<string, unknown> | null }
    kit?: string | null
    productName: string
    productValueCents: number
  },
): Promise<AutoShipResult> {
  try {
    const cf = (opts.lead.custom_fields ?? {}) as Record<string, unknown>
    const entrega = (cf.entrega ?? {}) as Record<string, unknown>
    const cad = (cf.cadastro ?? {}) as Record<string, string>

    // MODALIDADE manda: só 'envio_externo' gera etiqueta. Retirada e entrega local da equipe
    // NÃO vão pro Melhor Envio (a etiqueta sairia inútil). delivery_mode é gravado pela IA.
    const deliveryMode = String(entrega.delivery_mode ?? '').trim()
    if (deliveryMode === 'retirada_clinica') return { ok: false, skipped: true, reason: 'retirada_clinica' }
    if (deliveryMode === 'entrega_local_maringa') return { ok: false, skipped: true, reason: 'entrega_local_maringa' }

    if (!melhorEnvioConfigured()) return { ok: false, skipped: true, reason: 'me_nao_configurado' }

    const cep = onlyDigitsStr(entrega.cep ?? entrega.postalCode ?? cad.cep ?? '')
    if (cep.length !== 8) return { ok: false, skipped: true, reason: 'sem_cep' }

    const cityInfo = await resolveCepBrasil(cep)
    if (!cityInfo) return { ok: false, skipped: true, reason: 'cep_nao_resolvido' }
    // Rede de segurança p/ vendas sem delivery_mode explícito (fluxo antigo): praça local
    // (Maringá + vizinhas) = entrega interna, não cota Correios.
    if (!deliveryMode && isLocalDeliveryCity(cityInfo)) return { ok: false, skipped: true, reason: 'entrega_local_maringa' }

    const numero = String(entrega.numero ?? entrega.number ?? cad.numero ?? '').trim()
    if (!numero) return { ok: false, skipped: true, reason: 'sem_numero' }

    const to: MeAddress = {
      name: String(cad.nomeCompleto || opts.lead.patient_name || 'Cliente Tricopill').slice(0, 60),
      phone: opts.lead.phone ? String(opts.lead.phone) : undefined,
      document: cad.cpf || undefined,
      postalCode: cep,
      address: cityInfo.logradouro || String(entrega.logradouro ?? entrega.address ?? entrega.rua ?? '').trim(),
      number: numero,
      complement: String(entrega.complemento ?? entrega.complement ?? '').trim() || undefined,
      district: cityInfo.bairro || String(entrega.bairro ?? '').trim(),
      city: cityInfo.localidade,
      stateAbbr: cityInfo.uf,
    }
    if (!to.address) return { ok: false, skipped: true, reason: 'sem_rua' }

    // COTA ANTES e escolhe a transportadora MAIS BARATA que REALMENTE atende o trecho — qualquer
    // empresa (Correios, Jadlog, Loggi…), não Correios fixo. Isso bate com o que foi COBRADO do
    // cliente (resolveFreightCents também usa a mais barata), então a etiqueta nunca sai mais cara
    // que o cobrado. options[0] já vem ordenado do mais barato pelo Melhor Envio.
    const box = boxForKit(opts.kit) ?? undefined
    const q = await quoteFreteMelhorEnvio(admin, tenantId, cep, { box, cityInfo })
    if (!q.ok || q.options.length === 0) return { ok: false, skipped: true, reason: 'sem_servico_atende' }
    const chosen = q.options[0]
    const serviceId = chosen.serviceId

    const res = await createMeShipment(admin, tenantId, {
      to,
      serviceId,
      products: [{ name: opts.productName.slice(0, 120), quantity: 1, unitaryValueCents: Math.max(100, opts.productValueCents) }],
      box: boxForKit(opts.kit) ?? undefined,
      insuranceCents: Math.max(0, opts.productValueCents),
      finalize: false, // só carrinho — o operador compra no painel
      nonCommercial: true,
    })
    if (!res.ok) return { ok: false, reason: 'shipment_failed', error: res.error, cartId: res.cartId }
    return { ok: true, cartId: res.cartId }
  } catch (e) {
    return { ok: false, reason: 'exception', error: e instanceof Error ? e.message : String(e) }
  }
}

// Motivos de skip do autoShipToCart que o cliente RESOLVE ao completar o endereço depois
// do pagamento (número/CEP/rua). Só estes disparam o religamento — 'me_nao_configurado',
// 'sem_servico_atende' ou 'shipment_failed' não se resolvem com o endereço.
const RESHIPPABLE_REASONS = new Set(['sem_numero', 'sem_cep', 'sem_rua', 'cep_nao_resolvido'])

/**
 * Religa o envio automático quando o endereço é COMPLETADO depois do pagamento.
 *
 * Caso Kellen (07/07): checkout do site entrou sem o número da casa, o PIX confirmou, o
 * autoShipToCart pulou com `sem_numero` e, quando ela mandou "Av. Dona Lídia, 900" pelo
 * WhatsApp 1min depois, o envio NÃO era retentado — ficava parado até alguém notar.
 *
 * Idempotência pela timeline (não há tabela de envios): só age se a ÚLTIMA interação de
 * 'Melhor Envio' do lead for um skip retentável. Assim que um envio entra no carrinho (ou
 * é local/retirada), a última interação deixa de ser skip e o religamento não repete.
 * Best-effort: nunca lança (o chamador é o webhook de inbound).
 */
export async function maybeReshipAfterAddressComplete(admin: SupabaseClient, leadId: string): Promise<void> {
  await reshipLead(admin, leadId, { force: false })
}

/**
 * Núcleo do religamento. `force: true` (crm-reship manual / fechamento do cartão do site,
 * que não deixa NENHUM evento de ME na timeline) dispensa a exigência de um skip retentável
 * como último evento — mas NUNCA dispensa as provas de envio existente: rastreio no próprio
 * lead, sucesso de carrinho como último evento, ou rastreio RECENTE num lead irmão de mesmo
 * telefone (caso Thiago 14/07: skip ficou no lead do site e o envio real saiu no lead
 * duplicado do WhatsApp — o reship recriou a etiqueta).
 */
export async function reshipLead(admin: SupabaseClient, leadId: string, opts: { force?: boolean } = {}): Promise<void> {
  try {
    if (!leadId) return
    const force = opts.force === true

    // 1. Última interação de envio: sucesso de carrinho nunca repete; sem force, exige
    //    um skip retentável (endereço incompleto).
    const { data: lastShip } = await admin
      .from('interactions')
      .select('content, author')
      .eq('lead_id', leadId)
      .in('author', ['Melhor Envio', 'Logística'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastContent = String((lastShip as { content?: string } | null)?.content ?? '')
    if (/carrinho do Melhor Envio|adicionado ao carrinho/i.test(lastContent)) return // envio já gerado
    if (!force) {
      if (!lastContent) return // nunca tentou enviar por aqui — não inventa envio
      const m = lastContent.match(/NÃO gerado automaticamente \(([a-z_]+)\)/)
      if (!m || !RESHIPPABLE_REASONS.has(m[1])) return // já tem envio, é local/retirada, ou skip não-retentável
    }

    // 2. Endereço agora completo? (envio externo exige cep+numero; local/retirada não vão pro ME)
    const { data: leadRow } = await admin
      .from('leads')
      .select('id, patient_name, phone, tenant_id, custom_fields')
      .eq('id', leadId)
      .maybeSingle()
    const l = leadRow as {
      id: string; patient_name?: string; phone?: string; tenant_id?: string
      custom_fields?: Record<string, unknown>
    } | null
    if (!l) return
    const entrega = ((l.custom_fields?.entrega ?? {}) as Record<string, unknown>)
    const ster = (v: unknown) => String(v ?? '').trim()
    const endLinha = [
      [ster(entrega.logradouro), ster(entrega.numero)].filter(Boolean).join(', '),
      ster(entrega.complemento), ster(entrega.bairro), [ster(entrega.cidade), ster(entrega.uf)].filter(Boolean).join('/'),
    ].filter(Boolean).join(' - ')
    const mode = String(entrega.delivery_mode ?? '').trim()
    if (mode === 'retirada_clinica' || mode === 'entrega_local_maringa') {
      // Force (fluxo sem NENHUM evento de ME, ex.: cartão do site): registra a nota
      // operacional UMA vez — a equipe precisa saber que é entrega interna/retirada.
      if (force && !lastContent) {
        await insertInteraction(admin, {
          leadId: l.id, patientName: String(l.patient_name ?? 'Cliente'), channel: 'system', direction: 'system',
          author: 'Logística',
          content: mode === 'retirada_clinica'
            ? '🏥 RETIRADA NA CLÍNICA — cliente vai buscar. (Sem envio.)'
            : `🛵 ENTREGA LOCAL (equipe) — entregar em: ${endLinha || 'endereço a confirmar'}. (Sem etiqueta dos Correios.)`,
          tenantId: String(l.tenant_id ?? 'tricopill'),
        })
      }
      return
    }
    // Prova de envio existente no PRÓPRIO lead: rastreio/status gravados pelo poller.
    if (String(entrega.tracking ?? '').trim()) return
    if (['enviado', 'postado', 'entregue'].includes(String(entrega.status ?? '').trim())) return
    const cep = onlyDigitsStr(entrega.cep ?? entrega.postalCode)
    const numero = String(entrega.numero ?? entrega.number ?? '').trim()
    // Sem force: espera a próxima mensagem completar o endereço. Com force, segue até o
    // autoShipToCart pra REGISTRAR o skip padrão (sem_cep/sem_numero) — é esse evento que
    // permite o religamento automático quando o cliente mandar o endereço depois.
    if (!force && (cep.length !== 8 || !numero)) return

    // 2.5. Lead irmão (mesmo telefone ±55/±9º dígito) com rastreio RECENTE = mesmo pedido já
    //      enviado por outro cadastro (dup site×WhatsApp). Janela de 14 dias pra não bloquear
    //      recompra legítima meses depois. Registra o motivo pra virar o "último evento" e
    //      encerrar novas tentativas.
    if (l.phone) {
      const variants = brPhoneVariants(String(l.phone))
      if (variants.length) {
        const { data: sibs } = await admin
          .from('leads')
          .select('id, patient_name, custom_fields')
          .in('phone', variants)
          .neq('id', l.id)
          .limit(10)
        for (const sRow of (sibs ?? []) as Array<{ id: string; patient_name?: string; custom_fields?: Record<string, unknown> }>) {
          const sEnt = ((sRow.custom_fields?.entrega ?? {}) as Record<string, unknown>)
          const sTracking = String(sEnt.tracking ?? '').trim()
          if (!sTracking) continue
          const upd = Date.parse(String(sEnt.tracking_updated_at ?? ''))
          const recent = Number.isFinite(upd) && Date.now() - upd < 14 * 24 * 60 * 60 * 1000
          if (!recent) continue
          await insertInteraction(admin, {
            leadId: l.id,
            patientName: String(l.patient_name ?? 'Cliente'),
            channel: 'system',
            direction: 'system',
            author: 'Melhor Envio',
            content: `📦 Envio NÃO recriado: rastreio ${sTracking} já existe no lead ${String(sRow.patient_name ?? sRow.id)} (mesmo telefone). Se for outro pedido, gere pelo botão.`,
            tenantId: String(l.tenant_id ?? 'tricopill'),
          })
          return
        }
      }
    }

    // 3. Pedido PAGO do lead (kit/valor p/ a etiqueta). Kits/vendas Tricopill vivem no tenant
    //    'tricopill'. Rede (site) OU Asaas — o mais recente pago.
    const { data: rede } = await admin
      .from('rede_payments')
      .select('kit, amount_cents, freight_cents, created_at')
      .eq('lead_id', leadId).eq('status', 'paid')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const { data: asaas } = await admin
      .from('asaas_payments')
      .select('kit, amount_cents, freight_cents, created_at')
      .eq('lead_id', leadId).eq('status', 'paid')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const paid = [rede, asaas]
      .filter(Boolean)
      .sort((a, b) => String((b as { created_at?: string }).created_at ?? '').localeCompare(String((a as { created_at?: string }).created_at ?? '')))[0] as
        { kit?: string | null; amount_cents?: number; freight_cents?: number } | undefined
    if (!paid) return // sem pagamento pago — não gera envio

    // 4. Religa o envio (mesmo caminho do fechamento). Valor do produto = pago − frete.
    const blingTenant = paid.kit ? 'tricopill' : String(l.tenant_id ?? 'tricopill')
    const productValueCents = Math.max(0, Math.round(Number(paid.amount_cents) || 0) - Math.max(0, Math.round(Number(paid.freight_cents) || 0)))
    const ship = await autoShipToCart(admin, blingTenant, {
      lead: { id: l.id, patient_name: l.patient_name, phone: l.phone, custom_fields: l.custom_fields },
      kit: paid.kit ?? null,
      productName: paid.kit ? `Tricopill (${paid.kit})` : 'Tricopill',
      productValueCents,
    })

    // 5. Timeline: registra sucesso ou falha nova (nunca repete o mesmo evento — é o
    //    "último evento" que fecha a idempotência). No force, os skips retentáveis também
    //    são registrados no formato padrão pra habilitar o religamento automático depois.
    let content: string | null = null
    let author = 'Melhor Envio'
    if (ship.ok) {
      content = force
        ? `📦 Envio no carrinho do Melhor Envio (#${ship.cartId}). Finalize a compra no painel.`
        : `📦 Envio no carrinho do Melhor Envio (#${ship.cartId}) — gerado após o endereço ser completado. Finalize a compra no painel.`
    } else if (ship.reason === 'entrega_local_maringa' || ship.reason === 'retirada_clinica') {
      // Rede de segurança do autoShipToCart (cidade da praça local sem delivery_mode).
      if (force && !lastContent) {
        author = 'Logística'
        content = ship.reason === 'retirada_clinica'
          ? '🏥 RETIRADA NA CLÍNICA — cliente vai buscar. (Sem envio.)'
          : `🛵 ENTREGA LOCAL (equipe) — entregar em: ${endLinha || 'endereço a confirmar'}. (Sem etiqueta dos Correios.)`
      }
    } else if (ship.reason && !RESHIPPABLE_REASONS.has(ship.reason)) {
      content = `📦 Envio ainda não gerado (${ship.reason}) mesmo com o endereço completo. Gere pelo botão.`
    } else if (force && ship.reason) {
      content = `📦 Envio NÃO gerado automaticamente (${ship.reason}). Gere pelo botão se for envio externo.`
    }
    if (content && content !== lastContent) {
      await insertInteraction(admin, {
        leadId: l.id, patientName: String(l.patient_name ?? 'Cliente'), channel: 'system', direction: 'system', author, content, tenantId: blingTenant,
      })
    }
  } catch { /* nunca derruba o inbound por causa do religamento de envio */ }
}
