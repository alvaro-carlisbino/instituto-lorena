import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { quoteGatewayFee } from './gatewayFees.ts'
import { insertInteraction, recordAutoReceipt } from './crm.ts'
import { normalizeKitKey } from './pagbank.ts'
import { incrementCouponUse, quoteCoupon } from './coupons.ts'
import { blingCreateSaleOrder, blingOrderLabel } from './bling.ts'
import { sendEmail } from './resend.ts'
import { internalSaleEmail, orderConfirmEmail, TEAM_EMAIL } from './emails.ts'
import { autoShipToCart, notaSemEtiqueta, type FreteExtra } from './melhorEnvio.ts'
import { sendSaleReceiptToGroup } from './saleReceipt.ts'
import { dispatchPurchaseConversions } from './conversions.ts'
import { getCheckoutBaseUrl, getTenantBrand } from './tenantBrand.ts'

const PIX_QR_IMAGE_BASE = (Deno.env.get('PIX_QR_IMAGE_BASE') ?? 'https://api.qrserver.com/v1/create-qr-code/').trim()

/**
 * Gera a imagem do QR Code Pix a partir do copia-e-cola (EMV) e devolve um DATA URI base64
 * (data:image/png;base64,...). A e.Rede raramente devolve a imagem do QR, e a W-API só aceita
 * imagem como base64 OU URL terminada em .png/.jpg — a URL do gerador (com query string) é
 * REJEITADA ("A URL da imagem deve ser nos formatos .png/.jpeg/.jpg"). Por isso baixamos o PNG
 * e mandamos em base64. Best-effort: devolve '' se o gerador falhar (o copia-e-cola no texto da
 * mensagem já resolve o pagamento). O PNG do QR é ~1KB, então o base64 trafega tranquilo no JSON.
 */
