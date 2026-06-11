import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

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

  // Expirado: renova.
  const tok = await postToken({ grant_type: 'refresh_token', refresh_token: refresh })
  await persistTokens(admin, tenantId, tok)
  return tok.access_token ?? null
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
  return await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })
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
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
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

/** Cria um pedido de venda no Bling. Retorna o id do pedido criado. */
export async function blingCreateOrder(token: string, payload: Record<string, unknown>): Promise<string | null> {
  const res = await blingFetch(token, `/pedidos/vendas`, { method: 'POST', body: JSON.stringify(payload) })
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
