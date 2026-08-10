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

/**
 * Traduz um corpo de erro do Bling na mensagem que o operador precisa ler.
 *
 * O motivo REAL nunca está no topo do JSON: `message` é sempre genérico ("Não foi possível
 * emitir a nota fiscal") e o que interessa mora em `error.fields[].msg`. Guardar o JSON cru
 * cortado em N chars esconde exatamente essa parte — foi o que aconteceu em 25/jul/2026:
 * 10 notas falharam com `"fields":[{"code":9,"msg":"Há` e o resto da frase se perdeu, sem
 * como saber o que o Bling recusou. Extrair os `msg` antes de truncar resolve na origem.
 */
export function blingErrorMessage(status: number, body: string): string {
  try {
    const e = (JSON.parse(body)?.error ?? {}) as {
      message?: string
      description?: string
      fields?: Array<{ code?: number; msg?: string; element?: string }>
    }
    const campos = (e.fields ?? [])
      .map((f) => [f.element, f.msg].filter(Boolean).join(': '))
      .filter(Boolean)
      .join(' | ')
    const texto = [e.message, campos || e.description].filter(Boolean).join(' — ')
    return texto ? `${texto} (HTTP ${status})` : `HTTP ${status}: ${body.slice(0, 500)}`
  } catch {
    return `HTTP ${status}: ${body.slice(0, 500)}`
  }
}

/**
 * Lista TODOS os produtos, paginando.
 *
 * `blingListProducts` busca uma página só (100 itens). Como o `buildBlingCatalog` usava
 * essa função e depois SUBSTITUÍA o `catalog_cache` inteiro pelo resultado, abrir o
 * /bi-vendas encolhia o catálogo de 156 para 100 produtos, e esse cache é compartilhado
 * com a loja do site e com o bot de vendas. Os 56 que sobravam de fora sumiam até o
 * keepalive do site reescrever.
 *
 * Devolve `truncado` para quem escreve poder decidir entre substituir e mesclar: nunca se
 * deve substituir um catálogo inteiro por uma leitura que se sabe incompleta.
 */
export async function blingListAllProducts(
  token: string,
  opts?: { maxPaginas?: number },
): Promise<{ produtos: Array<Record<string, unknown>>; truncado: boolean }> {
  const maxPaginas = Math.max(1, Math.min(50, opts?.maxPaginas ?? 20))
  const todos: Array<Record<string, unknown>> = []
  for (let pagina = 1; pagina <= maxPaginas; pagina += 1) {
    const lote = await blingListProducts(token, { limite: 100, pagina })
    todos.push(...lote)
    if (lote.length < 100) return { produtos: todos, truncado: false }
  }
  console.warn(`[bling] catálogo parou no teto de ${maxPaginas} páginas; leitura incompleta.`)
  return { produtos: todos, truncado: true }
}

/** Lista produtos de UMA página (catálogo + saldo de estoque quando disponível). */
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
  /** EAN/GTIN do produto — usado p/ casar item da NF-e ao produto do Bling na importação. */
  gtin?: string
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
    const { produtos: raw, truncado } = await blingListAllProducts(token)
    const ids = raw.map((p) => String(p.id ?? '')).filter(Boolean)
    const stock = await blingStockMap(token, ids)
    // Imagens já no cache (populadas pelo keepalive do site, que faz fetch detalhado): preserva
    // por id quando a listagem não traz a foto — assim a reescrita do bot NÃO apaga as imagens.
    const priorImg = new Map(
      cache.map((c) => [c.id, typeof c.imagem === 'string' ? c.imagem : '']).filter(([, v]) => v),
    )
    const priorGtin = new Map(
      cache.map((c) => [c.id, typeof c.gtin === 'string' ? c.gtin : '']).filter(([, v]) => v),
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
        gtin: String(p.gtin ?? '') || priorGtin.get(id) || '',
      }
    })
    // TRAVA CONTRA ENCOLHIMENTO. Este cache é compartilhado com a loja do site e com o bot;
    // substituí-lo por uma leitura incompleta tira produto do ar. Se a leitura veio truncada
    // ou trouxe MENOS itens do que já havia, os que faltam são preservados do cache anterior
    // em vez de sumirem. Só uma leitura completa pode remover produto.
    const porId = new Map(items.map((i) => [i.id, i]))
    let finais = items
    if (truncado || items.length < cache.length) {
      const preservados = cache.filter((c) => !porId.has(c.id))
      finais = [...items, ...preservados]
      console.warn(
        `[bling] catálogo veio com ${items.length} itens contra ${cache.length} em cache` +
          `${truncado ? ' (leitura truncada)' : ''}; ${preservados.length} preservados para não sumirem do bot e da loja.`,
      )
    }
    const nowIso = new Date().toISOString()
    await admin.from('tenant_integrations').upsert({
      tenant_id: tenantId,
      bling: { ...cfg, catalog_cache: finais, catalog_fetched_at: nowIso },
    })
    return { items: finais, fetchedAt: nowIso, fromCache: false }
  } catch {
    return { items: cache, fetchedAt, fromCache: true }
  }
}

/**
 * Formas de pagamento cadastradas na conta do Bling, com cache em
 * tenant_integrations.bling.formas_cache.
 *
 * Os ids NÃO são fixos (mudam por conta/ambiente), então nada de hardcode: resolvemos pela
 * API e guardamos. `tipoPagamento`: 3 = crédito, 4 = débito, 17 = Pix.
 * Best-effort: em erro devolve o cache (ou vazio) — nunca derruba a venda.
 */
export type BlingFormaPagamento = { id: string; descricao: string; tipoPagamento: number }

async function blingFormasPagamento(
  admin: SupabaseClient,
  tenantId: string,
  token: string,
  maxAgeMs = 24 * 3_600_000,
): Promise<BlingFormaPagamento[]> {
  const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
  const cache = Array.isArray(cfg.formas_cache) ? (cfg.formas_cache as BlingFormaPagamento[]) : []
  const fetchedAt = typeof cfg.formas_fetched_at === 'string' ? cfg.formas_fetched_at : null
  if (cache.length && fetchedAt && Date.now() - Date.parse(fetchedAt) < maxAgeMs) return cache

  try {
    const res = await fetch('https://api.bling.com.br/Api/v3/formas-pagamentos?limite=100', {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    })
    if (!res.ok) return cache
    const raw = (JSON.parse((await res.text()) || '{}')?.data ?? []) as Array<Record<string, unknown>>
    const items: BlingFormaPagamento[] = raw
      .filter((f) => Number(f.situacao ?? 1) === 1)
      .map((f) => ({
        id: String(f.id ?? ''),
        descricao: String(f.descricao ?? ''),
        tipoPagamento: Number(f.tipoPagamento ?? 0),
      }))
      .filter((f) => f.id)
    if (!items.length) return cache
    await admin.from('tenant_integrations').upsert({
      tenant_id: tenantId,
      bling: { ...cfg, formas_cache: items, formas_fetched_at: new Date().toISOString() },
    })
    return items
  } catch {
    return cache
  }
}