export async function pixQrImageDataUri(emv: string): Promise<string> {
  try {
    const sep = PIX_QR_IMAGE_BASE.includes('?') ? '&' : '?'
    const url = `${PIX_QR_IMAGE_BASE}${sep}size=400x400&margin=12&format=png&data=${encodeURIComponent(emv)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return ''
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length === 0) return ''
    let bin = ''
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!)
    return `data:image/png;base64,${btoa(bin)}`
  } catch {
    return ''
  }
}

/**
 * Kits do Tricopill no CARTÃO (e.Rede) — preço CHEIO, sem o desconto de 5% do Pix.
 * Espelha REDE_KIT_AMOUNTS do frontend (PaymentLinksPage). amountCents em centavos.
 */
export const REDE_KITS: Record<string, { label: string; amountCents: number; qty: number }> = {
  '1_mes': { label: 'Tricopill — 1 frasco (1 mês)', amountCents: 19900, qty: 1 },
  '3_meses': { label: 'Tricopill — compra 3 + 1 grátis (4 frascos)', amountCents: 59700, qty: 4 },
  '5_meses': { label: 'Tricopill — compra 5 + 1 grátis (6 frascos)', amountCents: 99500, qty: 6 },
}

/**
 * Upsell do Shampoo Ozonizado. Vai como item próprio no pedido do Bling (id real → baixa o
 * estoque do shampoo).
 *
 * Preço = catálogo Bling (R$130,00). Ficou em R$119,90 aqui por ~3 semanas depois do Bling
 * subir pra R$130: o bot vendia mais barato que o site e que o PDV, que leem do catálogo.
 * Se mudar de novo, alinhe os TRÊS: aqui, o prompt do crm-ai-assistant (o valor que a IA
 * FALA) e o Bling. O site e o PDV se ajustam sozinhos.
 */
export const SHAMPOO_ADDON = {
  blingProductId: '16675535462',
  nome: 'Shampoo Ozonizado Multifuncional - Ozoncare 200ml',
  amountCents: 13000,
}

/**
 * Gel de sobrancelha BrowSculpt (13/08/2026) — marca PRÓPRIA (Health & Beauty), igual ao
 * Tricopill: fabricação New Concept, rótulo e registro ANVISA nossos. R$129,90, custo R$32,90.
 */
export const BROWSCULPT_ADDON = {
  blingProductId: '16691834812',
  nome: 'Gel de Sobrancelha BrowSculpt 10ml',
  amountCents: 12990,
}

/**
 * Produtos AVULSOS que o bot pode vender além dos kits do Tricopill. A chave é o campo que a
 * IA manda no op (`"shampoo":1`, `"gel_sobrancelha":1`) — junto com o kit ou sozinho.
 *
 * Produto novo aqui = uma linha. Mas o preço vive em 3 lugares: AQUI (o que é COBRADO), o
 * prompt do crm-ai-assistant (o que a IA FALA) e o Bling (o que o site e o PDV leem). Mexeu
 * num, mexa nos três — foi assim que o shampoo passou 3 semanas cobrando menos que o site.
 */
export const AI_ADDONS: Record<string, {
  blingProductId: string
  nome: string
  amountCents: number
  labelCurto: string
  /** Peso/medidas do cadastro no Bling — entram no frete e na etiqueta (ver boxForOrder). */
  box: { weightKg: number; lengthCm: number; widthCm: number; heightCm: number }
}> = {
  shampoo: {
    ...SHAMPOO_ADDON,
    labelCurto: 'Shampoo Ozonizado',
    box: { weightKg: 0.25, lengthCm: 18, widthCm: 11, heightCm: 6 },
  },
  gel_sobrancelha: {
    ...BROWSCULPT_ADDON,
    labelCurto: 'Gel BrowSculpt',
    box: { weightKg: 0.05, lengthCm: 16, widthCm: 11, heightCm: 2 },
  },
}

/**
 * Caixa PADRÃO de produto de CATÁLOGO (a revenda que o bot passou a vender sob demanda em
 * 18/08/2026). O `catalog_cache` do Bling só guarda id/nome/preço/estoque/código — não traz peso
 * nem dimensão —, então não há caixa medida pra esses 60+ itens.
 *
 * Os números aqui são os MESMOS que a loja do site já usa (DEF em tricopill-frete) pra despachar
 * exatamente esses produtos. Copiar a régua da loja é de propósito: se o bot cotasse por outra
 * conta, ele prometeria um frete que a loja não cobra, e a diferença sairia da margem.
 *
 * Marca própria NÃO usa isto — Tricopill, shampoo e gel têm caixa medida em AI_ADDONS.
 */
export const CATALOG_DEFAULT_BOX = { weightKg: 0.3, lengthCm: 16, widthCm: 16, heightCm: 11 }

export type CatalogSaleItem = { id: string; nome: string; amountCents: number; qty: number }
/** Item que não entrou na cobrança. `rotulo` é o que o cliente reconhece; `motivo` é pra log. */
export type CatalogRejeitado = { rotulo: string; motivo: string }

/** minúsculas, sem acento, só letras/números/espaço — pra comparar nome do Bling com o da IA. */
function normNome(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * FORMA do produto (shampoo, condicionador, gel...). Duas formas conhecidas e DIFERENTES no
 * mesmo par nome-da-IA × nome-do-Bling significam produto trocado, por mais que o resto do
 * nome bata: "Shampoo Dry Confort" e "DRY CONFORT CONDICIONADOR" compartilham duas palavras
 * de três e são coisas distintas na prateleira.
 */
const FORMAS: ReadonlyArray<readonly [string, RegExp]> = [
  ['shampoo', /\b(shampoo|shampo)\b/],
  ['condicionador', /\b(condicionador|conditioner)\b/],
  ['mascara', /\b(mascara|mask)\b/],
  ['gel', /\bgel\b/],
  ['oleo', /\b(oleo|oil)\b/],
  ['leavein', /\b(leave in|leavein)\b/],
  ['tonico', /\b(tonico|tonic)\b/],
  ['serum', /\bserum\b/],
  ['sabonete', /\bsabonete\b/],
  ['suplemento', /\b(suplemento|capsula|capsulas)\b/],
  ['pomada', /\b(pomada|cera|pasta)\b/],
  ['protetor', /\b(protetor|fps)\b/],
  ['spray', /\bspray\b/],
]

function formasDe(n: string): Set<string> {
  const out = new Set<string>()
  for (const [chave, re] of FORMAS) if (re.test(n)) out.add(chave)
  return out
}

/**
 * O nome que a IA prometeu ao cliente descreve o mesmo produto do cadastro do Bling?
 *
 * A IA abrevia ("Gel Maxi Bonder" para "MAXI BONDER STYLING GEL - 100g"), então não dá pra
 * exigir igualdade. A régua é: a maioria das palavras da IA aparece no nome do Bling E as
 * formas não se contradizem. Frouxo o bastante pra não recusar venda boa, apertado o bastante
 * pra barrar "Gel Maxi Bonder" virando "GRANDHA STRAIGHT SHAMPOO".
 */
export function nomeConfere(nomeIa: string, nomeBling: string): boolean {
  const a = normNome(nomeIa)
  const b = normNome(nomeBling)
  if (!a || !b) return false
  if (a === b || b.includes(a) || a.includes(b)) return true

  const formasA = formasDe(a)
  const formasB = formasDe(b)
  // Ambos declaram forma e nenhuma coincide → produto trocado, não importa o resto.
  if (formasA.size && formasB.size) {
    let cruza = false
    for (const f of formasA) if (formasB.has(f)) cruza = true
    if (!cruza) return false
  }

  const tokensA = a.split(' ').filter((t) => t.length >= 3)
  if (!tokensA.length) return false
  const tokensB = new Set(b.split(' ').filter(Boolean))
  const batem = tokensA.filter((t) => tokensB.has(t)).length
  return batem >= 2 ? batem / tokensA.length >= 0.6 : tokensA.length === 1 && batem === 1
}

/**
 * Resolve os produtos de CATÁLOGO que a IA pediu no op
 * (`"catalogo":[{"id":"...","nome":"...","qty":1}]`).
 *
 * QUEM DIZ O PREÇO É O SERVIDOR, lendo o mesmo `catalog_cache` que a loja lê. Isso é
 * deliberado: enquanto o preço vinha do texto do prompt, o shampoo passou três semanas sendo
 * vendido pelo bot mais barato que o site (ver SHAMPOO_ADDON).
 *
 * E QUEM DIZ QUE O PRODUTO É AQUELE também é o servidor. O `id` sozinho não bastava: em
 * 28/08/2026 a IA prometeu à Rosana "3 Gels Maxi Bonder (R$ 84,00)" e mandou no op o id do
 * GRANDHA STRAIGHT SHAMPOO (R$ 160,00). O id existia, tinha preço e tinha estoque, então
 * passou nas três travas e o link saiu R$ 733,00 contra os R$ 505,00 combinados na conversa.
 * Agora o op carrega também o NOME que a IA falou, e ele tem que descrever o mesmo produto do
 * cadastro — id trocado vira recusa, não cobrança calada.
 *
 * Recusa também item que não existe, sem preço, sem estoque ou na lista de ocultos do dono
 * (`bling.hidden_ids` — medicação, cadastro substituído, saldo fantasma). Devolve os recusados
 * pra quem chamou poder dizer ao cliente o que não deu, em vez de cobrar errado calado.
 */
export async function collectCatalogItems(
  admin: SupabaseClient,
  tenantId: string,
  op: Record<string, unknown>,
): Promise<{ items: CatalogSaleItem[]; rejeitados: CatalogRejeitado[] }> {
  const pedidos = Array.isArray(op.catalogo) ? (op.catalogo as Array<Record<string, unknown>>) : []
  if (!pedidos.length) return { items: [], rejeitados: [] }

  const { data } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
  const cache = Array.isArray(cfg.catalog_cache) ? (cfg.catalog_cache as Array<Record<string, unknown>>) : []
  const ocultos = new Set(
    (Array.isArray(cfg.hidden_ids) ? cfg.hidden_ids : [])
      .map((h) => (typeof h === 'string' ? h : String((h as { id?: unknown })?.id ?? '')))
      .filter(Boolean),
  )
  const porId = new Map(cache.map((c) => [String(c.id ?? ''), c]))
  // Os avulsos de marca própria têm caixa medida e preço próprio: se a IA mandar um deles aqui,
  // deixa o caminho de AI_ADDONS cuidar, senão o item entraria duas vezes no pedido.
  const daMarca = new Set(Object.values(AI_ADDONS).map((a) => a.blingProductId))

  const items: CatalogSaleItem[] = []
  const rejeitados: CatalogRejeitado[] = []
  for (const pedido of pedidos) {
    const id = String(pedido?.id ?? '').trim()
    const qty = Math.max(0, Math.floor(Number(pedido?.qty) || 0))
    const nomeIa = String(pedido?.nome ?? pedido?.name ?? '').trim()
    if (!id || qty <= 0 || daMarca.has(id)) continue
    const prod = porId.get(id)
    const preco = Number(prod?.preco ?? 0)
    const estoque = Number(prod?.estoque ?? 0)
    // Rótulo do recado: o que o CLIENTE ouviu. Cair no nome do Bling aqui contaria a ele um
    // produto que nunca foi citado na conversa — que é justamente o erro que estamos barrando.
    const rotulo = nomeIa || String(prod?.nome ?? id)
    if (!prod || ocultos.has(id) || !(preco > 0)) {
      rejeitados.push({ rotulo, motivo: !prod ? 'id fora do catálogo' : ocultos.has(id) ? 'produto oculto' : 'sem preço' })
      continue
    }
    // O nome que a IA prometeu tem que ser o do cadastro. Sem nome não há como conferir, e
    // seguir sem conferir é exatamente o buraco do caso Rosana — então recusa.
    if (!nomeConfere(nomeIa, String(prod.nome ?? ''))) {
      console.error('[rede] catálogo: nome da IA não bate com o id', {
        tenantId,
        id,
        nomeIa: nomeIa || '(vazio)',
        nomeBling: String(prod.nome ?? ''),
      })
      rejeitados.push({ rotulo, motivo: nomeIa ? `id aponta para "${String(prod.nome ?? '')}"` : 'op sem nome para conferir' })
      continue
    }
    // Estoque insuficiente: recusa em vez de vender o que não tem pra despachar.
    if (!(estoque >= qty)) {
      rejeitados.push({ rotulo, motivo: `estoque ${estoque} para ${qty}` })
      continue
    }
    items.push({ id, nome: String(prod.nome ?? ''), amountCents: Math.round(preco * 100), qty })
  }
  return { items, rejeitados }
}

/**
 * Traduz os `items` de uma cobrança (kit + avulsos) nos volumes que o frete precisa somar.
 * Casa pelo id do produto no Bling — a linha do kit não tem id e é ignorada aqui (quem
 * dimensiona o kit é o boxForKit).
 */
export function addonExtrasFromItems(items: Array<Record<string, unknown>> | null | undefined): FreteExtra[] {
  if (!Array.isArray(items)) return []
  const porId = new Map(Object.values(AI_ADDONS).map((a) => [a.blingProductId, a]))
  const out: FreteExtra[] = []
  for (const it of items) {
    const id = String(it?.id ?? '')
    const addon = porId.get(id)
    const qty = Math.max(0, Math.floor(Number(it?.qty) || 0))
    if (qty <= 0) continue
    if (addon) out.push({ qty, box: addon.box })
    // Produto de catálogo (revenda): tem id do Bling mas não é avulso de marca própria. Sem isto
    // ele saía do cálculo do frete e o peso ia embora, cotando pelo kit sozinho.
    else if (id) out.push({ qty, box: CATALOG_DEFAULT_BOX })
  }
  return out
}

/** Lê do op quais avulsos foram pedidos e em que quantidade. Ignora zero/negativo/lixo. */
export function collectAddons(op: Record<string, unknown>): Array<{ key: string; qty: number; addon: (typeof AI_ADDONS)[string] }> {
  const out: Array<{ key: string; qty: number; addon: (typeof AI_ADDONS)[string] }> = []
  for (const [key, addon] of Object.entries(AI_ADDONS)) {
    const qty = Math.max(0, Math.floor(Number(op[key]) || 0))
    if (qty > 0) out.push({ key, qty, addon })
  }
  return out
}

/**
 * Parcelamento MÁXIMO no cartão por kit (regra Ingrid 15/jun): só parcela ACIMA de 3
 * frascos, em até 3x sem juros. 1 frasco = só à vista (1x) ou Pix. Kits 3_meses (3+1=4
 * frascos) e 5_meses (5) parcelam até 3x. Aplicado no createRedeIntent (a IA não decide).
 */
// Asaas (gateway atual) parcela COM JUROS até 12x em qualquer kit. (Nome REDE_* mantido por compat.)
export const REDE_KIT_MAX_INSTALLMENTS: Record<string, number> = { '1_mes': 12, '3_meses': 12, '5_meses': 12 }

/**
 * Infere o kit a partir de um valor APROXIMADO (total pago, que pode incluir o frete).
 * Acha o kit cujo preço é <= valor e a diferença (frete) é plausível (<= R$150). Pega o de
 * MAIOR preço que encaixa. Ex.: 61200 (597 + 15 frete) → '3_meses'; 21400 (199 + 15) → '1_mes'.
 * Sem isto, a venda no cartão com frete embutido ficava com kit null e não ia pro Bling.
 */
export function inferRedeKit(approxCents: number): string | null {
  const v = Math.round(Number(approxCents) || 0)
  let best: string | null = null
  let bestPrice = -1
  for (const [key, kit] of Object.entries(REDE_KITS)) {
    const diff = v - kit.amountCents
    if (diff >= 0 && diff <= 15000 && kit.amountCents > bestPrice) {
      best = key
      bestPrice = kit.amountCents
    }
  }
  return best
}

/** Resolve um kit do cartão a partir de uma variação ('3 meses', 'kit3'…). */
export function resolveRedeKit(raw: string): { key: string; label: string; amountCents: number } | null {
  const key = normalizeKitKey(raw)
  const kit = key ? REDE_KITS[key] : undefined
  return kit && key ? { key, label: kit.label, amountCents: kit.amountCents } : null
}

/**
 * e.Rede — transação por CARTÃO (OAuth 2.0 Bearer + v2).
 * Fluxo: o CRM cria uma "cobrança" (rede_payments) e devolve /pagar/<id>; o cliente
 * abre, digita o cartão, e crm-rede-pay autoriza+captura na e.Rede.
 * Config por polo em tenant_integrations.rede: { pv, token, env? } onde
 *   pv    = clientId    (Filiação / PV)
 *   token = clientSecret (Chave de Integração)
 * Auth: clientId+clientSecret -> POST oauth2/token (Basic, grant_type=client_credentials)
 * -> access_token (Bearer, ~24min) -> POST .../v2/transactions com Authorization: Bearer.
 *
 * ATENÇÃO PCI: coletar o cartão na nossa página = escopo PCI. OK para sandbox/teste;
 * para produção com cartão real, migrar para tokenização da Rede (cartão não trafega
 * pelo nosso servidor).
 */

// URLs oficiais e.Rede (confirmadas na doc logada developer.userede.com.br/e-rede).
const REDE_ENDPOINTS = {
  sandbox: {
    token: 'https://rl7-sandbox-api.useredecloud.com.br/oauth2/token',
    tx: 'https://sandbox-erede.useredecloud.com.br/v2/transactions',
    // PIX e.Rede roda na v1 + Basic auth (≠ cartão, que é v2 + Bearer/OAuth).
    pix: 'https://sandbox-erede.useredecloud.com.br/v1/transactions',
  },
  prod: {
    token: 'https://api.userede.com.br/redelabs/oauth2/token',
    tx: 'https://api.userede.com.br/erede/v2/transactions',
    pix: 'https://api.userede.com.br/erede/v1/transactions',
  },
} as const

export type RedeConfig = {
  clientId: string
  clientSecret: string
  env: 'sandbox' | 'prod'
  tokenUrl: string
  txUrl: string
  /** Endpoint v1 usado pelo PIX (Basic auth). */
  pixUrl: string
}

/**
 * Polo "dono" da conta e.Rede. A conta é UMA só (CNPJ do Instituto Lorena) e é
 * compartilhada entre os polos (clínica + Tricopill). Quando um polo não tem PV/Token
 * próprios, cai para a config do dono — assim a clínica cobra no cartão usando a MESMA
 * conta do Tricopill, sem precisar duplicar credenciais.
 */
const REDE_OWNER_TENANT = 'instituto-lorena'

/** Monta a RedeConfig a partir do jsonb `rede` de um polo; null se faltar PV/Token. */
function parseRedeConfig(cfg: Record<string, unknown>): RedeConfig | null {
  // pv = clientId (Filiação) ; token = clientSecret (Chave de Integração)
  const clientId = typeof cfg.pv === 'string' ? cfg.pv.trim() : ''
  const clientSecret = typeof cfg.token === 'string' ? cfg.token.trim() : ''
  if (!clientId || !clientSecret) return null
  const env: 'sandbox' | 'prod' = cfg.env === 'prod' ? 'prod' : 'sandbox'
  const ep = REDE_ENDPOINTS[env]
  const tokenUrl = (typeof cfg.token_url === 'string' && cfg.token_url.trim() ? cfg.token_url.trim() : ep.token).replace(/\/$/, '')
  const txUrl = (typeof cfg.tx_url === 'string' && cfg.tx_url.trim() ? cfg.tx_url.trim() : ep.tx).replace(/\/$/, '')
  const pixUrl = (typeof cfg.pix_url === 'string' && cfg.pix_url.trim() ? cfg.pix_url.trim() : ep.pix).replace(/\/$/, '')
  return { clientId, clientSecret, env, tokenUrl, txUrl, pixUrl }
}

/** Lê e monta a config e.Rede de UM polo específico (sem fallback). */
async function readTenantRede(admin: SupabaseClient, tenantId: string): Promise<RedeConfig | null> {
  if (!tenantId) return null
  const { data } = await admin.from('tenant_integrations').select('rede').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { rede?: Record<string, unknown> } | null)?.rede ?? {}) as Record<string, unknown>
  return parseRedeConfig(cfg)
}

export async function readRedeConfig(admin: SupabaseClient, tenantId: string): Promise<RedeConfig | null> {
  // Config do próprio polo tem prioridade; sem PV/Token, usa a conta do polo dono
  // (e.Rede é uma conta só, compartilhada entre os polos do Instituto Lorena).
  const own = await readTenantRede(admin, tenantId)
  if (own) return own
  if (tenantId !== REDE_OWNER_TENANT) return readTenantRede(admin, REDE_OWNER_TENANT)
  return null
}

// Cache do access_token por (env+clientId), reusado enquanto o isolate estiver quente.
const redeTokenCache = new Map<string, { token: string; expiresAt: number }>()

/** Gera (ou reusa) o access_token OAuth 2.0 (client_credentials). */
async function getRedeAccessToken(cfg: RedeConfig): Promise<string> {
  const key = `${cfg.env}:${cfg.clientId}`
  const now = Date.now()
  const cached = redeTokenCache.get(key)
  if (cached && cached.expiresAt - 60_000 > now) return cached.token

  const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`)
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }
  const token = typeof parsed.access_token === 'string' ? parsed.access_token : ''
  if (!res.ok || !token) {
    const detail = String(parsed.error_description ?? parsed.error ?? text.slice(0, 140))
    throw new Error(`rede_oauth_falhou:${res.status}:${detail}`)
  }
  const expiresInSec = Number(parsed.expires_in) > 0 ? Number(parsed.expires_in) : 1440 // ~24min
  redeTokenCache.set(key, { token, expiresAt: now + expiresInSec * 1000 })
  return token
}

