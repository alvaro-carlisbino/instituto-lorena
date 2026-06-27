import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { resolveCepBrasil } from './cep.ts'

/**
 * Bling ERP — API v3 (OAuth2 authorization_code + refresh).
 * client_id/client_secret do app: secrets globais BLING_CLIENT_ID / BLING_CLIENT_SECRET.
 * Tokens rotativos (access ~6h, refresh ~30d): tenant_integrations.bling por polo.
 */

const AUTHORIZE_URL = 'https://www.bling.com.br/Api/v3/oauth/authorize'
const TOKEN_URL = 'https://api.bling.com.br/Api/v3/oauth/token'
const API_BASE = (Deno.env.get('BLING_API_BASE') ?? 'https://api.bling.com.br/Api/v3').replace(/\/$/, '')

export function blingClientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId = (Deno.env.get('BLING_CLIENT_ID') ?? '').trim()
  const clientSecret = (Deno.env.get('BLING_CLIENT_SECRET') ?? '').trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function blingAuthorizeUrl(clientId: string, state: string): string {
  // Bling v3 usa a "URL de redirecionamento" cadastrada no app — NÃO por parâmetro.
  const u = new URL(AUTHORIZE_URL)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('state', state)
  return u.toString()
}

type BlingTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  error?: string
  error_description?: string
}

async function postToken(body: Record<string, string>): Promise<BlingTokenResponse> {
  const creds = blingClientCreds()
  if (!creds) throw new Error('bling_client_not_configured')
  const basic = btoa(`${creds.clientId}:${creds.clientSecret}`)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(body).toString(),
  })
  const text = await res.text()
  let parsed: BlingTokenResponse = {}
  try {
    parsed = text ? (JSON.parse(text) as BlingTokenResponse) : {}
  } catch {
    parsed = {}
  }
  if (!res.ok || !parsed.access_token) {
    throw new Error(`bling_token_${res.status}: ${text.slice(0, 300)}`)
  }
  return parsed
}

async function persistTokens(
  admin: SupabaseClient,
  tenantId: string,
  tok: BlingTokenResponse,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const expiresAt = new Date(Date.now() + (Number(tok.expires_in ?? 21600) - 60) * 1000).toISOString()
  const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
  const current = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
  const next = {
    ...current,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? current.refresh_token,
    expires_at: expiresAt,
    connected_at: current.connected_at ?? new Date().toISOString(),
    ...extra,
  }
  await admin.from('tenant_integrations').upsert({ tenant_id: tenantId, bling: next })
}

/** Troca o authorization_code por tokens e persiste no polo. */
export async function blingExchangeCode(
  admin: SupabaseClient,
  tenantId: string,
  code: string,
): Promise<void> {
  const tok = await postToken({ grant_type: 'authorization_code', code })
  await persistTokens(admin, tenantId, tok)
}

/** Retorna um access_token válido (renova com refresh_token se expirado). null = não conectado. */
export async function getValidBlingToken(admin: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
  const access = typeof cfg.access_token === 'string' ? cfg.access_token : ''
  const refresh = typeof cfg.refresh_token === 'string' ? cfg.refresh_token : ''
  const expiresAt = typeof cfg.expires_at === 'string' ? Date.parse(cfg.expires_at) : 0

  if (access && expiresAt && Date.now() < expiresAt) return access
  if (!refresh) return access || null

  // Expirado: renova. Best-effort — falha de refresh NÃO pode derrubar o chamador
  // (ex.: o BI). Só significa "Bling indisponível": devolve null e loga.
  try {
    const tok = await postToken({ grant_type: 'refresh_token', refresh_token: refresh })
    await persistTokens(admin, tenantId, tok)
    return tok.access_token ?? null
  } catch (e) {
    console.warn('[bling] refresh token falhou:', e instanceof Error ? e.message : String(e))
    return null
  }
}

