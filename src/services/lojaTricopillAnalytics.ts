import { supabase } from '@/lib/supabaseClient'

// Analytics da LOJA Tricopill (storefront). Lê comportamento gravado pelo site na tabela
// public.storefront_events (RLS liberado p/ "authenticated") + a view agregada
// public.tricopill_product_stats. Tudo via client AUTENTICADO do CRM — sem service_role.
// Agregação on-demand no front (mesmo padrão de fetchTricopillPaidOrders).

const TENANT = 'tricopill'
const ROW_LIMIT = 50000

export type StorefrontEventType =
  | 'view_page'
  | 'view_item'
  | 'search'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'select_freight'
  | 'begin_checkout'
  | 'purchase'
  | 'view_subscription'
  | 'subscribe'
  | 'reorder'

export type LojaAnalytics = {
  totalEvents: number
  kpis: {
    sessions: number
    viewItem: number
    addToCart: number
    purchases: number
    revenueCents: number
  }
  funnel: {
    viewItem: number
    addToCart: number
    beginCheckout: number
    purchase: number
  }
  pages: Array<{ path: string; sessions: number; views: number }>
  timeline: Array<{ day: string; view_item: number; add_to_cart: number; purchase: number }>
  subscription: {
    viewSubscription: number
    subscribe: number
    purchase: number
    reorder: number
    subscribeRevenueCents: number
    purchaseRevenueCents: number
  }
}

export type ProductStat = {
  productId: string
  productName: string
  views: number
  addToCart: number
  checkouts: number
  purchases: number
  revenueCents: number
  sessions: number
  lastEventAt: string | null
}

type RawEvent = {
  type: string | null
  product_id: string | null
  product_name: string | null
  value_cents: number | null
  session_id: string | null
  path: string | null
  created_at: string | null
}

/**
 * Eventos da loja no intervalo (start/end null = "tudo"). Filtra sempre tenant='tricopill'
 * e agrega no client. O RLS do usuário logado dá a leitura.
 */
export async function fetchLojaAnalytics(params: {
  start: Date | null
  end: Date | null
}): Promise<LojaAnalytics | null> {
  if (!supabase) return null

  let query = supabase
    .from('storefront_events')
    .select('type, product_id, product_name, value_cents, session_id, path, created_at')
    .eq('tenant_id', TENANT)
    .order('created_at', { ascending: true })
    .limit(ROW_LIMIT)

  if (params.start) query = query.gte('created_at', params.start.toISOString())
  if (params.end) query = query.lte('created_at', params.end.toISOString())

  const { data, error } = await query
  if (error) throw new Error(error.message || 'Falha ao carregar os eventos da loja.')

  return aggregate((data ?? []) as RawEvent[])
}

/**
 * Ranking de produtos a partir da view agregada (acumulado de todo o histórico — a view não
 * expõe data por evento, então este bloco não respeita o filtro de período).
 */
export async function fetchProductStats(): Promise<ProductStat[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('tricopill_product_stats')
    .select('product_id, product_name, views, add_to_cart, checkouts, purchases, revenue_cents, sessions, last_event_at')
    .order('views', { ascending: false })
    .limit(500)
  if (error || !Array.isArray(data)) return []
  return (data as Array<Record<string, unknown>>).map((r) => ({
    productId: String(r.product_id ?? ''),
    productName: String(r.product_name ?? r.product_id ?? '—'),
    views: Number(r.views ?? 0),
    addToCart: Number(r.add_to_cart ?? 0),
    checkouts: Number(r.checkouts ?? 0),
    purchases: Number(r.purchases ?? 0),
    revenueCents: Number(r.revenue_cents ?? 0),
    sessions: Number(r.sessions ?? 0),
    lastEventAt: r.last_event_at ? String(r.last_event_at) : null,
  }))
}

function aggregate(rows: RawEvent[]): LojaAnalytics {
  const sessions = new Set<string>()
  let viewItem = 0
  let addToCart = 0
  let beginCheckout = 0
  let purchase = 0
  let revenueCents = 0
  let viewSubscription = 0
  let subscribe = 0
  let reorder = 0
  let subscribeRevenueCents = 0
  let purchaseRevenueCents = 0

  const pageMap = new Map<string, { views: number; sessions: Set<string> }>()
  const dayMap = new Map<string, { view_item: number; add_to_cart: number; purchase: number }>()
  const bumpDay = (day: string, key: 'view_item' | 'add_to_cart' | 'purchase') => {
    if (!day) return
    const row = dayMap.get(day) ?? { view_item: 0, add_to_cart: 0, purchase: 0 }
    row[key] += 1
    dayMap.set(day, row)
  }

  for (const r of rows) {
    const type = r.type ?? ''
    const val = Number(r.value_cents) || 0
    const day = (r.created_at ?? '').slice(0, 10)
    if (r.session_id) sessions.add(r.session_id)

    switch (type) {
      case 'view_item':
        viewItem += 1
        bumpDay(day, 'view_item')
        break
      case 'add_to_cart':
        addToCart += 1
        bumpDay(day, 'add_to_cart')
        break
      case 'begin_checkout':
        beginCheckout += 1
        break
      case 'purchase':
        purchase += 1
        revenueCents += val
        purchaseRevenueCents += val
        bumpDay(day, 'purchase')
        break
      case 'view_page': {
        const path = r.path || '(sem path)'
        const entry = pageMap.get(path) ?? { views: 0, sessions: new Set<string>() }
        entry.views += 1
        if (r.session_id) entry.sessions.add(r.session_id)
        pageMap.set(path, entry)
        break
      }
      case 'view_subscription':
        viewSubscription += 1
        break
      case 'subscribe':
        subscribe += 1
        subscribeRevenueCents += val
        break
      case 'reorder':
        reorder += 1
        break
      default:
        break
    }
  }

  const pages = [...pageMap.entries()]
    .map(([path, v]) => ({ path, views: v.views, sessions: v.sessions.size }))
    .sort((a, b) => b.sessions - a.sessions || b.views - a.views)

  const timeline = [...dayMap.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day))

  return {
    totalEvents: rows.length,
    kpis: { sessions: sessions.size, viewItem, addToCart, purchases: purchase, revenueCents },
    funnel: { viewItem, addToCart, beginCheckout, purchase },
    pages,
    timeline,
    subscription: {
      viewSubscription,
      subscribe,
      purchase,
      reorder,
      subscribeRevenueCents,
      purchaseRevenueCents,
    },
  }
}