export type RedeIntent = {
  id: string
  tenantId: string
  leadId: string | null
  amountCents: number
  description: string
  installments: number
  status: string
  couponCode: string | null
  kit: string | null
  blingOrderId: string | null
  method: 'card' | 'pix'
  customerName: string | null
  customerDoc?: string | null
  phone?: string | null
  discountCents?: number
  freightCents?: number
  items?: Array<Record<string, unknown>> | null
  /** Momento do pagamento (ISO) → data da venda no pedido do Bling. Fallback: createdAt. */
  paidAt?: string | null
  createdAt?: string | null
}

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

/** Cria uma cobrança e devolve a URL do checkout (/pagar/<id>). */
export async function createRedeIntent(
  admin: SupabaseClient,
  args: {
    tenantId: string
    amountCents: number
    description: string
    leadId?: string
    installments?: number
    couponCode?: string
    freightCents?: number
    kit?: string
    customerName?: string
    /** Telefone do cliente (dígitos) — gravado na cobrança p/ controle e conciliação. */
    phone?: string
    /** CPF do cliente (dígitos) — gravado p/ casar com a NF-e/Bling na conciliação. */
    customerDoc?: string
    /**
     * Onde o pedido nasceu: 'site' (loja), 'whatsapp' (bot), 'manual' (painel). Carimbado aqui
     * porque origem é do PEDIDO, não do cliente — adivinhar pelo lead marcava a recompra pelo
     * site como WhatsApp só porque ele já tinha falado com o bot (caso Thais Ferrero 04/ago).
     */
    origin?: string | null
    /** Itens do pedido (carrinho): kit + extras. Se vier, o pedido no Bling sai por estes itens. */
    items?: Array<Record<string, unknown>> | null
  },
): Promise<{ id: string; url: string; amountCents: number; baseCents: number; discountCents: number; couponCode: string | null; freightCents: number }> {
  const cfg = await readRedeConfig(admin, args.tenantId)
  if (!cfg) throw new Error('rede_nao_configurado')
  // Domínio do polo DONO da cobrança — resolvido aqui dentro, não recebido por parâmetro.
  // Enquanto o chamador mandava a base (env global no bot, window.location.origin no painel),
  // toda cobrança do Tricopill saía no domínio da clínica. Resolvendo antes do INSERT, um
  // polo mal configurado falha limpo em vez de deixar cobrança pendente órfã no banco.
  const checkoutBase = await getCheckoutBaseUrl(admin, args.tenantId)
  const baseCents = Math.round(args.amountCents)
  if (!Number.isFinite(baseCents) || baseCents < 100) throw new Error('rede_valor_invalido')

  // Cupom (best-effort): inválido → valor cheio.
  const coupon = await quoteCoupon(admin, args.tenantId, args.couponCode, baseCents)
  const productCents = coupon.finalCents
  // Frete cobrado à parte, somado ao total (a Rede cobra um único valor).
  const freightCents = Math.max(0, Math.round(Number(args.freightCents ?? 0)))
  const amountCents = productCents + freightCents
  const baseDesc = String(args.description ?? 'Pagamento').slice(0, 100)
  const description = freightCents > 0 ? `${baseDesc} + frete` : baseDesc

  // Parcelas: respeita a regra por kit (1 frasco = 1x; 3+ frascos = até 3x). O kit limita
  // o máximo independentemente do que a IA/UI pedir — a regra de negócio mora aqui.
  let installments = Math.max(1, Math.min(12, args.installments ?? 1))
  const kitCap = args.kit ? REDE_KIT_MAX_INSTALLMENTS[args.kit] : undefined
  if (kitCap) installments = Math.min(installments, kitCap)

  const id = shortId()
  await admin.from('rede_payments').insert({
    id,
    tenant_id: args.tenantId,
    lead_id: args.leadId || null,
    amount_cents: amountCents,
    freight_cents: freightCents,
    description: description.slice(0, 120),
    installments,
    status: 'pending',
    coupon_code: coupon.applied ? coupon.code : null,
    discount_cents: coupon.discountCents,
    kit: args.kit || null,
    items: Array.isArray(args.items) && args.items.length ? args.items : null,
    customer_name: args.customerName?.trim() || null,
    phone: args.phone?.replace(/\D/g, '') || null,
    customer_doc: args.customerDoc?.replace(/\D/g, '') || null,
    origin: args.origin ?? null,
  })
  return {
    id,
    url: `${checkoutBase}/pagar/${id}`,
    amountCents,
    baseCents,
    discountCents: coupon.discountCents,
    couponCode: coupon.applied ? coupon.code : null,
    freightCents,
  }
}

/**
 * Cria uma cobrança PIX na e.Rede e devolve o copia-e-cola + imagem do QR.
 * ATENÇÃO: o PIX da e.Rede roda na API **v1 + Basic auth** (base64(PV:token)), DIFERENTE do
 * cartão (v2 + Bearer/OAuth). Contrato confirmado em produção 17/06 (returnCode 00). NÃO
 * finaliza venda — só gera o QR; a confirmação do pagamento é assíncrona (webhook/consulta).
 */