/**
 * Cria a CONTA A RECEBER da venda e, quando a taxa do gateway é conhecida, já dá a BAIXA pelo
 * líquido recebido.
 *
 * Descoberto em 29/jul/2026 conferindo o caixa com o Kauan: dos 21 pedidos que o nosso sistema
 * criou no Bling entre 20 e 29/jul, **nenhum** tinha conta a receber — contra 62 de 70 lançados
 * à mão pela equipe. O pedido via API nasce "Em aberto" e o Bling NÃO gera o financeiro sozinho,
 * então toda venda automática ficava invisível no financeiro do Bling. Não era o valor que
 * estava errado: a venda simplesmente não existia lá pra conferir.
 *
 * A conta guarda o valor BRUTO (o que o cliente pagou = o que sai na NF-e). A taxa da adquirente
 * entra como `tarifa` na baixa, então o Bling mostra recebido líquido + tarifa e o caixa fecha
 * contra o extrato SEM mexer no valor da venda nem da nota — taxa de cartão é despesa
 * financeira, não desconto na mercadoria.
 *
 * `feeCents` null (modalidade sem taxa cadastrada) → cria a conta e deixa EM ABERTO pra baixa
 * manual/pelo extrato. Melhor conta em aberto do que baixa com taxa chutada.
 *
 * `idOrigem`/vínculo com o pedido é READ-ONLY na API (só o Bling preenche quando ele mesmo gera
 * o financeiro), por isso a rastreabilidade vai em `numeroDocumento` + `historico` com o número
 * do pedido. Best-effort: nunca derruba a venda.
 */