export function blingConnectionStatus(cfg: Record<string, unknown> | null | undefined): {
  connected: boolean
  connectedAt: string | null
  accountName: string | null
} {
  const c = (cfg ?? {}) as Record<string, unknown>
  return {
    connected: typeof c.refresh_token === 'string' && c.refresh_token.length > 0,
    connectedAt: typeof c.connected_at === 'string' ? c.connected_at : null,
    accountName: typeof c.account_name === 'string' ? c.account_name : null,
  }
}

async function blingFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  // Timeout OBRIGATÓRIO: sem isto, uma chamada lenta/travada ao Bling pendura o chamador
  // indefinidamente. Como buildBlingCatalog roda a cada resposta do bot de vendas (e o
  // catch dele NÃO protege contra hang, só contra erro), um Bling lento derrubava a IA do
  // Tricopill inteira. Aborta em BLING_FETCH_TIMEOUT_MS (default 8s) → falha rápido → a IA
  // responde mesmo sem catálogo.
  const timeoutMs = Number(Deno.env.get('BLING_FETCH_TIMEOUT_MS') ?? '') || 8000
  return await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
  })
}

/**
 * Como blingFetch, mas com RETRY em 429 (limite Bling = 3 req/s) e 5xx transitório. Usar SÓ
 * em escrita CRÍTICA (criar contato / pedido), onde uma falha transitória NÃO pode degradar
 * para o contato genérico (caso Alisson 19/jun: contato bateu no rate-limit no meio da rajada
 * pedido+NF-e+Melhor Envio e o pedido saiu no "Cliente Loja Tricopill (site)"). Respeita
 * Retry-After; senão backoff 700ms → 1400ms → 2800ms. NÃO usar em leitura quente (catálogo).
 */
async function blingFetchWithRetry(
  token: string,
  path: string,
  init?: RequestInit,
  attempts = 4,
): Promise<Response> {
  let res = await blingFetch(token, path, init)
  for (let i = 1; i < attempts && (res.status === 429 || res.status >= 500); i++) {
    const raSec = Number(res.headers.get('retry-after') ?? '')
    const wait = Number.isFinite(raSec) && raSec > 0
      ? Math.min(raSec * 1000, 5000)
      : 700 * 2 ** (i - 1)
    await new Promise((r) => setTimeout(r, wait))
    res = await blingFetch(token, path, init)
  }
  return res
}

/** Lista produtos (catálogo + saldo de estoque quando disponível). */
export async function blingListProducts(
  token: string,
  opts?: { limite?: number; pagina?: number },
): Promise<Array<Record<string, unknown>>> {
  const limite = Math.min(100, Math.max(1, opts?.limite ?? 100))
  const pagina = Math.max(1, opts?.pagina ?? 1)
  const res = await blingFetch(token, `/produtos?limite=${limite}&pagina=${pagina}`)
  const text = await res.text()
  if (!res.ok) throw new Error(`bling_produtos_${res.status}: ${text.slice(0, 200)}`)
  let parsed: { data?: Array<Record<string, unknown>> } = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = {}
  }
  return Array.isArray(parsed.data) ? parsed.data : []
}