export async function createRedePix(
  admin: SupabaseClient,
  args: {
    tenantId: string
    amountCents: number
    description: string
    leadId?: string
    couponCode?: string
    freightCents?: number
    kit?: string
    customerName?: string
    phone?: string
    customerDoc?: string
    /** Validade do QR em horas (≤ 15 dias). Default 24h. */
    expiresInHours?: number
    origin?: string | null
    /** Itens do pedido (carrinho): kit + extras. Se vier, o pedido no Bling sai por estes itens. */
    items?: Array<Record<string, unknown>> | null
  },
): Promise<{
  id: string; qrText: string; qrImage: string | null; tid: string | null
  amountCents: number; baseCents: number; discountCents: number; couponCode: string | null; freightCents: number
}> {
  const cfg = await readRedeConfig(admin, args.tenantId)
  if (!cfg) throw new Error('rede_nao_configurado')
  const baseCents = Math.round(args.amountCents)
  if (!Number.isFinite(baseCents) || baseCents < 100) throw new Error('rede_valor_invalido')

  // Cupom (best-effort): inválido → valor cheio.
  const coupon = await quoteCoupon(admin, args.tenantId, args.couponCode, baseCents)
  const productCents = coupon.finalCents
  const freightCents = Math.max(0, Math.round(Number(args.freightCents ?? 0)))
  const amountCents = productCents + freightCents
  const baseDesc = String(args.description ?? 'Pagamento').slice(0, 100)
  const description = freightCents > 0 ? `${baseDesc} + frete` : baseDesc

  // RETRY NÃO GERA COBRANÇA NOVA. Quando a resposta da IA sai vazia e engole o link (ou o envio
  // falha), o fluxo tenta de novo em segundos — e antes disso nascia UMA COBRANÇA POR TENTATIVA,
  // deixando `pending` órfã no financeiro (6 clientes em 30 dias; caso Carla Regina 10/ago:
  // 16:44 pending + 16:46 paga, mesmo kit, mesmo valor). Se já existe um Pix PENDENTE IDÊNTICO e
  // recente pro mesmo lead, devolve o MESMO QR em vez de criar outro. Janela curta de propósito:
  // o QR vale 24h, mas só o retry imediato é duplicata — meia hora depois é outra intenção
  // de compra, e aí cobrança nova é o certo.
  const REUSE_WINDOW_MINUTES = 30
  if (args.leadId) {
    const { data: pendentes } = await admin
      .from('rede_payments')
      .select('id, tid, pix_payload, description, kit, freight_cents, coupon_code, items')
      .eq('tenant_id', args.tenantId)
      .eq('lead_id', args.leadId)
      .eq('method', 'pix')
      .eq('status', 'pending')
      .eq('amount_cents', amountCents)
      .gte('created_at', new Date(Date.now() - REUSE_WINDOW_MINUTES * 60_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(5)
    const itemsKey = Array.isArray(args.items) && args.items.length ? JSON.stringify(args.items) : null
    const gemea = ((pendentes ?? []) as Array<Record<string, unknown>>).find((r) =>
      typeof r.pix_payload === 'string' && r.pix_payload
      && String(r.description ?? '') === description.slice(0, 120)
      && String(r.kit ?? '') === String(args.kit || '')
      && Number(r.freight_cents ?? 0) === freightCents
      && String(r.coupon_code ?? '') === String(coupon.applied ? coupon.code : '')
      && (r.items == null ? null : JSON.stringify(r.items)) === itemsKey)
    if (gemea) {
      const qrTextReuso = String(gemea.pix_payload)
      return {
        id: String(gemea.id),
        qrText: qrTextReuso,
        // A e.Rede só devolve a imagem na criação — regenera o PNG do copia-e-cola pra quem
        // consome `qrImage` (tela de links de pagamento) não ficar sem o QR no reuso.
        qrImage: (await pixQrImageDataUri(qrTextReuso)) || null,
        tid: gemea.tid != null ? String(gemea.tid) : null,
        amountCents,
        baseCents,
        discountCents: coupon.discountCents,
        couponCode: coupon.applied ? coupon.code : null,
        freightCents,
      }
    }
  }

  const id = shortId() // 16 hex → reference ≤ 16 alfanuméricos (limite da e.Rede)

  // Expiração do QR (e.Rede exige ≤ 15 dias). Sem timezone, formato YYYY-MM-DDThh:mm:ss.
  const hours = Math.min(24 * 15, Math.max(1, Math.round(args.expiresInHours ?? 24)))
  const exp = new Date(Date.now() + hours * 3_600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateTimeExpiration =
    `${exp.getFullYear()}-${pad(exp.getMonth() + 1)}-${pad(exp.getDate())}T${pad(exp.getHours())}:${pad(exp.getMinutes())}:${pad(exp.getSeconds())}`

  // PIX = v1 + Basic auth (mesmas credenciais do cartão: clientId=PV, clientSecret=token).
  const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`)
  const res = await fetch(cfg.pixUrl, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'pix',
      reference: id,
      amount: String(amountCents), // centavos como STRING (contrato e.Rede v1 Pix)
      qrCode: { dateTimeExpiration },
    }),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }
  const returnCode = String(parsed.returnCode ?? `http_${res.status}`)
  const qr = (parsed.qrCodeResponse ?? {}) as Record<string, unknown>
  const qrText = typeof qr.qrCodeData === 'string' ? qr.qrCodeData : ''
  const qrImageRaw = typeof qr.qrCodeImage === 'string' ? qr.qrCodeImage : ''
  const tid = typeof parsed.tid === 'string' ? parsed.tid : null
  // e.Rede: returnCode "00" = QR gerado. Sem copia-e-cola = falha mesmo com 200.
  if (returnCode !== '00' || !qrText) {
    const detail = String(parsed.returnMessage ?? parsed.message ?? text.slice(0, 160))
    throw new Error(`rede_pix_falhou:${returnCode}:${detail}`)
  }
  // A imagem vem base64 PNG (geralmente sem prefixo) — normaliza p/ data URI exibível.
  const qrImage = qrImageRaw ? (qrImageRaw.startsWith('data:') ? qrImageRaw : `data:image/png;base64,${qrImageRaw}`) : null

  await admin.from('rede_payments').insert({
    id,
    tenant_id: args.tenantId,
    lead_id: args.leadId || null,
    amount_cents: amountCents,
    freight_cents: freightCents,
    description: description.slice(0, 120),
    installments: 1,
    method: 'pix',
    status: 'pending',
    tid,
    pix_payload: qrText,
    coupon_code: coupon.applied ? coupon.code : null,
    discount_cents: coupon.discountCents,
    kit: args.kit || null,
    items: Array.isArray(args.items) && args.items.length ? args.items : null,
    customer_name: args.customerName?.trim() || null,
    phone: args.phone?.replace(/\D/g, '') || null,
    customer_doc: args.customerDoc?.replace(/\D/g, '') || null,
    origin: args.origin ?? null,
  })

  return {
    id,
    qrText,
    qrImage,
    tid,
    amountCents,
    baseCents,
    discountCents: coupon.discountCents,
    couponCode: coupon.applied ? coupon.code : null,
    freightCents,
  }
}

export async function getRedeIntent(admin: SupabaseClient, id: string): Promise<RedeIntent | null> {
  const { data } = await admin
    .from('rede_payments')
    .select('id, tenant_id, lead_id, amount_cents, freight_cents, description, installments, status, coupon_code, discount_cents, kit, bling_order_id, method, customer_name, customer_doc, phone, items, paid_at, created_at')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    leadId: r.lead_id != null ? String(r.lead_id) : null,
    amountCents: Number(r.amount_cents ?? 0),
    description: String(r.description ?? ''),
    installments: Number(r.installments ?? 1),
    status: String(r.status ?? 'pending'),
    couponCode: r.coupon_code != null ? String(r.coupon_code) : null,
    kit: r.kit != null ? String(r.kit) : null,
    blingOrderId: r.bling_order_id != null ? String(r.bling_order_id) : null,
    method: r.method === 'pix' ? 'pix' : 'card',
    customerName: r.customer_name != null ? String(r.customer_name) : null,
    customerDoc: r.customer_doc != null ? String(r.customer_doc) : null,
    phone: r.phone != null ? String(r.phone) : null,
    discountCents: Math.max(0, Math.round(Number(r.discount_cents ?? 0))),
    freightCents: Math.max(0, Math.round(Number(r.freight_cents ?? 0))),
    items: Array.isArray(r.items) ? (r.items as Array<Record<string, unknown>>) : null,
    paidAt: r.paid_at != null ? String(r.paid_at) : null,
    createdAt: r.created_at != null ? String(r.created_at) : null,
  }
}

export type RedeCard = {
  cardholderName: string
  cardNumber: string
  expirationMonth: number
  expirationYear: number
  securityCode: string
}

export type RedePayResult = { status: 'paid' | 'failed'; returnCode: string; message: string; tid: string | null }

/**
 * Confirmação de venda ao cliente — sai pela linha do polo da VENDA.
 *
 * O que havia aqui até 21/ago/26 era um POST direto na W-API escolhendo "a linha ativa do
 * tenant do LEAD". Para quem é paciente da clínica E cliente do Tricopill isso mandava a
 * confirmação do pedido da loja pelo WhatsApp da CLÍNICA (+554491493656): o cliente
 * respondia lá, a conversa migrava de linha e o bot da clínica passava a falar de entrega
 * de suplemento. Caso Antonio Martucci, 21/ago 10:57 — e mais 10 vendas antes dele.
 *
 * Agora vai pelo `crm-send-message`, que já sabe a regra: `senderTenantId` = polo do
 * ASSUNTO (a venda), a linha do lead é ignorada sem apagar o vínculo, `requireBotKind`
 * derruba com 409 se ainda assim resolver para o polo errado, e o envio fica GRAVADO na
 * timeline (o POST cru não gravava nada — a confirmação era invisível no CRM).
 *
 * Falha fechada: polo da venda sem linha ativa não cai na linha do outro polo, não manda.
 */
async function sendSaleConfirmation(
  admin: SupabaseClient,
  args: { leadId: string; saleTenantId: string; text: string },
): Promise<{ ok: boolean; note: string }> {
  const url = (Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/$/, '')
  const serviceRole = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim()
  const tenantId = String(args.saleTenantId || '').trim()
  if (!url || !serviceRole) return { ok: false, note: 'sem credencial de serviço' }
  if (!tenantId) return { ok: false, note: 'venda sem polo resolvido' }
  // O bot_kind esperado é o da linha do polo da VENDA — não um literal 'sales', senão uma
  // cobrança da clínica (cirurgia, protocolo) nunca conseguiria confirmar.
  const { data: linha } = await admin.from('whatsapp_channel_instances')
    .select('bot_kind')
    .eq('tenant_id', tenantId).eq('active', true)
    .order('sort_order', { ascending: true }).limit(1).maybeSingle()
  const requireBotKind = String((linha as { bot_kind?: string } | null)?.bot_kind ?? '').trim().toLowerCase()
  if (!requireBotKind) return { ok: false, note: `polo ${tenantId} sem linha de WhatsApp ativa` }
  try {
    const res = await fetch(`${url}/functions/v1/crm-send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRole}` },
      body: JSON.stringify({
        leadId: args.leadId,
        text: args.text,
        source: 'confirmacao_pagamento',
        senderTenantId: tenantId,
        requireBotKind,
        // A pessoa acabou de pagar e precisa conferir nome/CPF/endereço: é transacional,
        // não abordagem. Sem isto, a compra vinda do SITE (cliente que nunca escreveu na
        // linha) seria classificada como contato novo e a confirmação ficaria retida.
        antiBanKind: 'transactional',
      }),
    })
    if (res.ok) return { ok: true, note: '' }
    return { ok: false, note: (await res.text().catch(() => '')).slice(0, 200) || `http ${res.status}` }
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : String(e) }
  }
}

// Mensagem de confirmação ao cliente: confere nome/CPF/endereço e PEDE o que faltar.
function buildConfirmMsg(a: { nome?: string; cad: Record<string, unknown>; ent: Record<string, unknown>; cpfPayment?: string; pedidoDesc: string; valorBRL: string }): string {
  const cad = a.cad || {}; const ent = a.ent || {}
  const nomeCompleto = String(cad.nomeCompleto ?? a.nome ?? '').trim()
  const first = nomeCompleto.split(/\s+/).filter(Boolean)[0] || 'tudo bem'
  const cpf = String(cad.cpf ?? a.cpfPayment ?? '').replace(/\D/g, '')
  const isPickup = String(ent.delivery_mode ?? '').trim() === 'retirada_clinica'
  const cep = String(ent.cep ?? '').replace(/\D/g, '')
  const numero = String(ent.numero ?? '').trim()
  const rua = String(ent.logradouro ?? '').trim(), bairro = String(ent.bairro ?? '').trim()
  const cidade = String(ent.cidade ?? '').trim(), uf = String(ent.uf ?? '').trim(), compl = String(ent.complemento ?? '').trim()
  const hasNome = nomeCompleto.split(/\s+/).filter(Boolean).length >= 2
  const hasCpf = cpf.length === 11
  const hasEnd = isPickup || (cep.length === 8 && numero.length > 0)
  const header = `Olá ${first}! ✅ Recebemos seu pagamento.\n\nPedido: ${a.pedidoDesc}\nValor: ${a.valorBRL}`
  const faltam: string[] = []
  if (!hasNome) faltam.push('seu *nome completo*')
  if (!hasCpf) faltam.push('seu *CPF*')
  // Pede SÓ o que falta de verdade: com CEP ok (rua/bairro/cidade o sistema resolve
  // sozinho pelo ViaCEP), falta só o número — pedir "endereço completo" de novo é atrito.
  if (!hasEnd) {
    faltam.push(
      cep.length === 8
        ? 'o *número* do seu endereço (e complemento, se tiver)'
        : 'seu *endereço completo* (CEP, rua, número, bairro e cidade)',
    )
  }
  if (faltam.length) {
    return `${header}\n\nPra preparar seu envio e emitir a nota fiscal, preciso confirmar: ${faltam.join(', ')}. Pode me mandar aqui, por favor? 💚`
  }
  const endLinha = isPickup
    ? 'Retirada na clínica (Maringá)'
    : `${rua}, ${numero}${compl ? ' - ' + compl : ''} - ${bairro} - ${cidade}/${uf} - CEP ${cep}`
  const cpfFmt = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return `${header}\n\n*Confira seus dados de entrega:*\n👤 ${nomeCompleto}\n📄 CPF ${cpfFmt}\n📍 ${endLinha}\n\nEstá tudo certo? Se algo estiver errado, é só me responder aqui. 💚`
}

/**
 * Downstream COMPARTILHADO de um pagamento Rede aprovado (cartão OU Pix): conta o cupom,
 * grava o comprovante automático, move o lead p/ "Pago", cria o pedido no Bling e lança o
 * envio no Melhor Envio. Extraído do payRedeIntent p/ o webhook de Pix reusar o MESMO caminho.
 * Tudo best-effort: nunca derruba a confirmação do pagamento.
 */
export async function finalizeRedePaid(
  admin: SupabaseClient,
  intent: RedeIntent,
  opts: {
    method: 'card' | 'pix'
    tid: string | null
    returnCode: string
    installments?: number
    /** Nome do titular do cartão (cartão) — usado como fallback do nome no Bling. */
    cardholderName?: string
  },
): Promise<void> {
  const isPix = opts.method === 'pix'

  // Taxa da adquirente: a API da e.Rede NÃO devolve a taxa da transação (só o extrato tem),
  // então calculamos pela tabela cadastrada em tenant_integrations.rede.fees. Modalidade sem
  // taxa cadastrada devolve null e a conta a receber fica em aberto — nunca chuta. O import do
  // extrato corrige depois com o valor REAL cobrado pela Rede.
  const feeQuote = await quoteGatewayFee(admin, intent.tenantId, 'rede', {
    method: opts.method,
    installments: opts.installments ?? intent.installments,
    amountCents: intent.amountCents,
  })
  if (feeQuote) {
    await admin.from('rede_payments').update({
      fee_cents: feeQuote.feeCents,
      net_cents: feeQuote.netCents,
      fee_source: 'tabela',
    }).eq('id', intent.id)
  }

  // Conta o uso do cupom só agora (no pago), não na geração do link.
  await incrementCouponUse(admin, intent.tenantId, intent.couponCode, intent.id)

  // Comprovante AUTOMÁTICO (e.Rede): TID + código de retorno. Prova de recebimento sem
  // depender de a SDR anexar foto.
  await recordAutoReceipt(admin, {
    tenantId: intent.tenantId,
    paymentId: intent.id,
    paymentMethod: opts.method,
    amountCents: intent.amountCents,
    customerName: intent.customerName ?? opts.cardholderName,
    note: isPix
      ? 'Comprovante automático e.Rede Pix (confirmação do QR).'
      : 'Comprovante automático e.Rede (autorização da maquininha).',
    autoData: {
      gateway: 'rede',
      method: opts.method,
      tid: opts.tid,
      return_code: opts.returnCode,
      ...(isPix ? {} : { installments: opts.installments ?? intent.installments, cardholder_name: opts.cardholderName ?? null }),
      paid_at: new Date().toISOString(),
    },
  })

  // Kit do pedido: quando o link foi gerado "solto" (só nome + valor, sem kit) o pedido no Bling
  // saía como 1 frasco avulso com o valor CHEIO (ex.: R$697 → "Tricopill" qtd 1, caso Bianca 09/07).
  // Deduz o kit pelo valor pago (menos frete) — mesmo mapa do botão manual (crm-bling) — pra sair
  // com o produto/quantidade certos (R$697 → 5_meses = 5 frascos). Carrinho da loja (items) manda a
  // quantidade por item, então não deduz. inferRedeKit devolve null p/ valor fora dos kits → avulso.
  const orderKit = intent.kit
    || ((intent.items && intent.items.length) ? '' : (inferRedeKit((intent.amountCents ?? 0) - (intent.freightCents ?? 0)) ?? ''))

  // LINK AVULSO (sem lead): ainda assim cria o pedido no Bling — pagamento pago sem pedido
  // é venda perdida no fechamento (casos 16/jun + Victor 02/07, links do painel não têm lead).
  // Sem lead não há cadastro/entrega: o contato sai com nome/CPF do próprio pagamento e a
  // equipe completa depois p/ NF-e. Best-effort: nunca derruba a confirmação do pagamento.
  if (!intent.leadId) {
    let receiptBlingId = intent.blingOrderId
    if (!intent.blingOrderId && intent.tenantId === 'tricopill') {
      try {
        const { data: blingRow } = await admin
          .from('tenant_integrations')
          .select('bling')
          .eq('tenant_id', 'tricopill')
          .maybeSingle()
        const blingCfg = ((blingRow as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
        if (blingCfg.auto_order_enabled === true) {
          const out = await blingCreateSaleOrder(admin, 'tricopill', {
            kit: orderKit,
            amountCents: intent.amountCents,
            freightCents: intent.freightCents ?? 0,
            items: intent.items && intent.items.length ? intent.items : undefined,
            description: orderKit ? undefined : String(intent.description ?? 'Pedido Tricopill').trim(),
            customerName: String(intent.customerName || opts.cardholderName || 'Cliente Tricopill').trim(),
            cpf: intent.customerDoc || undefined,
            // Forma de pagamento REAL no Bling (Pix / Cartão Nx) — sem isto o pedido nascia
            // com o padrão da conta ("Conta a receber/pagar") e o caixa não separava por meio.
            paymentMethod: opts.method,
            installments: opts.installments ?? intent.installments,
            // Taxa da adquirente → vira `tarifa` na baixa da conta a receber, pra o caixa
            // fechar pelo LÍQUIDO sem mexer no valor da venda nem da NF-e.
            feeCents: feeQuote?.feeCents ?? null,
            // Data do pedido = quando PAGOU. Nunca usar createdAt (geração do QR/link) —
            // senão PIX gerado ontem e pago hoje sai no Bling com data de ontem (Paula 24/07).
            saleDateISO: intent.paidAt || new Date().toISOString(),
          })
          await admin.from('rede_payments').update({
            bling_order_id: out.orderId ?? null,
            bling_receivable_id: out.receivable.receivableId,
            bling_settled_at: out.receivable.settled ? new Date().toISOString() : null,
          }).eq('id', intent.id)
          receiptBlingId = out.orderId ?? null
        }
      } catch (e) {
        console.warn('[rede] pedido Bling (link sem lead) falhou:', e instanceof Error ? e.message : String(e))
      }
    }
    // Comprovante da venda no grupo do financeiro (best-effort).
    await sendSaleReceiptToGroup(admin, {
      tenantId: orderKit ? 'tricopill' : intent.tenantId,
      paymentId: intent.id,
      gateway: 'e.Rede',
      method: opts.method,
      installments: isPix ? undefined : (opts.installments ?? intent.installments),
      amountCents: intent.amountCents,
      freightCents: intent.freightCents,
      discountCents: intent.discountCents,
      couponCode: intent.couponCode,
      produto: orderKit ? (REDE_KITS[orderKit]?.label ?? intent.description) : intent.description,
      blingOrderId: receiptBlingId,
      transactionId: opts.tid,
      buyer: {
        name: intent.customerName ?? opts.cardholderName,
        cpf: intent.customerDoc,
        phone: intent.phone,
      },
      origem: 'Link de pagamento (sem lead)',
    })
    return
  }
  try {
    const { data: lead } = await admin
      .from('leads')
      .select('id, patient_name, pipeline_id, tenant_id, phone, custom_fields')
      .eq('id', intent.leadId)
      .maybeSingle()
    const l = lead as {
      id: string; patient_name?: string; pipeline_id?: string; tenant_id?: string; phone?: string
      custom_fields?: { cadastro?: Record<string, string> }
    } | null
    if (!l) return

    // O checkout do site não grava CPF/nome no cadastro do lead, mas eles vêm no pagamento
    // (customer_doc/customer_name). Sem isso o Bling cai no contato GENÉRICO e o Melhor Envio
    // vai sem documento. Completa o cadastro do lead a partir do pagamento (merge, best-effort).
    try {
      const cadAtual = ((l.custom_fields as { cadastro?: Record<string, string> } | undefined)?.cadastro ?? {}) as Record<string, string>
      const cadNovo: Record<string, string> = { ...cadAtual }
      if (!cadNovo.cpf && intent.customerDoc) cadNovo.cpf = String(intent.customerDoc)
      if (!cadNovo.nomeCompleto && (intent.customerName || opts.cardholderName)) cadNovo.nomeCompleto = String(intent.customerName || opts.cardholderName)
      if (JSON.stringify(cadNovo) !== JSON.stringify(cadAtual)) {
        const cf = { ...((l.custom_fields as Record<string, unknown>) ?? {}), cadastro: cadNovo }
        await admin.from('leads').update({ custom_fields: cf }).eq('id', l.id)
        ;(l as { custom_fields?: Record<string, unknown> }).custom_fields = cf
      }
    } catch { /* nunca derruba o pagamento por causa do enriquecimento do cadastro */ }

    // Grava o COMPRADOR de volta no rede_payments quando o intent nasceu sem ele (ex.: link de
    // cartão gerado pelo operador sem nome digitado). O código já resolve o nome do lead pra
    // montar o pedido no Bling, mas antes NÃO regravava aqui — então o painel/relatórios/comprovante,
    // que leem customer_name, mostravam "Cliente" mesmo com o lead tendo o nome. [[crm_cadastro_venda_completo]]
    try {
      const cadR = ((l.custom_fields as { cadastro?: Record<string, string> } | undefined)?.cadastro ?? {}) as Record<string, string>
      const resolvedName = String(cadR.nomeCompleto || intent.customerName || opts.cardholderName || l.patient_name || '').trim()
      const resolvedDoc = String(cadR.cpf || intent.customerDoc || '').replace(/\D/g, '')
      const patch: Record<string, unknown> = {}
      if (!intent.customerName && resolvedName) patch.customer_name = resolvedName
      if (!intent.customerDoc && resolvedDoc) patch.customer_doc = resolvedDoc
      if (!intent.phone && l.phone) patch.phone = String(l.phone)
      if (Object.keys(patch).length) await admin.from('rede_payments').update(patch).eq('id', intent.id)
    } catch { /* cosmético — nunca derruba o pagamento */ }

    // Procura a etapa "Pago" do PRÓPRIO pipeline do lead — nunca chuta uma etapa fixa
    // (senão um lead do Instituto cairia na etapa de "Pago" do Tricopill).
    let pagoStageId: string | null = null
    if (l.pipeline_id) {
      const { data: stage } = await admin
        .from('pipeline_stages')
        .select('id')
        .eq('pipeline_id', l.pipeline_id)
        .ilike('name', 'pago%')
        .maybeSingle()
      if (stage?.id) pagoStageId = String(stage.id)
    }
    // Só move de etapa se achou a "Pago" no pipeline certo; senão mantém a etapa atual.
    const leadUpdate: Record<string, unknown> = { temperature: 'hot', updated_at: new Date().toISOString() }
    if (pagoStageId) leadUpdate.stage_id = pagoStageId
    await admin.from('leads').update(leadUpdate).eq('id', l.id)
    const valorBrl = (intent.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    // O CARIMBO DA NOTA SEGUE A VENDA, não o cadastro do lead. `intent.tenantId` já nasce
    // com o tenant da LINHA (o `saleTenantId` do executor) e só cai no tenant do lead
    // quando não há linha — que é exatamente o caso do ManyChat da clínica. Com a ordem
    // invertida (`l.tenant_id ?? intent.tenantId`), confirmação de Pix do Tricopill em
    // paciente da clínica ia parar na timeline da CLÍNICA: 8 notas assim até 21/ago/26,
    // enquanto o pedido do mesmo pagamento ia certo pro Bling da loja.
    // Carimba a NOTA. `blingTenant` (abaixo) decide onde o PEDIDO é criado e hoje segue a
    // MESMA regra — a linha da venda —, porque o carrinho de um lead da clínica não ia pro
    // Bling nenhum enquanto ele seguia o cadastro do lead.
    const saleTenantId = String(intent.kit ? 'tricopill' : (intent.tenantId || l.tenant_id || ''))
    await insertInteraction(admin, {
      leadId: l.id,
      patientName: String(l.patient_name ?? 'Cliente'),
      channel: 'system',
      direction: 'system',
      author: isPix ? 'Rede Pix' : 'Rede',
      content: isPix
        ? `✅ Pagamento via Pix confirmado (Rede). ${valorBrl}.`
        : `💳 Pagamento no cartão confirmado (Rede). ${valorBrl}.`,
      tenantId: saleTenantId,
    })

    // Pedido automático no Bling (best-effort): só se auto_order_enabled, o pagamento
    // tem kit, e ainda não há pedido (idempotente). Espelha o caminho do Pix/PagBank.
    // KIT = produto Tricopill → Bling/ME vivem no tenant 'tricopill', NÃO no tenant do
    // lead. Sem isto, um lead que veio pelo canal da CLÍNICA comprando Tricopill tentava
    // criar o pedido no Bling da clínica (inexistente) e não ia pro Bling (bug Fabricio).
    // O PEDIDO SEGUE A LINHA DA VENDA, igual à nota: `intent.tenantId` é o tenant do
    // pagamento (a linha que vendeu), e só cai no cadastro do lead quando a venda nasceu
    // sem linha. Com a ordem invertida (`l.tenant_id ?? intent.tenantId`) o kit estava
    // coberto, mas o CARRINHO (kit null) de um paciente cadastrado na clínica resolvia
    // 'instituto-lorena', `shouldCreateBlingOrder` virava false e a venda NÃO ia pro Bling
    // — sem pedido, sem baixa de estoque e sem conta a receber (caso Hugo Bongiorno,
    // R$361,60 em 20/ago/26). [[crm_venda_segue_a_linha_nao_a_pessoa]]
    const blingTenant = intent.kit ? 'tricopill' : String(intent.tenantId || l.tenant_id || '')
    // Cria pedido no Bling para KITS Tricopill E para vendas avulsas/carrinho do tenant 'tricopill'.
    // (Antes só criava quando havia `kit`; o carrinho do site salva kit=null e nunca ia pro Bling —
    //  o gateway do site é a e.Rede e o Pix é finalizado por aqui via cron. Espelha finalizeAsaasPaid.)
    const shouldCreateBlingOrder = !!intent.kit || blingTenant === 'tricopill'
    let receiptBlingId = intent.blingOrderId
    if (shouldCreateBlingOrder && !intent.blingOrderId) {
      try {
        const { data: blingRow } = await admin
          .from('tenant_integrations')
          .select('bling')
          .eq('tenant_id', blingTenant)
          .maybeSingle()
        const blingCfg = ((blingRow as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
        if (blingCfg.auto_order_enabled === true) {
          // Nome/CPF/e-mail: prioriza o cadastro capturado na conversa, depois o titular
          // do cartão (pagador real), por fim o pushName do WhatsApp.
          const cad = (l.custom_fields?.cadastro ?? {}) as Record<string, string>
          const out = await blingCreateSaleOrder(admin, blingTenant, {
            kit: orderKit,
            amountCents: intent.amountCents,
            freightCents: intent.freightCents ?? 0,
            // Carrinho da loja: manda CADA item com seu produto cadastrado no Bling (não colapsa
            // num item só). Sem itens, cai no kit/individual.
            items: intent.items && intent.items.length ? intent.items : undefined,
            description: orderKit ? undefined : String(intent.description ?? l.patient_name ?? 'Pedido Tricopill').trim(),
            customerName: String(cad.nomeCompleto || opts.cardholderName || intent.customerName || l.patient_name || 'Cliente Tricopill').trim(),
            phone: l.phone ? String(l.phone) : undefined,
            cpf: cad.cpf || intent.customerDoc || undefined,
            email: cad.email,
            dataNascimento: cad.dataNascimento,
            sexo: cad.sexo,
            entrega: ((l.custom_fields as Record<string, unknown> | undefined)?.entrega as {
              cep?: string; numero?: string; complemento?: string
              bairro?: string; logradouro?: string; cidade?: string; uf?: string; delivery_mode?: string
            }) ?? undefined,
            // Forma de pagamento REAL no Bling (Pix / Cartão Nx) — sem isto o pedido nascia
            // com o padrão da conta ("Conta a receber/pagar") e o caixa não separava por meio.
            paymentMethod: opts.method,
            installments: opts.installments ?? intent.installments,
            // Taxa da adquirente → vira `tarifa` na baixa da conta a receber, pra o caixa
            // fechar pelo LÍQUIDO sem mexer no valor da venda nem da NF-e.
            feeCents: feeQuote?.feeCents ?? null,
            // Data do pedido = quando PAGOU. Nunca usar createdAt (geração do QR/link) —
            // senão PIX gerado ontem e pago hoje sai no Bling com data de ontem (Paula 24/07).
            saleDateISO: intent.paidAt || new Date().toISOString(),
          })
          await admin.from('rede_payments').update({
            bling_order_id: out.orderId ?? null,
            bling_receivable_id: out.receivable.receivableId,
            bling_settled_at: out.receivable.settled ? new Date().toISOString() : null,
          }).eq('id', intent.id)
          receiptBlingId = out.orderId ?? null
          const nfeNote = out.nfe
            ? (out.nfe.transmitted
                ? ` · NF-e ${out.nfe.numero ? '#' + out.nfe.numero + ' ' : ''}transmitida ✅`
                : out.nfe.nfeId
                  ? ` · NF-e gerada (rascunho${out.nfe.error ? ': ' + out.nfe.error : ''}) — transmita no Bling`
                  : ` · NF-e não emitida${out.nfe.error ? ': ' + out.nfe.error : ''}`)
            : ''
          await insertInteraction(admin, {
            leadId: l.id,
            patientName: String(l.patient_name ?? 'Cliente'),
            channel: 'system',
            direction: 'system',
            author: 'Bling',
            content: `📦 Pedido criado no Bling (${blingOrderLabel(out)}).${nfeNote}`,
            tenantId: blingTenant,
          })
        }
      } catch (e) {
        await insertInteraction(admin, {
          leadId: l.id,
          patientName: String(l.patient_name ?? 'Cliente'),
          channel: 'system',
          direction: 'system',
          author: 'Bling',
          content: `⚠️ Não foi possível criar o pedido no Bling automaticamente: ${(e instanceof Error ? e.message : String(e)).slice(0, 180)}`,
          tenantId: blingTenant,
        })
      }
    }

    // Envio automático no Melhor Envio (CARRINHO; best-effort, nunca quebra o pagamento).
    //
    // ORDEM IMPORTA: a instrução operacional (etiqueta / nota de entrega) sai ANTES do
    // comprovante no grupo. As duas são best-effort, mas só esta é escrita no banco — o
    // comprovante depende do W-API, e um W-API pendurado consumia a invocação inteira e
    // levava junto tudo que vinha depois (caso Celso 17/ago). O que a equipe precisa pra
    // separar o pedido não pode ficar atrás de uma chamada externa.
    try {
      const ship = await autoShipToCart(admin, blingTenant, {
        lead: { id: l.id, patient_name: l.patient_name, phone: l.phone, custom_fields: l.custom_fields },
        kit: orderKit || null,
        // Avulsos (shampoo, gel) somam peso na etiqueta — e, quando não há kit, são eles que
        // definem a caixa. Sem isso a etiqueta saía com a caixa do kit (ou a padrão de 1 frasco).
        extras: addonExtrasFromItems(intent.items),
        productName: orderKit ? `Tricopill (${orderKit})` : 'Tricopill',
        productValueCents: intent.amountCents,
        orderRef: intent.id,
        chargedFreightCents: intent.freightCents ?? 0,
      })
      if (ship.ok || ship.skipped || ship.reason) {
        const ent = ((l.custom_fields as Record<string, unknown> | undefined)?.entrega ?? {}) as Record<string, unknown>
        const ster = (v: unknown) => String(v ?? '').trim()
        const endLinha = [
          [ster(ent.logradouro), ster(ent.numero)].filter(Boolean).join(', '),
          ster(ent.complemento), ster(ent.bairro), [ster(ent.cidade), ster(ent.uf)].filter(Boolean).join('/'),
        ].filter(Boolean).join(' - ')
        let content: string
        let author = 'Melhor Envio'
        if (ship.ok) {
          content = `📦 Envio no carrinho do Melhor Envio (#${ship.cartId}). Finalize a compra no painel.`
        } else if (ship.reason === 'entrega_local_maringa' || ship.reason === 'retirada_clinica') {
          // Mesmo texto do religamento (crm-reship), com o nº do pedido carimbado: duas compras
          // pro mesmo endereço precisam gerar notas DIFERENTES, senão o guard de idempotência
          // de lá engole a segunda e a equipe entrega só o primeiro pedido.
          author = 'Logística'
          content = notaSemEtiqueta(ship.reason, endLinha, receiptBlingId ? `#${receiptBlingId}` : '')
        } else {
          content = `📦 Envio NÃO gerado automaticamente (${ship.reason}). Gere pelo botão se for envio externo.`
        }
        await insertInteraction(admin, {
          leadId: l.id, patientName: String(l.patient_name ?? 'Cliente'), channel: 'system', direction: 'system', author,
          content, tenantId: saleTenantId,
        })
      }
    } catch {
      // best-effort: envio nunca derruba o pagamento
    }

    // Comprovante da venda no grupo do financeiro (best-effort, nunca quebra o pagamento).
    {
      const cadR = ((l.custom_fields as Record<string, unknown> | undefined)?.cadastro ?? {}) as Record<string, string>
      const entR = ((l.custom_fields as Record<string, unknown> | undefined)?.entrega ?? {}) as Record<string, unknown>
      await sendSaleReceiptToGroup(admin, {
        tenantId: blingTenant,
        paymentId: intent.id,
        gateway: 'e.Rede',
        method: opts.method,
        installments: isPix ? undefined : (opts.installments ?? intent.installments),
        amountCents: intent.amountCents,
        freightCents: intent.freightCents,
        discountCents: intent.discountCents,
        couponCode: intent.couponCode,
        produto: orderKit ? (REDE_KITS[orderKit]?.label ?? intent.description) : intent.description,
        blingOrderId: receiptBlingId,
        transactionId: opts.tid,
        buyer: {
          name: cadR.nomeCompleto || intent.customerName || opts.cardholderName || l.patient_name,
          cpf: cadR.cpf || intent.customerDoc,
          phone: l.phone || intent.phone,
          email: cadR.email,
          entrega: entR,
        },
      })
    }

    // Marca do polo DONO da cobrança, resolvida UMA vez e usada na confirmação, no e-mail e
    // na conversão. O fallback antigo era o literal "Tricopill", então uma venda da clínica
    // sem descrição virava "Tricopill" na mensagem que o paciente recebia.
    // Se a leitura falhar, cai no id do próprio polo — nunca no nome do outro negócio.
    // Mesma regra do pedido e da nota: a marca é a do polo da VENDA. Invertido
    // (`l.tenant_id` primeiro), a confirmação de uma venda do Tricopill para paciente da
    // clínica era assinada com a marca da clínica — e o e-mail ao cliente saía (ou deixava
    // de sair) pelo remetente do polo errado.
    const brandTenantId = saleTenantId || String(intent.tenantId ?? l.tenant_id ?? '')
    const marca = await getTenantBrand(admin, brandTenantId).catch(() => ({
      tenantId: brandTenantId, appName: brandTenantId, checkoutBaseUrl: '', siteUrl: '', emailFrom: '', supportPhone: '',
    }))

    // Confirmação no WhatsApp ao cliente: confere nome/CPF/endereço e pede o que faltar.
    // Best-effort — nunca derruba o pagamento. (PIX/bot não mandavam nada antes.)
    try {
      const cadMsg = ((l.custom_fields as Record<string, unknown> | undefined)?.cadastro ?? {}) as Record<string, unknown>
      const entMsg = ((l.custom_fields as Record<string, unknown> | undefined)?.entrega ?? {}) as Record<string, unknown>
      const valorBRL = (intent.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      const pedidoDesc = String(intent.description || marca.appName).slice(0, 80)
      const msg = buildConfirmMsg({
        nome: intent.customerName ?? opts.cardholderName ?? undefined,
        cad: cadMsg, ent: entMsg, cpfPayment: intent.customerDoc ?? undefined, pedidoDesc, valorBRL,
      })
      const envio = await sendSaleConfirmation(admin, { leadId: l.id, saleTenantId: brandTenantId, text: msg })
      if (!envio.ok) {
        // Falhar CALADO aqui é o que fazia a confirmação sumir: o POST cru devolvia false e
        // ninguém ficava sabendo. Agora a equipe vê na timeline do polo da venda e manda na mão.
        await insertInteraction(admin, {
          leadId: l.id,
          patientName: String(l.patient_name ?? 'Cliente'),
          channel: 'system',
          direction: 'system',
          author: 'CRM',
          content: `⚠️ Confirmação de pagamento NÃO enviada ao cliente (${envio.note}). Mande pela conversa da linha deste polo.`,
          tenantId: brandTenantId,
        }).catch(() => {})
      }
      // E-mails (Resend): confirmação ao cliente (se houver e-mail) + aviso interno de venda. Best-effort.
      try {
        const nomeEmail = intent.customerName ?? opts.cardholderName ?? undefined
        const cfTop = (l.custom_fields ?? {}) as Record<string, unknown>
        const email = String(cfTop.email ?? (cadMsg as Record<string, unknown>).email ?? '').trim()
        // Ao CLIENTE: só sai assinado pela marca do próprio polo. Polo sem remetente
        // configurado (clínica, enquanto o domínio não é verificado no Resend) não manda —
        // e-mail da clínica assinado "Tricopill" é o vazamento que estamos fechando.
        if (email && marca.emailFrom) {
          const c = orderConfirmEmail({ nome: nomeEmail, cad: cadMsg, ent: entMsg, cpfPayment: intent.customerDoc ?? undefined, pedidoDesc, valorBRL })
          await sendEmail({ to: email, subject: c.subject, html: c.html, from: marca.emailFrom })
        }
        // Aviso INTERNO (equipe, não cliente): segue no remetente padrão, mas com o polo no
        // assunto pra ninguém confundir venda da clínica com venda do Tricopill.
        const ie = internalSaleEmail({ nome: nomeEmail, cad: cadMsg, ent: entMsg, cpfPayment: intent.customerDoc ?? undefined, pedidoDesc, valorBRL, phone: String(l.phone ?? ''), metodo: isPix ? 'PIX' : 'Cartão' })
        await sendEmail({ to: TEAM_EMAIL, subject: `[${marca.appName}] ${ie.subject}`, html: ie.html })
      } catch { /* best-effort: e-mail nunca derruba o pagamento */ }
    } catch { /* best-effort */ }

    // Conversão de COMPRA server-side (funil interno + GA4 + Meta). Captura 100%, PIX incluso.
    await dispatchPurchaseConversions(admin, {
      leadId: l.id,
      valueCents: intent.amountCents,
      orderId: intent.id,
      method: opts.method,
      gateway: 'rede',
      productName: orderKit ? `${marca.appName} (${orderKit})` : String(intent.description || marca.appName),
      phone: l.phone,
      cpf: intent.customerDoc,
    })
  } catch {
    // best-effort
  }
}