async function blingEnsureReceivable(
  token: string,
  args: {
    contatoId: string
    amountCents: number
    feeCents: number | null
    dataISO: string
    orderNumber: string
    formaPagamentoId: string | null
    /** Texto do lançamento. Omitido = "Venda <nº> — automática (CRM)". */
    historico?: string
  },
): Promise<{ receivableId: string | null; settled: boolean }> {
  const bh = { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' }
  const valor = Math.round(args.amountCents) / 100
  if (!(valor > 0) || !args.contatoId) return { receivableId: null, settled: false }
  try {
    const body: Record<string, unknown> = {
      vencimento: args.dataISO,
      dataEmissao: args.dataISO,
      valor,
      contato: { id: Number(args.contatoId) || args.contatoId },
      historico: (args.historico || `Venda ${args.orderNumber || '?'} — automática (CRM)`).slice(0, 200),
      ...(args.orderNumber ? { numeroDocumento: String(args.orderNumber).slice(0, 20) } : {}),
      ...(args.formaPagamentoId ? { formaPagamento: { id: Number(args.formaPagamentoId) || args.formaPagamentoId } } : {}),
    }
    const res = await fetch(`${API_BASE}/contas/receber`, { method: 'POST', headers: bh, body: JSON.stringify(body) })
    if (!res.ok) {
      console.warn('[bling] conta a receber falhou:', res.status, (await res.text()).slice(0, 200))
      return { receivableId: null, settled: false }
    }
    const receivableId = String((JSON.parse((await res.text()) || '{}')?.data ?? {}).id ?? '')
    if (!receivableId) return { receivableId: null, settled: false }

    // Sem taxa conhecida: conta fica em aberto de propósito (ver doc acima).
    const fee = args.feeCents == null ? null : Math.max(0, Math.round(args.feeCents))
    if (fee == null || fee >= Math.round(args.amountCents)) return { receivableId, settled: false }

    // valorPago + tarifa = valor da conta → o Bling zera o saldo e marca como baixada.
    const baixa = {
      data: args.dataISO,
      valorPago: Math.round(args.amountCents - fee) / 100,
      juros: 0,
      desconto: 0,
      acrescimo: 0,
      tarifa: fee / 100,
      historico: `Recebido líquido (taxa da adquirente) — venda ${args.orderNumber || '?'}`.slice(0, 200),
    }
    const br = await fetch(`${API_BASE}/contas/receber/${receivableId}/baixar`, {
      method: 'POST', headers: bh, body: JSON.stringify(baixa),
    })
    if (!br.ok) {
      console.warn('[bling] baixa da conta falhou:', br.status, (await br.text()).slice(0, 200))
      return { receivableId, settled: false }
    }
    return { receivableId, settled: true }
  } catch (e) {
    console.warn('[bling] conta a receber falhou:', e instanceof Error ? e.message : String(e))
    return { receivableId: null, settled: false }
  }
}

/**
 * Lança uma CONTA A RECEBER avulsa — dinheiro que entrou SEM pedido de venda novo.
 *
 * Existe por causa da ASSINATURA: o plano trimestral cobra R$160,59 TODO MÊS mas só manda
 * produto a cada 3 ciclos. Como o pedido no Bling só nascia no ciclo de envio, os ciclos 2 e 3
 * não deixavam rastro NENHUM no Bling — nem pedido, nem financeiro (Kauan, 30/jul/2026:
 * "esse não foi pro Bling"). Não é caso de criar pedido: não sai mercadoria nesses meses, e um
 * pedido a mais baixaria estoque que não saiu e sujaria a NF-e. O que falta é só o financeiro.
 *
 * Mesma política de baixa do `blingEnsureReceivable`: com a taxa conhecida, baixa pelo líquido
 * (a taxa vai em `tarifa`); sem taxa, a conta fica EM ABERTO pra baixa manual — nunca chuta.
 *
 * Best-effort: devolve `{ receivableId: null }` em vez de estourar, mas o caller DEVE gravar o
 * desfecho (ver `asaas_subscriptions.last_fin_*`) — conta que não entrou tem que aparecer em
 * algum lugar, senão vira o mesmo buraco silencioso de antes.
 */
export async function blingRecordReceivable(
  admin: SupabaseClient,
  tenantId: string,
  args: {
    amountCents: number
    /** Taxa do gateway (centavos). `null`/omitido = desconhecida → conta fica em aberto. */
    feeCents?: number | null
    /** Data do lançamento/vencimento (YYYY-MM-DD). Omitida = hoje no fuso de Brasília. */
    dateISO?: string
    historico: string
    /** Vai em `numeroDocumento` — é o que dá pra rastrear (o vínculo com pedido é read-only). */
    numeroDocumento?: string
    /** 'pix' | 'card' → forma de pagamento real no Bling. Omitido = padrão da conta. */
    paymentMethod?: string
    installments?: number
    customerName?: string; phone?: string; cpf?: string; email?: string
  },
): Promise<{ receivableId: string | null; settled: boolean; contatoFallback: boolean }> {
  const token = await getValidBlingToken(admin, tenantId)
  if (!token) throw new Error('bling_nao_conectado')

  const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
  let contatoId = cfg.default_contato_id != null ? String(cfg.default_contato_id).trim() : ''
  if (!contatoId) throw new Error('bling_default_contato_nao_configurado')

  // Contato REAL do cliente (o mesmo do pedido de envio, casado por telefone/CPF). Sem endereço:
  // conta a receber não emite nota, então não precisa do cadastro fiscal completo.
  let contatoFallback = false
  if (args.customerName) {
    const realId = await blingFindOrCreateContato(token, {
      nome: args.customerName, phone: args.phone, cpf: args.cpf, email: args.email,
    })
    if (realId) contatoId = realId
    else contatoFallback = true
  }

  let formaPagamentoId: string | null = null
  if (args.paymentMethod) {
    const formas = await blingFormasPagamento(admin, tenantId, token)
    formaPagamentoId = pickBlingFormaPagamento(formas, args.paymentMethod, args.installments ?? 1)
    if (!formaPagamentoId) console.warn('[bling] forma de pagamento não resolvida p/', args.paymentMethod, args.installments)
  }

  const dataISO = args.dateISO && /^\d{4}-\d{2}-\d{2}$/.test(args.dateISO)
    ? args.dateISO
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

  const out = await blingEnsureReceivable(token, {
    contatoId,
    amountCents: Math.round(args.amountCents),
    feeCents: args.feeCents ?? null,
    dataISO,
    orderNumber: args.numeroDocumento ?? '',
    formaPagamentoId,
    historico: args.historico,
  })
  return { ...out, contatoFallback }
}

/**
 * Escolhe a forma de pagamento que corresponde ao MÉTODO REAL da venda.
 * Pix → tipo 17. Cartão → o "Nx" exato; sem ele, cai no crédito à vista e, por último,
 * em qualquer forma de crédito (melhor um cartão genérico do que a conta genérica).
 * Devolve null quando não dá pra afirmar nada — aí o pedido segue com o padrão do Bling.
 */
export function pickBlingFormaPagamento(
  formas: BlingFormaPagamento[],
  method: string | null | undefined,
  installments = 1,
): string | null {
  if (!formas.length) return null
  const m = String(method ?? '').trim().toLowerCase()
  if (m === 'pix') {
    const pix = formas.find((f) => f.tipoPagamento === 17) ?? formas.find((f) => /pix/i.test(f.descricao))
    return pix?.id ?? null
  }
  if (m !== 'card' && m !== 'credit_card' && m !== 'cartao') return null

  const credito = formas.filter((f) => f.tipoPagamento === 3)
  if (!credito.length) return null
  const n = Math.max(1, Math.min(12, Math.round(Number(installments) || 1)))
  // `/\bà vista\b/` NÃO funciona: `\b` do JS é fronteira de [A-Za-z0-9_] e `à` fica de fora, então
  // "Cartão de Crédito à vista" não casava e TODA venda 1x caía no primeiro crédito da lista
  // (que é "Cartão de Crédito 10x", ordenada alfabeticamente pelo Bling). Basta procurar "vista".
  const aVista = credito.find((f) => /vista/i.test(f.descricao))
  if (n <= 1) return (aVista ?? credito[0]).id
  const exata = credito.find((f) => new RegExp(`(^|\\D)${n}x(\\D|$)`, 'i').test(f.descricao))
  return (exata ?? aVista ?? credito[0]).id
}

// Mapa padrão kit -> frascos a abater (compra 3→4º grátis; compra 5→6º grátis).
const DEFAULT_KIT_BOTTLES: Record<string, number> = { '1_mes': 1, '3_meses': 4, '5_meses': 6 }
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
  '3_meses': 'Tricopill 3 meses (3+1 = 4 frascos)',
  '5_meses': 'Tricopill 5 meses (5+1 = 6 frascos)',
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

export async function blingFindOrCreateContato(
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

  // Endereço (geral) p/ NF-e — já resolvido pelo caller (entrega + ViaCEP). Usado tanto para
  // ATUALIZAR um contato já existente quanto para criar um novo: a NF-e EXIGE rua + bairro.
  const e = args.endereco ?? {}
  const cepDigits = String(e.cep ?? '').replace(/\D/g, '')
  const enderecoGeral = cepDigits.length === 8 && e.rua && e.municipio && e.uf
    ? {
        endereco: String(e.rua).slice(0, 90),
        numero: String(e.numero ?? 'S/N').slice(0, 20),
        complemento: String(e.complemento ?? '').slice(0, 60),
        bairro: String(e.bairro ?? '').slice(0, 60),
        cep: cepDigits,
        municipio: String(e.municipio).slice(0, 60),
        uf: String(e.uf).toUpperCase().slice(0, 2),
      }
    : null

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
        if (match?.id != null) {
          const id = String(match.id)
          // Contato JÁ existe: garante endereço+bairro (NF-e exige). Bling não tem PATCH em
          // contatos → GET + PUT preservando os campos; só mexe se faltar rua/bairro. Best-effort.
          if (enderecoGeral) {
            try {
              const curRes = await blingFetchWithRetry(token, `/contatos/${id}`)
              const cur = (JSON.parse((await curRes.text()) || '{}')?.data ?? null) as Record<string, unknown> | null
              const g = ((cur?.endereco as { geral?: Record<string, unknown> } | undefined)?.geral) ?? {}
              const gCep = String(g.cep ?? '').replace(/\D/g, '')
              // NF-e exige rua + bairro + CEP + município. Atualiza se QUALQUER um faltar —
              // não só rua/bairro: contato antigo com rua+bairro mas SEM CEP / com cidade
              // errada fazia a NF-e rejeitar por CEP×cidade (caso Selma/Cidade Gaúcha, 30/jun/2026).
              const faltaNfe = !String(g.endereco ?? '').trim() || !String(g.bairro ?? '').trim()
                || gCep.length !== 8 || !String(g.municipio ?? '').trim()
              if (cur && faltaNfe) {
                await blingFetchWithRetry(token, `/contatos/${id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    nome: cur.nome, tipo: cur.tipo ?? 'F', situacao: cur.situacao ?? 'A',
                    numeroDocumento: cur.numeroDocumento, telefone: cur.telefone, celular: cur.celular, email: cur.email,
                    endereco: { geral: enderecoGeral },
                  }),
                })
              }
            } catch { /* não quebra a venda */ }
          }
          return id
        }
      }
    } catch {
      // segue
    }
  }

  // 2) Cria com DEGRADAÇÃO graduada: tenta o cadastro completo; se a API recusar a
  // estrutura (ex.: dadosAdicionais), tenta sem ela mas com CPF/e-mail; por fim o mínimo.
  // Assim, no pior caso ainda cria o contato no nome certo.
  // Telefone NACIONAL: tira o DDI 55 (senão "554484031689" → slice(-11) virava "54484031689",
  // DDD inválido, o Bling recusa e a criação do contato falha → pedido cai no genérico).
  // Celular só quando for mobile de 11 dígitos (senão o Bling reprova o campo celular).
  let tel = phoneDigits
  if (tel.length >= 12 && tel.startsWith('55')) tel = tel.slice(2)
  const base: Record<string, unknown> = { nome, tipo: 'F', situacao: 'A' }
  if (tel.length >= 10) {
    base.telefone = tel
    if (tel.length === 11) base.celular = tel
  }
  const withDoc: Record<string, unknown> = { ...base }
  if (cpf.length === 11) withDoc.numeroDocumento = cpf
  if (email) withDoc.email = email

  // Endereço (geral) p/ NF-e — computado acima (enderecoGeral, com rua+bairro do ViaCEP).
  const withEndereco: Record<string, unknown> = { ...withDoc }
  if (enderecoGeral) withEndereco.endereco = { geral: enderecoGeral }

  const dados: Record<string, unknown> = {}
  if (nascimento) dados.dataNascimento = nascimento
  if (sexo) dados.sexo = sexo
  const full: Record<string, unknown> = Object.keys(dados).length ? { ...withEndereco, dadosAdicionais: dados } : { ...withEndereco }

  // Último recurso SEM telefone (nome + CPF): se o telefone for o problema, ainda cria o
  // contato no nome/CPF certo em vez de cair no genérico.
  const minimal: Record<string, unknown> = { nome, tipo: 'F', situacao: 'A' }
  if (cpf.length === 11) minimal.numeroDocumento = cpf
  if (email) minimal.email = email

  const seen = new Set<string>()
  // Degradação: completo (c/ endereço) → c/ doc → c/ telefone → mínimo (nome+CPF, sem fone).
  const bodies = [full, withEndereco, withDoc, base, minimal]
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
    /** Frete (centavos) cobrado à parte → vai em transporte.frete; o valor do produto = amount − frete. */
    freightCents?: number
    /** Carrinho multi-itens (loja): cada item vira uma linha com seu produto cadastrado no Bling. */
    items?: Array<{ id?: unknown; nome?: unknown; qty?: unknown; precoCents?: unknown; kit?: unknown }>
    /** Venda AVULSA (sem kit): descrição livre do item (ex.: "Tricopill + Shampoo"). */
    description?: string
    /**
     * Data/hora REAL da venda (ISO, ex.: paid_at do pagamento). O pedido no Bling herda ESTA
     * data (no fuso de Brasília), não a de criação do pedido. Sem isto, um pedido criado depois
     * (ex.: religado quando o endereço completa no dia seguinte) saía com a data errada
     * (caso João Guerreiro: venda 09/07, pedido criado 10/07 → Bling marcava 10/07).
     */
    saleDateISO?: string
    /** Força a quantidade de frascos (ex.: envio de assinatura = 1 ou 3). Ignora o mapa de kit. */
    bottlesOverride?: number
    /**
     * Método REAL do pagamento ('pix' | 'card') → vira a forma de pagamento da parcela no Bling.
     * Sem isto o pedido nascia com a forma PADRÃO da conta ("Conta a receber/pagar") e o
     * financeiro não conseguia separar Pix de cartão pra fechar o caixa contra o extrato da
     * Rede (reclamação do Kauan, 29/jul/2026). Omitido = mantém o padrão do Bling.
     */
    paymentMethod?: string
    /** Parcelas do cartão — escolhe "Cartão de Crédito Nx" em vez do genérico à vista. */
    installments?: number
    /**
     * Taxa da adquirente (centavos) retida nesta venda. Vira `tarifa` na baixa da conta a
     * receber, pra o financeiro fechar o caixa pelo LÍQUIDO sem mexer no valor da venda/NF-e.
     * `null`/omitido = taxa desconhecida → a conta é criada e fica em aberto (nunca chuta).
     */
    feeCents?: number | null
    /**
     * Valor da CONTA A RECEBER, quando é diferente do total do pedido. Só a ASSINATURA usa:
     * o pedido carrega a mercadoria do envio inteiro (3 frascos = R$481,76) mas o dinheiro que
     * entrou NESTE mês é uma mensalidade (R$160,59). Lançar o pedido inteiro como recebido
     * inflava o mês do envio e zerava os outros dois (caso Chayenne: junho lançou R$481,76
     * quando entraram R$160,59). Omitido = `amountCents` (venda à vista normal).
     */
    receivableAmountCents?: number
    /** Texto do lançamento financeiro. Omitido = "Venda <nº> — automática (CRM)". */
    receivableHistorico?: string
    /** Endereço de entrega capturado p/ completar o contato (NF-e) + modalidade da venda. */
    entrega?: {
      cep?: string; numero?: string; complemento?: string
      bairro?: string; logradouro?: string; cidade?: string; uf?: string
      delivery_mode?: string
    }
  },
): Promise<{
  orderId: string | null
  /** QUANTIDADE DA LINHA do pedido no Bling. Vale 1 quando a venda sai no produto próprio do
   *  kit (a composição do Bling é que abate os N frascos). Não use para falar com o cliente. */
  bottles: number
  /** Frascos de Tricopill que a venda REPRESENTA (kit 3+1 = 4). É este o número que vai em
   *  mensagem/relatório; `bottles` mente sempre que o pedido sai no produto do kit. */
  frascos: number
  /** Linhas do pedido. Carrinho só de catálogo (shampoo etc.) tem `frascos` 0 e `itens` > 0. */
  itens: number
  /** true: o contato REAL não pôde ser criado/achado e o pedido saiu no contato GENÉRICO. */
  contatoFallback: boolean
  nfe?: { nfeId: string | null; numero?: string; situacao?: string; transmitted: boolean; error?: string }
  /** Conta a receber criada no Bling; `settled` = já baixada pelo líquido (taxa conhecida). */
  receivable: { receivableId: string | null; settled: boolean }
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

  // Frete cobrado à parte: vai em transporte.frete; o VALOR DO PRODUTO = total − frete.
  const freightCents = Math.max(0, Math.round(Number(args.freightCents) || 0))
  const produtoReais = Math.max(0, Math.round(args.amountCents) - freightCents) / 100
  let productId: string
  let bottles: number // quantidade da linha do pedido
  let valorUnit: number
  if (kitProductId) {
    // KIT com produto próprio: 1 unidade do produto do kit (estoque abate o base pela composição).
    productId = kitProductId
    bottles = 1
    valorUnit = Math.round(produtoReais * 100) / 100
  } else {
    // Avulso / assinatura (bottlesOverride) / kit sem produto: frasco INDIVIDUAL (00001) × frascos.
    productId = individualProductId
    bottles = overrideBottles || (hasKit ? (Number(bottlesMap[args.kit] ?? DEFAULT_KIT_BOTTLES[args.kit] ?? 1) || 1) : 1)
    valorUnit = Math.round((produtoReais / bottles) * 100) / 100
  }
  const itemDescricao = hasKit
    ? (KIT_LABEL[args.kit] ?? `Tricopill ${args.kit}`)
    // Sem kit: produto INDIVIDUAL cadastrado (00001) com o nome real — nunca "venda avulsa".
    : (args.description?.trim() || 'Tricopill - Suplemento Capilar')

  // Itens do pedido: CARRINHO multi-itens (loja) → cada produto cadastrado no Bling vira 1 linha
  // (kit → produto do kit; bump/avulso → individual 00001; catálogo → id do próprio item). Senão,
  // 1 item (kit ou individual). Nunca "venda avulsa" / produto fora do catálogo.
  const cartItens = (Array.isArray(args.items) ? args.items : []).map((it) => {
    const kitKey = typeof it.kit === 'string' ? it.kit : (String(it.id ?? '').startsWith('kit:') ? String(it.id).slice(4) : '')
    let prodId: string
    if (kitKey === 'bump_frasco') prodId = individualProductId
    else if (kitKey) prodId = String(kitProductIds[kitKey] ?? DEFAULT_KIT_PRODUCT_IDS[kitKey] ?? individualProductId).trim()
    else prodId = String(Number(it.id) || it.id || '')
    return { produto: { id: Number(prodId) || prodId }, descricao: String(it.nome ?? 'Produto').slice(0, 120), quantidade: Number(it.qty) || 1, valor: Math.round(Number(it.precoCents) || 0) / 100 }
  }).filter((x) => x.produto.id)
  const itens = cartItens.length
    ? cartItens
    : [{ produto: { id: Number(productId) || productId }, descricao: itemDescricao, quantidade: bottles, valor: valorUnit }]

  // Frascos REAIS da venda (o que o cliente leva), separado de `bottles` (linha do pedido).
  // Quando o pedido sai no produto próprio do kit, a linha é 1 e quem abate os 4/6 frascos é a
  // composição do Bling — usar `bottles` na mensagem fazia o 3+1 aparecer como "1 frascos"
  // (caso Carla Regina, 10/ago). Item de catálogo que não é Tricopill não conta frasco.
  const kitFrascos = (k: string): number => Number(bottlesMap[k] ?? DEFAULT_KIT_BOTTLES[k] ?? 0) || 0
  const frascos = cartItens.length
    ? (Array.isArray(args.items) ? args.items : []).reduce((soma, it) => {
      const kitKey = typeof it.kit === 'string' ? it.kit : (String(it.id ?? '').startsWith('kit:') ? String(it.id).slice(4) : '')
      const qty = Number(it.qty) || 1
      if (kitKey === 'bump_frasco') return soma + qty
      return soma + kitFrascos(kitKey) * qty
    }, 0)
    : (overrideBottles || (hasKit ? (kitFrascos(args.kit) || 1) : 1))

  // ACRÉSCIMO (pago MAIOR que os itens): juros do parcelado no cartão. O total cobrado do
  // cliente (produtoReais) fica ACIMA do preço de tabela dos itens. Antes a diferença era
  // simplesmente descartada e o pedido saía menor que o recebido (caso João Guerreiro 09/07:
  // pedido R$697,00 vs cartão R$707,55), quebrando a NF-e (a nota precisa do valor EXATO da
  // venda). Correção: rateia o acréscimo nos itens (proporcional; o último absorve o resíduo do
  // arredondamento) para que a soma feche EXATAMENTE no valor cobrado — assim o pedido E a NF-e
  // saem no valor certo. Simétrico ao desconto do Pix logo abaixo.
  {
    const itensTotalAntes = itens.reduce((s, x) => s + (Number(x.valor) || 0) * (Number(x.quantidade) || 1), 0)
    if (itensTotalAntes > 0 && produtoReais - itensTotalAntes > 0.05) {
      const fator = produtoReais / itensTotalAntes
      let acc = 0
      itens.forEach((it, idx) => {
        const q = Number(it.quantidade) || 1
        if (idx < itens.length - 1) {
          it.valor = Math.round((Number(it.valor) || 0) * fator * 100) / 100
          acc += it.valor * q
        } else {
          // Último item fecha a conta: valor unitário = (total − já acumulado) / quantidade.
          it.valor = Math.round(((produtoReais - acc) / q) * 100) / 100
        }
      })
    }
  }

  // Desconto do pedido: itens do CARRINHO vêm com preço CHEIO de tabela, mas o valor PAGO
  // (produtoReais) pode ser menor (Pix 5% off do site, cupom). Sem registrar a diferença como
  // desconto, o pedido no Bling sai MAIOR que o recebido e trava a conferência do financeiro
  // (caso Thiago 03/07: pedido R$999,00 vs Pix pago R$949,05). Pago MAIOR que os itens (juros
  // de cartão) já foi rateado nos itens acima, então aqui descontoReais fica ~0.
  const itensTotalReais = itens.reduce((s, x) => s + (Number(x.valor) || 0) * (Number(x.quantidade) || 1), 0)
  const descontoReais = Math.round((itensTotalReais - produtoReais) * 100) / 100

  // Data do pedido (YYYY-MM-DD, fuso de Maringá/Brasília). O Bling EXIGE `data` —
  // sem ela recusa com "A data para geração das parcelas é inválida". Usa a data REAL da venda
  // (saleDateISO, ex.: paid_at) quando informada; senão, o momento atual. Assim um pedido criado
  // depois da venda (religamento por endereço, retry, cron) ainda sai com a data da venda.
  const saleDate = args.saleDateISO ? new Date(args.saleDateISO) : null
  const dataBase = saleDate && !isNaN(saleDate.getTime()) ? saleDate : new Date()
  const dataPedido = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(dataBase)
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
    ...(freightCents > 0 ? { transporte: { frete: Math.round(freightCents) / 100, fretePorConta: 1 } } : {}),
    ...(descontoReais > 0.05 ? { desconto: { valor: descontoReais, unidade: 'REAL' } } : {}),
    itens,
  }
  const orderId = await blingCreateOrder(token, payload)

  // TOTAL DO PEDIDO = VALOR COBRADO, sempre (decisão do Álvaro, 20/jul — "opção B").
  // Produto de KIT tem preço fixo no cadastro do Bling e ele IGNORA o valor de item que a
  // gente manda (casos Jean/Fernando 19/07: cobrado R$635,96/633,35 no 12x, pedido gravado
  // R$626,45/623,88 — a diferença é o juros do parcelado que o rateio acima não consegue
  // colar no item de kit). Conferimos o total que o Bling GRAVOU e, se ficou abaixo do
  // cobrado, lançamos a diferença em `outrasDespesas` via GET+PUT (Bling não tem PATCH).
  // A NF-e continua saindo por itens+frete (sem o encargo financeiro — correto fiscalmente).
  // Best-effort: nunca derruba a venda.
  // O mesmo GET+PUT também carimba a FORMA DE PAGAMENTO real (Pix / Cartão Nx) nas parcelas —
  // o pedido é criado sem `parcelas` (deixar o Bling gerar evita o erro "somatório das parcelas
  // difere do total"), então a forma só dá pra ajustar depois que ele gravou.
  let receivable: { receivableId: string | null; settled: boolean } = { receivableId: null, settled: false }
  if (orderId) {
    try {
      const bh = { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' }
      const gr = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`, { headers: bh })
      if (gr.ok) {
        const od = (JSON.parse((await gr.text()) || '{}')?.data ?? {}) as Record<string, unknown>
        const parc = Array.isArray(od.parcelas) ? (od.parcelas as Array<Record<string, unknown>>) : []
        let mustPut = false

        const chargedReais = Math.round(args.amountCents) / 100
        const totalBling = Number(od.total ?? 0)
        const diff = Math.round((chargedReais - totalBling) * 100) / 100
        // Sanidade: só corrige diferenças plausíveis de juros/arredondamento (até R$100).
        if (totalBling > 0 && diff > 0.05 && diff < 100) {
          od.outrasDespesas = Math.round(((Number(od.outrasDespesas) || 0) + diff) * 100) / 100
          // O Bling valida que as PARCELAS somam o total: joga a diferença na última.
          if (parc.length) {
            const last = parc[parc.length - 1]
            last.valor = Math.round(((Number(last.valor) || 0) + diff) * 100) / 100
          }
          mustPut = true
        }

        if (parc.length && args.paymentMethod) {
          const formas = await blingFormasPagamento(admin, tenantId, token)
          const formaId = pickBlingFormaPagamento(formas, args.paymentMethod, args.installments ?? 1)
          if (formaId) {
            for (const p of parc) p.formaPagamento = { id: Number(formaId) || formaId }
            mustPut = true
          } else {
            console.warn('[bling] forma de pagamento não resolvida p/', args.paymentMethod, args.installments)
          }
        }

        if (mustPut) {
          const pr = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${orderId}`, {
            method: 'PUT', headers: bh, body: JSON.stringify(od),
          })
          if (!pr.ok) console.warn('[bling] ajuste do pedido falhou:', pr.status, (await pr.text()).slice(0, 200))
        }

        // Financeiro: o pedido criado por API NÃO gera conta a receber sozinho — sem isto a
        // venda automática fica invisível no financeiro do Bling (21 de 21 pedidos nossos
        // estavam assim em 20-29/jul). Vai com o valor BRUTO; a taxa entra na baixa.
        receivable = await blingEnsureReceivable(token, {
          contatoId,
          // Assinatura: a conta é a MENSALIDADE recebida, não o pedido inteiro (ver doc do arg).
          amountCents: Math.round(args.receivableAmountCents ?? args.amountCents),
          feeCents: args.feeCents ?? null,
          dataISO: dataPedido,
          orderNumber: String(od.numero ?? ''),
          formaPagamentoId: parc.length
            ? String(((parc[0].formaPagamento ?? {}) as Record<string, unknown>).id ?? '') || null
            : null,
          historico: args.receivableHistorico,
        })
      }
    } catch (e) {
      console.warn('[bling] conferência total × cobrado falhou:', e instanceof Error ? e.message : String(e))
    }
  }

  // NF-e automática (gated): só quando o tenant habilitou (auto_nfe_enabled) E configurou a
  // natureza de operação (natureza_operacao_id). Emitir nota é AÇÃO FISCAL irreversível — por
  // isso fica OFF por padrão e a transmissão ao SEFAZ exige auto_nfe_transmit=true. Sem CPF
  // não tenta (nota PF exige CPF). Best-effort: nunca derruba a venda.
  let nfe: { nfeId: string | null; numero?: string; situacao?: string; transmitted: boolean; error?: string } | undefined
  const cpfOk = String(args.cpf ?? '').replace(/\D/g, '').length === 11
  if (orderId && cfg.auto_nfe_enabled === true && cfg.natureza_operacao_id && cpfOk) {
    // A NF-e sai pelos ITENS (a API /nfe não herda o desconto do pedido): com desconto
    // (Pix 5% do site, cupom), prorrateia nos valores unitários pra nota fechar no valor
    // REALMENTE RECEBIDO — nota acima do recebido é passivo fiscal. O último item absorve
    // o resíduo do arredondamento.
    let nfeItens = payload.itens as Array<{ produto: { id: number | string }; descricao: string; quantidade: number; valor: number }>
    if (descontoReais > 0.05 && itensTotalReais > 0) {
      const fator = produtoReais / itensTotalReais
      let acumulado = 0
      nfeItens = nfeItens.map((x, i) => {
        const qty = Number(x.quantidade) || 1
        const ultimo = i === nfeItens.length - 1
        // Último item: resíduo arredondado PARA BAIXO — a nota pode fechar 1-2 centavos
        // abaixo do recebido (ok), nunca acima (passivo fiscal).
        const valor = ultimo
          ? Math.floor(((produtoReais - acumulado) / qty) * 100) / 100
          : Math.round((Number(x.valor) || 0) * fator * 100) / 100
        if (!ultimo) acumulado += valor * qty
        return { ...x, valor }
      })
    }
    nfe = await blingEmitNfe(token, {
      naturezaOperacaoId: String(cfg.natureza_operacao_id),
      contatoId,
      itens: nfeItens,
      observacoes: obs,
      transmit: cfg.auto_nfe_transmit === true,
      dataOperacaoISO: args.saleDateISO,
      descontoReais: descontoReais > 0.05 ? descontoReais : 0,
      contatoNome: args.customerName,
    }).catch((e) => ({ nfeId: null, transmitted: false, error: e instanceof Error ? e.message : String(e) }))
  }
  return { orderId, bottles, frascos, itens: itens.length, contatoFallback, nfe, receivable }
}

/**
 * Rótulo do pedido pra mensagem no chat: "#123, 4 frascos". Carrinho só de catálogo (shampoo,
 * Grandha) não tem frasco de Tricopill — aí conta itens em vez de mentir "1 frascos".
 */
export function blingOrderLabel(out: { orderId: string | null; frascos: number; itens: number }): string {
  const id = `#${out.orderId ?? '?'}`
  if (out.frascos > 0) return `${id}, ${out.frascos} ${out.frascos === 1 ? 'frasco' : 'frascos'}`
  return `${id}, ${out.itens} ${out.itens === 1 ? 'item' : 'itens'}`
}

/**
 * Cria (e opcionalmente transmite) uma NF-e no Bling a partir dos itens/contato do pedido.
 * Bling auto-preenche a tributação a partir do cadastro fiscal do PRODUTO + da natureza de
 * operação informada. `transmit=false` deixa a nota em rascunho pro operador conferir e
 * transmitir num clique. Requer `natureza_operacao_id` configurado no tenant.
 *
 * Rateia o desconto do pedido (Pix 5%, cupom) NOS ITENS da NF-e.
 *
 * Por que não manda `desconto` no corpo da nota: o Bling ACEITA o campo (200, sem erro) e
 * simplesmente IGNORA — a nota sai com o preço de tabela. Descoberto no caso Thiago (03/07):
 * venda de R$949,05 virava nota de R$999. Já o `valor` do item ele respeita, então o
 * desconto entra por ali. Mesma tática do rateio de juros em blingCreateSaleOrder.
 *
 * O último item absorve o resíduo de centavos, garantindo total == valor cobrado.
 */
function descontarItens(
  itens: Array<Record<string, unknown>>,
  descontoReais: number,
): Array<Record<string, unknown>> {
  if (!descontoReais || descontoReais <= 0 || itens.length === 0) return itens
  const bruto = itens.reduce(
    (s, i) => s + (Number(i.valor) || 0) * (Number(i.quantidade) || 1),
    0,
  )
  if (bruto <= 0 || descontoReais >= bruto) return itens
  const fator = (bruto - descontoReais) / bruto
  let acumulado = 0
  return itens.map((i, idx) => {
    const qtd = Number(i.quantidade) || 1
    const ultimo = idx === itens.length - 1
    const subtotal = ultimo
      ? Number((bruto - descontoReais - acumulado).toFixed(2))
      : Number(((Number(i.valor) || 0) * qtd * fator).toFixed(2))
    acumulado += subtotal
    return { ...i, valor: Number((subtotal / qtd).toFixed(2)) }
  })
}

/**
 * Monta o bloco `contato` da NF-e a partir do cadastro no Bling.
 * POST /nfe com só `{ id }` NÃO copia nome/CPF/endereço — a nota sai sem destinatário
 * (caso 25/jul/2026: NFs 000103–000110 em rascunho com Nome vazio, contato ok no pedido).
 */
async function blingContatoPayloadForNfe(
  token: string,
  contatoId: string,
  nomeFallback?: string,
): Promise<Record<string, unknown>> {
  const idNum = Number(contatoId) || contatoId
  const base: Record<string, unknown> = { id: idNum }
  try {
    const res = await blingFetchWithRetry(token, `/contatos/${contatoId}`)
    if (!res.ok) return base
    const cur = (JSON.parse((await res.text()) || '{}')?.data ?? {}) as Record<string, unknown>
    const nome = String(cur.nome ?? '').trim() || String(nomeFallback ?? '').trim()
    const doc = String(cur.numeroDocumento ?? '').replace(/\D/g, '')
    const tipo = String(cur.tipo ?? 'F').toUpperCase().slice(0, 1) || 'F'
    if (nome) base.nome = nome.slice(0, 120)
    if (doc) base.numeroDocumento = doc
    base.tipoPessoa = tipo
    const tel = String(cur.telefone ?? cur.celular ?? '').trim()
    const email = String(cur.email ?? '').trim()
    if (tel) base.telefone = tel.slice(0, 30)
    if (email) base.email = email.slice(0, 60)
    const g = ((cur.endereco as { geral?: Record<string, unknown> } | undefined)?.geral) ?? {}
    const rua = String(g.endereco ?? '').trim()
    const cep = String(g.cep ?? '').replace(/\D/g, '')
    if (rua && cep.length === 8) {
      base.endereco = {
        endereco: rua.slice(0, 90),
        numero: String(g.numero ?? 'S/N').slice(0, 20),
        complemento: String(g.complemento ?? '').slice(0, 60),
        bairro: String(g.bairro ?? '').slice(0, 60),
        cep,
        municipio: String(g.municipio ?? '').slice(0, 60),
        uf: String(g.uf ?? '').toUpperCase().slice(0, 2),
      }
    }
  } catch {
    if (nomeFallback?.trim()) base.nome = nomeFallback.trim().slice(0, 120)
  }
  return base
}

export async function blingEmitNfe(
  token: string,
  args: {
    naturezaOperacaoId: string
    contatoId: string
    itens: Array<Record<string, unknown>>
    observacoes?: string
    transmit?: boolean
    /** Data da venda (ISO). A NF-e sai com a data real, não com a de hoje. */
    dataOperacaoISO?: string
    /** Desconto do pedido em REAIS (ex.: os 5% do Pix). Sem isto a nota sai com o preço
     *  de tabela e NÃO bate com o valor cobrado — erro fiscal. */
    descontoReais?: number
    /** Nome do CRM se o cadastro Bling vier vazio (fallback). */
    contatoNome?: string
  },
): Promise<{ nfeId: string | null; numero?: string; situacao?: string; transmitted: boolean; error?: string }> {
  // dataOperacao é OBRIGATÓRIA no Bling e a gente nunca mandava: toda emissão morria em
  // "Data de operação inválida" antes mesmo de chegar no SEFAZ. Formato aceito: YYYY-MM-DD
  // HH:mm:ss no fuso de Brasília.
  const dt = args.dataOperacaoISO ? new Date(args.dataOperacaoISO) : new Date()
  const spDate = new Date(dt.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const pad = (n: number) => String(n).padStart(2, '0')
  const dataOperacao = `${spDate.getFullYear()}-${pad(spDate.getMonth() + 1)}-${pad(spDate.getDate())} ` +
    `${pad(spDate.getHours())}:${pad(spDate.getMinutes())}:${pad(spDate.getSeconds())}`

  const contato = await blingContatoPayloadForNfe(token, args.contatoId, args.contatoNome)
  if (!String(contato.nome ?? '').trim()) {
    throw new Error('contato_sem_nome: o destinatário da NF-e precisa de nome no Bling')
  }

  const payload: Record<string, unknown> = {
    tipo: 1, // 1 = saída
    finalidade: 1, // 1 = NF-e normal
    dataOperacao,
    naturezaOperacao: { id: Number(args.naturezaOperacaoId) || args.naturezaOperacaoId },
    contato,
    itens: descontarItens(args.itens, args.descontoReais ?? 0),
    ...(args.observacoes ? { observacoes: args.observacoes } : {}),
  }
  // Retry obrigatório: o Bling corta em 3 req/s e uma emissão gasta 4-6 chamadas (pedido +
  // produto por item + contato + nota + envio). Em lote, o 429 caía justo aqui e a linha
  // morria com "bling_nfe_429" (caso Kauan 25/jul/2026) — ver blingFetchWithRetry.
  const res = await blingFetchWithRetry(token, '/nfe', { method: 'POST', body: JSON.stringify(payload) })
  const text = await res.text()
  if (!res.ok) throw new Error(blingErrorMessage(res.status, text))
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
    const send = await blingFetchWithRetry(token, `/nfe/${nfeId}/enviar`, { method: 'POST' })
    if (!send.ok) {
      const t = await send.text()
      return { nfeId, numero, situacao, transmitted: false, error: blingErrorMessage(send.status, t) }
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
 * `dataInicial`/`dataFinal` no formato YYYY-MM-DD.
 *
 * O teto era 10 páginas de 100 (1.000 pedidos) e o Bling ordena do mais recente para o
 * mais antigo, então o botão "12 meses" do BI mostrava R$ 389.158,87 em 1.000 pedidos
 * quando o real eram R$ 927.310,89 em 2.281 (23 páginas): a tela dizia 12 meses e cobria 5.
 * Como o corte era silencioso, o número parecia completo.
 *
 * O teto continua existindo (é uma API externa e a Edge Function tem limite de tempo), mas
 * agora é alto o bastante para o uso real e o estouro é DENUNCIADO: quem chama recebe
 * `truncado: true` e mostra a ressalva em vez de exibir um total menor com cara de fechado.
 */
export async function blingListSaleOrders(
  token: string,
  opts: { dataInicial: string; dataFinal: string; maxPages?: number },
): Promise<BlingSaleOrder[]> {
  const { orders } = await blingListSaleOrdersDetalhado(token, opts)
  return orders
}

export async function blingListSaleOrdersDetalhado(
  token: string,
  opts: { dataInicial: string; dataFinal: string; maxPages?: number },
): Promise<{ orders: BlingSaleOrder[]; truncado: boolean; paginasLidas: number }> {
  const maxPages = Math.max(1, Math.min(60, opts.maxPages ?? 40))
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
    // Página incompleta = fim do conjunto. Se o laço terminar pelo teto, quem chama
    // precisa saber que o total está cortado.
    if (rows.length < 100) return { orders: out, truncado: false, paginasLidas: pagina }
  }
  console.warn(`[bling] listagem de pedidos parou no teto de ${maxPages} páginas; o total pode estar truncado.`)
  return { orders: out, truncado: true, paginasLidas: maxPages }
}

/**
 * Número VISÍVEL do pedido (o que aparece na tela do Bling). A criação só devolve o
 * id interno da API (26275181279), que não acha nada na busca do Bling — o financeiro
 * procura pelo `numero` (3306). Best-effort: null se o GET falhar.
 */
export async function blingGetOrderNumero(token: string, orderId: string): Promise<string | null> {
  try {
    const res = await blingFetch(token, `/pedidos/vendas/${orderId}`)
    if (!res.ok) return null
    const parsed = JSON.parse((await res.text()) || '{}') as { data?: { numero?: number | string } }
    return parsed.data?.numero != null ? String(parsed.data.numero) : null
  } catch {
    return null
  }
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
