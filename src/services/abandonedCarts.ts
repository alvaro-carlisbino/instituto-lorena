import { supabase } from '@/lib/supabaseClient'

// Carrinhos abandonados da loja Tricopill. Junta os eventos do funil (storefront_events) por
// sessão e isola quem demonstrou intenção de compra (add_to_cart / begin_checkout / checkout_lead)
// mas NÃO finalizou (sem `purchase` na sessão). O evento `checkout_lead` — disparado pelo site
// assim que o cliente digita nome + WhatsApp no checkout — carrega o contato, então dá pra
// recuperar no zap. Tudo via client autenticado (RLS libera leitura ao usuário logado).

const TENANT = 'tricopill'
const ROW_LIMIT = 50000
// Não lista quem ainda pode estar comprando: só entra no radar depois de esfriar um pouco.
const COOLDOWN_MS = 30 * 60 * 1000

export type CartItem = { id: string | null; nome: string; qty: number }

export type AbandonedCart = {
  sessionId: string
  name: string | null
  phone: string | null
  email: string | null
  cep: string | null
  items: CartItem[]
  valueCents: number
  firstSeen: string
  lastSeen: string
  reachedCheckout: boolean // chegou a preencher contato (checkout_lead) — recuperável
  source: string | null // origem do tráfego (utm_source / gclid / referrer)
  gclid: string | null
  alreadyCustomer: boolean // telefone já tinha compra paga ANTES deste carrinho (cliente antigo)
  recovered: boolean // fechou uma compra DEPOIS de abandonar (site → venda, inclusive no WhatsApp)
  boughtAt: string | null // quando a compra casada aconteceu
}

export type AbandonedCartsResult = {
  carts: AbandonedCart[]
  anonymousCount: number // sessões com carrinho mas sem contato (não dá pra recuperar 1:1)
  recoverableValueCents: number
  recoveredCount: number // carrinhos que depois viraram venda (site influenciou a compra)
}

type RawEvent = {
  type: string | null
  product_name: string | null
  value_cents: number | null
  session_id: string | null
  meta: Record<string, unknown> | null
  attribution: Record<string, unknown> | null
  referrer: string | null
  created_at: string | null
}

const asRec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')
// Últimos 8 dígitos: casa variações de DDI/nono dígito sem esbarrar em falso-positivo curto.
const phoneKey = (v: unknown): string => { const d = digits(v); return d.length >= 8 ? d.slice(-8) : '' }

function parseCartItems(meta: Record<string, unknown>): CartItem[] {
  const raw = meta.items
  if (Array.isArray(raw)) {
    return raw.map((i) => {
      const r = asRec(i)
      return { id: r.id != null ? String(r.id) : null, nome: String(r.nome ?? r.name ?? 'Item').trim() || 'Item', qty: Number(r.qty ?? 1) || 1 }
    })
  }
  // add_to_cart traz um produto por evento (id/nome/qty no próprio meta).
  if (meta.nome || meta.id) return [{ id: meta.id != null ? String(meta.id) : null, nome: String(meta.nome ?? 'Item'), qty: Number(meta.qty ?? 1) || 1 }]
  return []
}

function originOf(attr: Record<string, unknown>, referrer: string | null): { source: string | null; gclid: string | null } {
  const first = asRec(attr.first)
  const gclid = first.gclid != null ? String(first.gclid) : (attr.gclid != null ? String(attr.gclid) : null)
  const utmSource = first.utm_source ?? attr.utm_source
  let source: string | null = null
  if (utmSource) source = String(utmSource)
  else if (gclid) source = 'google/cpc'
  else {
    const ref = String(first.referrer ?? referrer ?? '').replace(/^https?:\/\//, '').split('/')[0]
    source = ref || 'direto'
  }
  return { source, gclid }
}

/** Telefone (chave de 8 dígitos) → timestamp da compra paga MAIS RECENTE. Serve pra dizer se
 *  o dono do carrinho comprou (e se foi antes = cliente antigo, ou depois = recuperado). */
async function fetchBuyerPhoneTimes(): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!supabase) return map
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
  const bump = (phone: unknown, at: unknown) => {
    const k = phoneKey(phone)
    if (!k) return
    const ms = new Date(String(at ?? '')).getTime()
    if (!Number.isFinite(ms)) return
    if (!map.has(k) || ms > (map.get(k) as number)) map.set(k, ms)
  }
  const [rede, asaas] = await Promise.all([
    supabase.from('rede_payments').select('phone, created_at').eq('status', 'paid').gte('created_at', since).limit(5000),
    supabase.from('asaas_payments').select('phone, created_at').in('status', ['paid', 'received', 'confirmed']).gte('created_at', since).limit(5000),
  ])
  for (const r of (rede.data ?? []) as Array<{ phone: unknown; created_at: unknown }>) bump(r.phone, r.created_at)
  for (const r of (asaas.data ?? []) as Array<{ phone: unknown; created_at: unknown }>) bump(r.phone, r.created_at)
  return map
}