/** Autoriza+captura a cobrança na e.Rede com os dados do cartão. */
export async function payRedeIntent(
  admin: SupabaseClient,
  args: { id: string; card: RedeCard; installments?: number },
): Promise<RedePayResult> {
  const intent = await getRedeIntent(admin, args.id)
  if (!intent) throw new Error('cobranca_nao_encontrada')
  if (intent.status === 'paid') return { status: 'paid', returnCode: '00', message: 'Já pago', tid: null }

  const cfg = await readRedeConfig(admin, intent.tenantId)
  if (!cfg) throw new Error('rede_nao_configurado')

  const accessToken = await getRedeAccessToken(cfg)
  const body = {
    capture: true,
    kind: 'credit',
    reference: intent.id,
    amount: intent.amountCents, // centavos
    installments: Math.max(1, Math.min(12, args.installments ?? intent.installments ?? 1)),
    cardholderName: args.card.cardholderName.slice(0, 50),
    cardNumber: args.card.cardNumber.replace(/\D/g, ''),
    expirationMonth: args.card.expirationMonth,
    expirationYear: args.card.expirationYear,
    securityCode: args.card.securityCode.replace(/\D/g, ''),
    // softDescriptor omitido de propósito: o serviço está DESATIVADO na conta e.Rede.
    // Enviar o campo sem o serviço contratado pode fazer a Rede recusar a transação.
    subscription: false,
  }
  const res = await fetch(cfg.txUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }
  const returnCode = String(parsed.returnCode ?? `http_${res.status}`)
  const tid = typeof parsed.tid === 'string' ? parsed.tid : null
  const message = String(parsed.returnMessage ?? parsed.message ?? (res.ok ? 'ok' : text.slice(0, 160)))
  // e.Rede: returnCode "00" = aprovado.
  const approved = returnCode === '00'

  // `method`/`installments` REAIS: uma cobrança criada como Pix e paga no CARTÃO (o cliente abre
  // o /pagar/<id> e digita o cartão) continuava gravada como 'pix' — só status/tid mudavam. O
  // caixa por meio de pagamento mentia e não fechava contra o extrato da Rede (casos Maria Barros
  // 28/07 e Paula Rodrigues 24/07, ambos Credit 1x gravados como Pix). Quem paga define o método.
  const paidInstallments = Math.max(1, Math.min(12, args.installments ?? intent.installments ?? 1))
  await admin
    .from('rede_payments')
    .update({
      status: approved ? 'paid' : 'failed',
      tid,
      return_code: returnCode,
      paid_at: approved ? new Date().toISOString() : null,
      ...(approved ? { method: 'card', installments: paidInstallments } : {}),
    })
    .eq('id', intent.id)

  // Pagamento aprovado: roda o downstream COMPARTILHADO (cupom, comprovante, lead, Bling, envio).
  if (approved) {
    await finalizeRedePaid(admin, intent, {
      method: 'card',
      tid,
      returnCode,
      installments: Math.max(1, Math.min(12, args.installments ?? intent.installments ?? 1)),
      cardholderName: args.card.cardholderName?.slice(0, 50) ?? undefined,
    })
  }

  return { status: approved ? 'paid' : 'failed', returnCode, message, tid }
}