export type BlingCatalogItem = {
  id: string
  nome: string
  codigo: string
  preco: number
  estoque: number | null
  /** URL da foto do produto (preservada no cache p/ a loja pública do site Tricopill). */
  imagem?: string
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Extrai a URL da imagem de um produto do Bling (imagemURL OU midia.imagens.externas/internas).
 * Mesma regra do tricopill-bling-keepalive (site) — o catalog_cache é compartilhado, então
 * AMBOS os escritores precisam manter o campo `imagem` (senão o filtro de foto da loja some).
 */
function pickBlingImg(p: Record<string, unknown>): string {
  const url = p.imagemURL
  if (typeof url === 'string' && url.trim()) return url.trim()
  const m = (p.midia && typeof p.midia === 'object' ? p.midia : {}) as Record<string, unknown>
  const imgs = (m.imagens && typeof m.imagens === 'object' ? m.imagens : {}) as Record<string, unknown>
  for (const a of [imgs.externas, imgs.internas]) {
    if (Array.isArray(a) && a[0] && typeof a[0] === 'object') {
      const o = a[0] as Record<string, unknown>
      const v = o.link ?? o.url ?? o.linkMiniatura
      if (typeof v === 'string' && v) return v
    }
  }
  return ''
}

/** Saldos de estoque por id de produto (best-effort). */
async function blingStockMap(token: string, ids: string[]): Promise<Record<string, number>> {
  const map: Record<string, number> = {}
  if (!ids.length) return map
  try {
    const qs = ids.slice(0, 100).map((id) => `idsProdutos[]=${encodeURIComponent(id)}`).join('&')
    const res = await blingFetch(token, `/estoques/saldos?${qs}`)
    if (!res.ok) return map
    const parsed = JSON.parse((await res.text()) || '{}') as { data?: Array<Record<string, unknown>> }
    for (const row of parsed.data ?? []) {
      const pid = String((row.produto as { id?: unknown } | undefined)?.id ?? row.idProduto ?? '')
      const saldo = num(row.saldoVirtualTotal ?? row.saldoFisicoTotal ?? row.saldo)
      if (pid) map[pid] = saldo
    }
  } catch {
    // ignore
  }
  return map
}

/**
 * Catálogo compacto do Bling (nome, código, preço, estoque) com cache em
 * tenant_integrations.bling.catalog_cache. Best-effort: em erro devolve o cache
 * (ou vazio) sem quebrar o fluxo da IA.
 */
export async function buildBlingCatalog(
  admin: SupabaseClient,
  tenantId: string,
  opts?: { forceRefresh?: boolean; maxAgeMs?: number },
): Promise<{ items: BlingCatalogItem[]; fetchedAt: string | null; fromCache: boolean }> {
  const maxAgeMs = opts?.maxAgeMs ?? 10 * 60 * 1000
  const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
  const cache = Array.isArray(cfg.catalog_cache) ? (cfg.catalog_cache as BlingCatalogItem[]) : []
  const fetchedAt = typeof cfg.catalog_fetched_at === 'string' ? cfg.catalog_fetched_at : null
  const fresh = fetchedAt && Date.now() - Date.parse(fetchedAt) < maxAgeMs

  if (!opts?.forceRefresh && fresh) return { items: cache, fetchedAt, fromCache: true }

  try {
    const token = await getValidBlingToken(admin, tenantId)
    if (!token) return { items: cache, fetchedAt, fromCache: true }
    const raw = await blingListProducts(token, { limite: 100 })
    const ids = raw.map((p) => String(p.id ?? '')).filter(Boolean)
    const stock = await blingStockMap(token, ids)
    // Imagens já no cache (populadas pelo keepalive do site, que faz fetch detalhado): preserva
    // por id quando a listagem não traz a foto — assim a reescrita do bot NÃO apaga as imagens.
    const priorImg = new Map(
      cache.map((c) => [c.id, typeof c.imagem === 'string' ? c.imagem : '']).filter(([, v]) => v),
    )
    const items: BlingCatalogItem[] = raw.map((p) => {
      const id = String(p.id ?? '')
      const est = (p.estoque ?? {}) as Record<string, unknown>
      const estoqueFromProduct = p.saldoVirtualTotal ?? p.saldoFisicoTotal ?? est.saldoVirtualTotal ?? est.saldoFisicoTotal
      const estoque = id in stock ? stock[id] : estoqueFromProduct != null ? num(estoqueFromProduct) : null
      return {
        id,
        nome: String(p.nome ?? p.descricao ?? '').slice(0, 120),
        codigo: String(p.codigo ?? p.sku ?? ''),
        preco: num(p.preco),
        estoque,
        imagem: pickBlingImg(p) || priorImg.get(id) || '',
      }
    })
    const nowIso = new Date().toISOString()
    await admin.from('tenant_integrations').upsert({
      tenant_id: tenantId,
      bling: { ...cfg, catalog_cache: items, catalog_fetched_at: nowIso },
    })
    return { items, fetchedAt: nowIso, fromCache: false }
  } catch {
    return { items: cache, fetchedAt, fromCache: true }
  }
}

// Mapa padrão kit -> frascos a abater (3 meses leva o 4º grátis).
const DEFAULT_KIT_BOTTLES: Record<string, number> = { '1_mes': 1, '3_meses': 4, '5_meses': 5 }
const DEFAULT_KIT_PRODUCT_ID = '16322942669' // "Tricopill - Suplemento Capilar" = frasco INDIVIDUAL (SKU 00001)

// Produto PRÓPRIO de cada kit no Bling (o pedido sai como "Tricopill 3 Meses" etc., NÃO como o
// individual 00001). O estoque do kit deve abater o frasco base pela COMPOSIÇÃO do Bling
// (kit = composto de N× 16322942669). Override por tenant em bling.kit_product_ids.
const DEFAULT_KIT_PRODUCT_IDS: Record<string, string> = {
  '1_mes': '16577835905',
  '3_meses': '16580995608',
  '5_meses': '16577835908',
}

const KIT_LABEL: Record<string, string> = {
  '1_mes': 'Tricopill 1 mês (1 frasco)',
  '3_meses': 'Tricopill 3 meses (3+1 frascos)',
  '5_meses': 'Tricopill 5 meses (5 frascos)',
}

/**
 * Acha (por TELEFONE) ou cria um contato no Bling para o cliente. Casa por telefone —
 * NUNCA por nome só (a busca por nome traz xarás → atribuiria a venda à pessoa errada).
 * Devolve o id do contato, ou null (aí o caller cai no contato genérico). Best-effort.
 */
/** DD/MM/AAAA (cadastro) -> YYYY-MM-DD (formato que o Bling exige). '' se inválido. */
function ddmmaaaaToYmd(s: string): string {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return ''
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

async function blingFindOrCreateContato(
  token: string,
  args: {
    nome: string; phone?: string; cpf?: string; email?: string; dataNascimento?: string; sexo?: string
    /** Endereço p/ NF-e (Bling exige CPF + endereço completo pra emitir nota). */
    endereco?: { rua?: string; numero?: string; complemento?: string; bairro?: string; cep?: string; municipio?: string; uf?: string }
  },
): Promise<string | null> {
  const nome = String(args.nome ?? '').trim().slice(0, 120)
  if (!nome) return null
  const phoneDigits = String(args.phone ?? '').replace(/\D/g, '')
  const tail8 = phoneDigits.length >= 8 ? phoneDigits.slice(-8) : ''
  const cpf = String(args.cpf ?? '').replace(/\D/g, '')
  const email = String(args.email ?? '').trim().slice(0, 120)
  const nascimento = ddmmaaaaToYmd(args.dataNascimento ?? '')
  const sexo = ['M', 'F'].includes(String(args.sexo ?? '').trim().toUpperCase()) ? String(args.sexo).trim().toUpperCase() : ''

  // 1) Procura por CPF (mais único) e depois por telefone — NUNCA só por nome (xarás).
  for (const term of [cpf.length === 11 ? cpf : '', tail8 ? phoneDigits.slice(-11) : ''].filter(Boolean)) {
    try {
      const res = await blingFetchWithRetry(token, `/contatos?pesquisa=${encodeURIComponent(term)}&limite=20`)
      if (res.ok) {
        const data = (JSON.parse((await res.text()) || '{}')?.data ?? []) as Array<Record<string, unknown>>
        const match = data.find((c) => {
          const doc = String(c.numeroDocumento ?? '').replace(/\D/g, '')
          const t = String(c.telefone ?? '').replace(/\D/g, '')
          const cel = String(c.celular ?? '').replace(/\D/g, '')
          return (cpf.length === 11 && doc === cpf) || (!!tail8 && (t.endsWith(tail8) || cel.endsWith(tail8)))
        })
        if (match?.id != null) return String(match.id)
      }
    } catch {
      // segue
    }
  }

  // 2) Cria com DEGRADAÇÃO graduada: tenta o cadastro completo; se a API recusar a
  // estrutura (ex.: dadosAdicionais), tenta sem ela mas com CPF/e-mail; por fim o mínimo.
  // Assim, no pior caso ainda cria o contato no nome certo.
  const tel = phoneDigits ? phoneDigits.slice(-11) : ''
  const base: Record<string, unknown> = { nome, tipo: 'F', situacao: 'A' }
  if (tel) { base.telefone = tel; base.celular = tel }
  const withDoc: Record<string, unknown> = { ...base }
  if (cpf.length === 11) withDoc.numeroDocumento = cpf
  if (email) withDoc.email = email

  // Endereço (geral) p/ NF-e. Só inclui se tiver CEP — senão o Bling reclama de campos vazios.
  const e = args.endereco ?? {}
  const cepDigits = String(e.cep ?? '').replace(/\D/g, '')
  const withEndereco: Record<string, unknown> = { ...withDoc }
  if (cepDigits.length === 8 && e.rua && e.municipio && e.uf) {
    withEndereco.endereco = {
      geral: {
        endereco: String(e.rua).slice(0, 90),
        numero: String(e.numero ?? 'S/N').slice(0, 20),
        complemento: String(e.complemento ?? '').slice(0, 60),
        bairro: String(e.bairro ?? '').slice(0, 60),
        cep: cepDigits,
        municipio: String(e.municipio).slice(0, 60),
        uf: String(e.uf).toUpperCase().slice(0, 2),
      },
    }
  }

  const dados: Record<string, unknown> = {}
  if (nascimento) dados.dataNascimento = nascimento
  if (sexo) dados.sexo = sexo
  const full: Record<string, unknown> = Object.keys(dados).length ? { ...withEndereco, dadosAdicionais: dados } : { ...withEndereco }

  const seen = new Set<string>()
  // Degradação: completo (c/ endereço) → c/ doc → mínimo. Garante o contato no nome certo.
  const bodies = [full, withEndereco, withDoc, base]
    .map((b) => JSON.stringify(b))
    .filter((s) => (seen.has(s) ? false : (seen.add(s), true)))
  let lastErr = ''
  for (const body of bodies) {
    try {
      const res = await blingFetchWithRetry(token, '/contatos', { method: 'POST', body })
      if (res.ok) {
        const id = (JSON.parse((await res.text()) || '{}')?.data as { id?: number | string } | undefined)?.id
        if (id != null) return String(id)
        lastErr = 'resposta sem id'
      } else {
        lastErr = `${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      // tenta o próximo (menos campos)
    }
  }
  // Não cria silenciosamente: se chegou aqui, o caller cai no contato GENÉRICO — registra
  // pra investigar (rate-limit, validação, token) em vez de a venda sair sem nome.
  console.warn('[bling] blingFindOrCreateContato falhou; usando contato genérico', { nome, lastErr })
  return null
}

/**
 * Cria um pedido de venda no Bling para uma venda do Tricopill.
 * Usa o contato REAL do cliente (criado/achado por telefone) ou, em falha, o contato
 * padrão (tenant_integrations.bling.default_contato_id). Frasco base (kit_product_id),
 * abate frascos conforme o kit. Valor = valor pago.
 */
export async function blingCreateSaleOrder(
  admin: SupabaseClient,
  tenantId: string,
  args: {
    kit: string; amountCents: number; customerName?: string; phone?: string
    cpf?: string; email?: string; dataNascimento?: string; sexo?: string
    /** Venda AVULSA (sem kit): descrição livre do item (ex.: "Tricopill + Shampoo"). */
    description?: string
    /** Força a quantidade de frascos (ex.: envio de assinatura = 1 ou 3). Ignora o mapa de kit. */
    bottlesOverride?: number
    /** Endereço de entrega capturado p/ completar o contato (NF-e) + modalidade da venda. */
    entrega?: {
      cep?: string; numero?: string; complemento?: string
      bairro?: string; logradouro?: string; cidade?: string; uf?: string
      delivery_mode?: string
    }
  },
): Promise<{
  orderId: string | null
  bottles: number
  /** true: o contato REAL não pôde ser criado/achado e o pedido saiu no contato GENÉRICO. */
  contatoFallback: boolean
  nfe?: { nfeId: string | null; numero?: string; situacao?: string; transmitted: boolean; error?: string }
}> {
  const token = await getValidBlingToken(admin, tenantId)
  if (!token) throw new Error('bling_nao_conectado')

  const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
  let contatoId = cfg.default_contato_id != null ? String(cfg.default_contato_id).trim() : ''
  if (!contatoId) throw new Error('bling_default_contato_nao_configurado')
  // Contato REAL do cliente (por telefone): se conseguir, o pedido sai no nome dele;
  // senão mantém o genérico (best-effort, não quebra a venda).
  // Endereço p/ NF-e: prioriza o que o cliente informou (entrega.*); completa o que faltar
  // pelo ViaCEP (rua/bairro/cidade/uf). Assim a nota sai com endereço mesmo se o ViaCEP falhar.
  let endereco: { rua?: string; numero?: string; complemento?: string; bairro?: string; cep?: string; municipio?: string; uf?: string } | undefined
  const cepEntrega = String(args.entrega?.cep ?? '').replace(/\D/g, '')
  if (cepEntrega.length === 8) {
    const info = await resolveCepBrasil(cepEntrega).catch(() => null)
    endereco = {
      rua: args.entrega?.logradouro || info?.logradouro,
      numero: args.entrega?.numero,
      complemento: args.entrega?.complemento,
      bairro: args.entrega?.bairro || info?.bairro,
      cep: cepEntrega,
      municipio: args.entrega?.cidade || info?.localidade,
      uf: (args.entrega?.uf || info?.uf || '').toUpperCase() || undefined,
    }
  }
  let contatoFallback = false
  if (args.customerName) {
    const realId = await blingFindOrCreateContato(token, {
      nome: args.customerName, phone: args.phone, cpf: args.cpf, email: args.email,
      dataNascimento: args.dataNascimento, sexo: args.sexo, endereco,
    })
    if (realId) contatoId = realId
    else contatoFallback = true
  }

  const individualProductId = cfg.kit_product_id != null && String(cfg.kit_product_id).trim()
    ? String(cfg.kit_product_id).trim()
    : DEFAULT_KIT_PRODUCT_ID
  const bottlesMap = (cfg.kit_bottles && typeof cfg.kit_bottles === 'object'
    ? (cfg.kit_bottles as Record<string, unknown>)
    : {}) as Record<string, unknown>
  const kitProductIds = (cfg.kit_product_ids && typeof cfg.kit_product_ids === 'object'
    ? (cfg.kit_product_ids as Record<string, unknown>)
    : {}) as Record<string, unknown>
  const hasKit = !!String(args.kit ?? '').trim()
  const overrideBottles = Number(args.bottlesOverride) > 0 ? Math.floor(Number(args.bottlesOverride)) : 0
  // Produto do kit (ex.: "Tricopill 3 Meses"). Se existir, o pedido sai NESSE produto (1 un.),
  // e o estoque abate o frasco base pela COMPOSIÇÃO do Bling — NÃO no individual 00001.
  const kitProductId = hasKit && !overrideBottles
    ? String(kitProductIds[args.kit] ?? DEFAULT_KIT_PRODUCT_IDS[args.kit] ?? '').trim()
    : ''

  const totalReais = Math.round(args.amountCents) / 100
  let productId: string
  let bottles: number // quantidade da linha do pedido
  let valorUnit: number
  if (kitProductId) {
    // KIT com produto próprio: 1 unidade do produto do kit, valor cheio.
    productId = kitProductId
    bottles = 1
    valorUnit = Math.round(totalReais * 100) / 100
  } else {
    // Avulso / assinatura (bottlesOverride) / kit sem produto: frasco INDIVIDUAL (00001) × frascos.
    productId = individualProductId
    bottles = overrideBottles || (hasKit ? (Number(bottlesMap[args.kit] ?? DEFAULT_KIT_BOTTLES[args.kit] ?? 1) || 1) : 1)
    valorUnit = Math.round((totalReais / bottles) * 100) / 100
  }
  const itemDescricao = hasKit
    ? (KIT_LABEL[args.kit] ?? `Tricopill ${args.kit}`)
    : (args.description?.trim() || 'Venda avulsa Tricopill')

  // Data do pedido (YYYY-MM-DD, fuso de Maringá/Brasília). O Bling EXIGE `data` —
  // sem ela recusa com "A data para geração das parcelas é inválida".
  const dataPedido = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  // Observações: nome do cliente + MODALIDADE de entrega (a equipe de logística lê aqui no
  // Bling). Na entrega local da equipe, inclui o endereço operacional (rua, nº, compl., bairro).
  const modeLabels: Record<string, string> = {
    retirada_clinica: 'RETIRADA NA CLÍNICA',
    entrega_local_maringa: 'ENTREGA LOCAL (equipe)',
    envio_externo: 'ENVIO (Correios/transportadora)',
  }
  const mode = String(args.entrega?.delivery_mode ?? '').trim()
  const obsParts: string[] = []
  if (args.customerName) obsParts.push(`Cliente: ${args.customerName} — venda via CRM/WhatsApp`)
  if (mode && modeLabels[mode]) {
    obsParts.push(`Modalidade: ${modeLabels[mode]}`)
    if (mode === 'entrega_local_maringa' && endereco) {
      const linha = [
        [endereco.rua, endereco.numero].filter(Boolean).join(', '),
        endereco.complemento, endereco.bairro,
        [endereco.municipio, endereco.uf].filter(Boolean).join('/'),
      ].filter(Boolean).join(' - ')
      if (linha) obsParts.push(`Entregar em: ${linha}`)
    }
  }
  const obs = obsParts.length ? obsParts.join(' | ') : undefined
  const payload = {
    contato: { id: Number(contatoId) || contatoId },
    data: dataPedido,
    ...(obs ? { observacoes: obs } : {}),
    itens: [
      {
        produto: { id: Number(productId) || productId },
        descricao: itemDescricao,
        quantidade: bottles,
        valor: valorUnit,
      },
    ],
  }
  const orderId = await blingCreateOrder(token, payload)

  // NF-e automática (gated): só quando o tenant habilitou (auto_nfe_enabled) E configurou a
  // natureza de operação (natureza_operacao_id). Emitir nota é AÇÃO FISCAL irreversível — por
  // isso fica OFF por padrão e a transmissão ao SEFAZ exige auto_nfe_transmit=true. Sem CPF
  // não tenta (nota PF exige CPF). Best-effort: nunca derruba a venda.
  let nfe: { nfeId: string | null; numero?: string; situacao?: string; transmitted: boolean; error?: string } | undefined
  const cpfOk = String(args.cpf ?? '').replace(/\D/g, '').length === 11
  if (orderId && cfg.auto_nfe_enabled === true && cfg.natureza_operacao_id && cpfOk) {
    nfe = await blingEmitNfe(token, {
      naturezaOperacaoId: String(cfg.natureza_operacao_id),
      contatoId,
      itens: payload.itens,
      observacoes: obs,
      transmit: cfg.auto_nfe_transmit === true,
    }).catch((e) => ({ nfeId: null, transmitted: false, error: e instanceof Error ? e.message : String(e) }))
  }
  return { orderId, bottles, contatoFallback, nfe }
}

/**
 * Cria (e opcionalmente transmite) uma NF-e no Bling a partir dos itens/contato do pedido.
 * Bling auto-preenche a tributação a partir do cadastro fiscal do PRODUTO + da natureza de
 * operação informada. `transmit=false` deixa a nota em rascunho pro operador conferir e
 * transmitir num clique. Requer `natureza_operacao_id` configurado no tenant.
 */
export async function blingEmitNfe(
  token: string,
  args: {
    naturezaOperacaoId: string
    contatoId: string
    itens: Array<Record<string, unknown>>
    observacoes?: string
    transmit?: boolean
  },
): Promise<{ nfeId: string | null; numero?: string; situacao?: string; transmitted: boolean; error?: string }> {
  const payload: Record<string, unknown> = {
    tipo: 1, // 1 = saída
    finalidade: 1, // 1 = NF-e normal
    naturezaOperacao: { id: Number(args.naturezaOperacaoId) || args.naturezaOperacaoId },
    contato: { id: Number(args.contatoId) || args.contatoId },
    itens: args.itens,
    ...(args.observacoes ? { observacoes: args.observacoes } : {}),
  }
  const res = await blingFetch(token, '/nfe', { method: 'POST', body: JSON.stringify(payload) })
  const text = await res.text()
  if (!res.ok) throw new Error(`bling_nfe_${res.status}: ${text.slice(0, 300)}`)
  let parsed: { data?: { id?: number | string; numero?: string | number; situacao?: string | number } } = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = {}
  }
  const nfeId = parsed.data?.id != null ? String(parsed.data.id) : null
  const numero = parsed.data?.numero != null ? String(parsed.data.numero) : undefined
  const situacao = parsed.data?.situacao != null ? String(parsed.data.situacao) : undefined
  if (!nfeId || !args.transmit) return { nfeId, numero, situacao, transmitted: false }

  // Transmissão ao SEFAZ (envio). Falha aqui não invalida a nota criada (rascunho).
  try {
    const send = await blingFetch(token, `/nfe/${nfeId}/enviar`, { method: 'POST' })
    if (!send.ok) {
      const t = await send.text()
      return { nfeId, numero, situacao, transmitted: false, error: `envio_${send.status}: ${t.slice(0, 200)}` }
    }
    return { nfeId, numero, situacao, transmitted: true }
  } catch (e) {
    return { nfeId, numero, situacao, transmitted: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type BlingSaleOrder = {
  id: string
  numero: string
  data: string // YYYY-MM-DD
  totalCents: number
  situacaoId: number | null
}

/**
 * Lista pedidos de venda do Bling num intervalo de datas (paginado).
 * `dataInicial`/`dataFinal` no formato YYYY-MM-DD. Cap de páginas para não
 * estourar latência — devolve o que conseguiu coletar.
 */
export async function blingListSaleOrders(
  token: string,
  opts: { dataInicial: string; dataFinal: string; maxPages?: number },
): Promise<BlingSaleOrder[]> {
  const maxPages = Math.max(1, Math.min(20, opts.maxPages ?? 10))
  const out: BlingSaleOrder[] = []
  for (let pagina = 1; pagina <= maxPages; pagina++) {
    const qs = new URLSearchParams({
      dataInicial: opts.dataInicial,
      dataFinal: opts.dataFinal,
      limite: '100',
      pagina: String(pagina),
    }).toString()
    const res = await blingFetch(token, `/pedidos/vendas?${qs}`)
    const text = await res.text()
    if (!res.ok) throw new Error(`bling_pedidos_list_${res.status}: ${text.slice(0, 200)}`)
    let parsed: { data?: Array<Record<string, unknown>> } = {}
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      parsed = {}
    }
    const rows = Array.isArray(parsed.data) ? parsed.data : []
    for (const r of rows) {
      out.push({
        id: String(r.id ?? ''),
        numero: String(r.numero ?? ''),
        data: String(r.data ?? '').slice(0, 10),
        totalCents: Math.round(num(r.total) * 100),
        situacaoId: (r.situacao as { id?: number } | undefined)?.id ?? null,
      })
    }
    if (rows.length < 100) break
  }
  return out
}

/** Cria um pedido de venda no Bling. Retorna o id do pedido criado. */
export async function blingCreateOrder(token: string, payload: Record<string, unknown>): Promise<string | null> {
  const res = await blingFetchWithRetry(token, `/pedidos/vendas`, { method: 'POST', body: JSON.stringify(payload) })
  const text = await res.text()
  if (!res.ok) throw new Error(`bling_pedido_${res.status}: ${text.slice(0, 300)}`)
  let parsed: { data?: { id?: number | string } } = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = {}
  }
  return parsed.data?.id != null ? String(parsed.data.id) : null
}