export async function fetchAbandonedCarts(days = 30): Promise<AbandonedCartsResult> {
  if (!supabase) return { carts: [], anonymousCount: 0, recoverableValueCents: 0, recoveredCount: 0 }

  const start = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  const [eventsRes, buyerTimes] = await Promise.all([
    supabase
      .from('storefront_events')
      .select('type, product_name, value_cents, session_id, meta, attribution, referrer, created_at')
      .eq('tenant_id', TENANT)
      .in('type', ['add_to_cart', 'begin_checkout', 'checkout_lead', 'purchase'])
      .gte('created_at', start)
      .order('created_at', { ascending: true })
      .limit(ROW_LIMIT),
    fetchBuyerPhoneTimes().catch(() => new Map<string, number>()),
  ])
  if (eventsRes.error) throw new Error(eventsRes.error.message || 'Falha ao carregar carrinhos.')

  type Agg = {
    sessionId: string
    firstSeen: string
    lastSeen: string
    hasPurchase: boolean
    lead: Record<string, unknown> | null // meta do último checkout_lead
    addItems: Map<string, CartItem> // itens vindos de add_to_cart (dedup por id)
    valueCents: number
    attribution: Record<string, unknown>
    referrer: string | null
  }
  const bySession = new Map<string, Agg>()

  for (const r of (eventsRes.data ?? []) as RawEvent[]) {
    const sid = r.session_id
    if (!sid) continue
    const at = r.created_at ?? ''
    let a = bySession.get(sid)
    if (!a) {
      a = { sessionId: sid, firstSeen: at, lastSeen: at, hasPurchase: false, lead: null, addItems: new Map(), valueCents: 0, attribution: asRec(r.attribution), referrer: r.referrer }
      bySession.set(sid, a)
    }
    if (at < a.firstSeen) a.firstSeen = at
    if (at > a.lastSeen) a.lastSeen = at
    if (r.attribution) a.attribution = asRec(r.attribution)

    const meta = asRec(r.meta)
    switch (r.type) {
      case 'purchase':
        a.hasPurchase = true
        break
      case 'checkout_lead': {
        a.lead = meta // o mais recente vence (loop em ordem crescente)
        const v = Number(r.value_cents) || 0
        if (v > a.valueCents) a.valueCents = v
        break
      }
      case 'begin_checkout': {
        const v = Number(r.value_cents) || 0
        if (v > a.valueCents) a.valueCents = v
        break
      }
      case 'add_to_cart': {
        for (const it of parseCartItems(meta)) a.addItems.set(it.id ?? it.nome, it)
        break
      }
    }
  }

  const now = Date.now()
  const carts: AbandonedCart[] = []
  let anonymousCount = 0

  for (const a of bySession.values()) {
    if (a.hasPurchase) continue
    const lastMs = new Date(a.lastSeen).getTime()
    if (Number.isFinite(lastMs) && now - lastMs < COOLDOWN_MS) continue // ainda quente, pode estar comprando

    const lead = a.lead
    const hasContact = !!lead && (digits(lead.phone).length >= 10)
    const items = lead ? parseCartItems(lead) : [...a.addItems.values()]
    if (items.length === 0 && !hasContact) continue // sessão sem sinal de carrinho real

    if (!hasContact) { anonymousCount += 1; continue } // sem contato: entra só na contagem

    const { source, gclid } = originOf(a.attribution, a.referrer)
    const phone = lead ? String(lead.phone ?? '') : ''
    // Comprou? Se a compra foi DEPOIS de abandonar (com folga de 10 min) = recuperado
    // (site influenciou, inclusive fechando no WhatsApp). Antes = já era cliente.
    const boughtMs = buyerTimes.get(phoneKey(phone))
    const recovered = boughtMs != null && Number.isFinite(lastMs) && boughtMs >= lastMs - 10 * 60 * 1000
    carts.push({
      sessionId: a.sessionId,
      name: lead?.nome != null ? String(lead.nome) : null,
      phone: phone || null,
      email: lead?.email != null ? String(lead.email) : null,
      cep: lead?.cep != null ? String(lead.cep) : null,
      items,
      valueCents: a.valueCents,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      reachedCheckout: true,
      source,
      gclid,
      alreadyCustomer: boughtMs != null && !recovered,
      recovered,
      boughtAt: boughtMs != null ? new Date(boughtMs).toISOString() : null,
    })
  }

  carts.sort((x, y) => y.lastSeen.localeCompare(x.lastSeen))
  // "Recuperável" = ainda em aberto (não comprou e não é cliente antigo).
  const recoverableValueCents = carts.filter((c) => !c.alreadyCustomer && !c.recovered).reduce((s, c) => s + c.valueCents, 0)
  const recoveredCount = carts.filter((c) => c.recovered).length
  return { carts, anonymousCount, recoverableValueCents, recoveredCount }
}