// Status do PIX na CONSULTA e.Rede (qrCodeResponse.status). "Pending" = aguardando.
// ⚠️ Os valores de PAGO ainda serão confirmados no teste real (R$1) — quando souber a string
// exata, garantir que está aqui. Conservador: status desconhecido NÃO finaliza (fica pending).
const REDE_PIX_PAID_STATUSES = new Set([
  'paid', 'confirmed', 'approved', 'completed', 'concluded', 'settled',
  'pago', 'aprovado', 'aprovada', 'concluida', 'concluído', 'confirmado', 'liquidado',
])
const REDE_PIX_FAILED_STATUSES = new Set([
  'expired', 'canceled', 'cancelled', 'failed', 'denied', 'rejected',
  'expirado', 'cancelado', 'negado', 'recusado', 'falha',
])

export type RedePixStatus = {
  id: string
  status: 'pending' | 'paid' | 'failed'
  rawStatus: string
  paid: boolean
  finalized: boolean
}

/**
 * Consulta o status de uma cobrança PIX na e.Rede (GET v1 + Basic, por reference) e, se PAGA,
 * roda o downstream (finalizeRedePaid) UMA vez (idempotente via update condicional). Usada
 * tanto pelo botão "Verificar" do painel quanto pelo poller. Nunca finaliza status ambíguo.
 */
export async function checkRedePixStatus(admin: SupabaseClient, id: string): Promise<RedePixStatus> {
  const intent = await getRedeIntent(admin, id)
  if (!intent) throw new Error('cobranca_nao_encontrada')
  if (intent.status === 'paid') return { id, status: 'paid', rawStatus: 'paid', paid: true, finalized: false }

  const cfg = await readRedeConfig(admin, intent.tenantId)
  if (!cfg) throw new Error('rede_nao_configurado')
  const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`)
  const res = await fetch(`${cfg.pixUrl}?reference=${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: { Authorization: `Basic ${basic}` },
  })
  const text = await res.text()
  // Erro de gateway/credencial (401/403/5xx) NÃO pode virar "pending" silencioso — senão um
  // PIX pago fica preso pra sempre sem ninguém perceber. Surge como exceção (poller registra).
  if (res.status === 401 || res.status === 403 || res.status >= 500) {
    throw new Error(`rede_pix_consulta_falhou:${res.status}:${(text || '').slice(0, 140)}`)
  }
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }
  // A e.Rede devolve formatos DIFERENTES conforme o estágio do PIX:
  //  - pendente: { qrCodeResponse: { status: "Pending", ... } }
  //  - PAGO:     { authorization: { status: "Approved", returnCode: "00", tid, ... } }  (sem qrCodeResponse)
  // Ler só qrCodeResponse fazia o PIX pago (que não tem esse campo) cair em "pending" pra sempre.
  const qr = (parsed.qrCodeResponse ?? {}) as Record<string, unknown>
  const auth = (parsed.authorization ?? {}) as Record<string, unknown>
  const authApproved =
    String(auth.returnCode ?? '') === '00' ||
    REDE_PIX_PAID_STATUSES.has(String(auth.status ?? '').trim().toLowerCase())
  const rawStatus = String((auth.status ?? qr.status) ?? '').trim()
  const low = rawStatus.toLowerCase()
  const tid =
    (typeof auth.tid === 'string' && auth.tid) ? auth.tid : (typeof qr.tid === 'string' ? qr.tid : null)

  if (authApproved || REDE_PIX_PAID_STATUSES.has(low)) {
    // Idempotência: só finaliza quem AINDA está pending (update condicional + checagem de linhas).
    const { data: upd } = await admin
      .from('rede_payments')
      .update({ status: 'paid', paid_at: new Date().toISOString(), ...(tid ? { tid } : {}) })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
    const firstTime = Array.isArray(upd) && upd.length > 0
    if (firstTime) {
      await finalizeRedePaid(admin, { ...intent, status: 'paid' }, { method: 'pix', tid, returnCode: '00' })
    }
    return { id, status: 'paid', rawStatus, paid: true, finalized: firstTime }
  }

  if (REDE_PIX_FAILED_STATUSES.has(low)) {
    await admin.from('rede_payments').update({ status: 'failed' }).eq('id', id).eq('status', 'pending')
    return { id, status: 'failed', rawStatus, paid: false, finalized: false }
  }

  return { id, status: 'pending', rawStatus, paid: false, finalized: false }
}

/**
 * Confere NA HORA os PIX e.Rede pendentes de UM lead (consulta a e.Rede e finaliza os pagos).
 * Usado quando o cliente avisa "paguei"/manda comprovante: confirma em segundos em vez de
 * esperar o poller (cron) de 1-2 min. Idempotente (checkRedePixStatus só finaliza pending) e
 * best-effort (erro em um PIX não derruba os outros nem o webhook). Retorna se algum confirmou.
 */
export async function checkPendingRedePixForLead(
  admin: SupabaseClient,
  leadId: string,
): Promise<{ confirmed: boolean; checked: number }> {
  if (!leadId) return { confirmed: false, checked: 0 }
  const { data } = await admin
    .from('rede_payments')
    .select('id')
    .eq('lead_id', leadId)
    .eq('method', 'pix')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(10)
  const ids = (data ?? []).map((r) => String((r as { id: unknown }).id))
  let confirmed = false
  for (const id of ids) {
    try {
      const out = await checkRedePixStatus(admin, id)
      if (out.status === 'paid') confirmed = true
    } catch {
      /* a e.Rede falhou nesta consulta — o poller tenta de novo no próximo ciclo */
    }
  }
  return { confirmed, checked: ids.length }
}

/**
 * Teste de credenciais/conectividade e.Rede: faz uma AUTORIZAÇÃO (capture:false)
 * de R$20,00 com o cartão oficial de teste e descarta. Serve para validar PV/token
 * num clique, sem criar cobrança nem mexer em leads. Só permitido em sandbox.
 */
export async function testRedeTransaction(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ ok: boolean; returnCode: string; message: string; tid: string | null; env: 'sandbox' | 'prod' }> {
  const cfg = await readRedeConfig(admin, tenantId)
  if (!cfg) throw new Error('rede_nao_configurado')
  if (cfg.env !== 'sandbox') throw new Error('teste_so_em_sandbox')

  const accessToken = await getRedeAccessToken(cfg)
  const body = {
    capture: false, // só autoriza; não captura nada
    kind: 'credit',
    reference: `test${shortId().slice(0, 12)}`,
    amount: 2000, // R$ 20,00 (mesmo valor do exemplo aprovado na collection oficial)
    installments: 1,
    cardholderName: 'TESTE TRICOPILL',
    cardNumber: '5448280000000007', // cartão de teste oficial e.Rede
    expirationMonth: 1,
    expirationYear: 2028,
    securityCode: '123',
    // softDescriptor omitido: serviço desativado na conta e.Rede (ver payRedeIntent).
    subscription: false,
  }
  const res = await fetch(cfg.txUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }
  const returnCode = String(parsed.returnCode ?? `http_${res.status}`)
  const tid = typeof parsed.tid === 'string' ? parsed.tid : null
  const message = String(parsed.returnMessage ?? parsed.message ?? (res.ok ? 'ok' : text.slice(0, 160)))
  // e.Rede: returnCode "00" = aprovado.
  return { ok: returnCode === '00', returnCode, message, tid, env: cfg.env }
}
