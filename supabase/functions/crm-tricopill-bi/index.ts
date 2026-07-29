import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { getValidBlingToken, blingListSaleOrdersDetalhado, buildBlingCatalog } from '../_shared/bling.ts'

// BI do Tricopill — agrega 3 fontes para o polo de vendas ativo (current_tenant_id):
//   1) Funil/CRM  -> leads por estágio, por origem, conversão para "pago"
//   2) Checkout   -> pagamentos confirmados (PagBank/PIX + e.Rede/Cartão)
//   3) Bling      -> faturamento real (pedidos de venda) + estoque do catálogo
// Tudo on-demand por intervalo de datas. Best-effort: Bling fora do ar não derruba o resto.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function isoDay(d: string): string {
  return String(d ?? '').slice(0, 10)
}

// "pago" = estágio final de venda (ex.: tricopill__vd-pago).
function isPaidStage(stageId: string | null | undefined, name?: string | null): boolean {
  const s = String(stageId ?? '').toLowerCase()
  const n = String(name ?? '').toLowerCase()
  return s.endsWith('-pago') || s.includes('pago') || n.includes('pago')
}

// "perdido" = saída lateral do funil (não entra na conversão por etapa).
function isLossStage(stageId: string | null | undefined, name?: string | null): boolean {
  const s = String(stageId ?? '').toLowerCase()
  const n = String(name ?? '').toLowerCase()
  return s.endsWith('-perdido') || s.includes('perdido') || n.includes('perdido') || n.includes('perda')
}

type DayBucket = { dia: string; total_cents: number; count: number }
function bucketByDay(rows: Array<{ day: string; cents: number }>): DayBucket[] {
  const map = new Map<string, DayBucket>()
  for (const r of rows) {
    if (!r.day) continue
    const b = map.get(r.day) ?? { dia: r.day, total_cents: 0, count: 0 }
    b.total_cents += r.cents
    b.count += 1
    map.set(r.day, b)
  }
  return [...map.values()].sort((a, b) => a.dia.localeCompare(b.dia))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  let payload: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  // Janela de datas (default: últimos 30 dias).
  const now = Date.now()
  const startIso = typeof payload.start === 'string' && payload.start
    ? new Date(payload.start).toISOString()
    : new Date(now - 30 * 86400000).toISOString()
  const endIso = typeof payload.end === 'string' && payload.end
    ? new Date(payload.end).toISOString()
    : new Date(now).toISOString()
  const dataInicial = isoDay(startIso)
  const dataFinal = isoDay(endIso)

  // ---------------------------------------------------------------------------
  // 1) Funil / CRM
  // ---------------------------------------------------------------------------
  const [leadsRes, stagesRes] = await Promise.all([
    admin
      .from('leads')
      .select('id, stage_id, source, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', startIso)
      .lte('created_at', endIso),
    admin.from('pipeline_stages').select('id, name, position').eq('tenant_id', tenantId).order('position'),
  ])
  const leads = (leadsRes.data ?? []) as Array<{ id: string; stage_id: string | null; source: string | null; created_at: string }>
  const stages = (stagesRes.data ?? []) as Array<{ id: string; name: string; position: number }>
  const stageName = new Map(stages.map((s) => [s.id, s.name]))

  const byStageMap = new Map<string, number>()
  const bySourceMap = new Map<string, number>()
  let pagosFunnel = 0
  for (const l of leads) {
    if (l.stage_id) byStageMap.set(l.stage_id, (byStageMap.get(l.stage_id) ?? 0) + 1)
    const src = l.source || 'desconhecido'
    bySourceMap.set(src, (bySourceMap.get(src) ?? 0) + 1)
    if (isPaidStage(l.stage_id, stageName.get(l.stage_id ?? ''))) pagosFunnel += 1
  }
  // Conversão por etapa (snapshot): assume avanço só pra frente — "atingiram" a
  // etapa = leads nela + em todas as etapas posteriores (exceto Perdido).
  const stagesFunil = stages.filter((s) => !isLossStage(s.id, s.name))
  const etapas = stagesFunil.map((s, idx) => {
    let atingiram = 0
    for (let j = idx; j < stagesFunil.length; j++) atingiram += byStageMap.get(stagesFunil[j].id) ?? 0
    return {
      stage_id: s.id,
      name: s.name,
      count: byStageMap.get(s.id) ?? 0,
      atingiram,
      pct: leads.length ? Math.round((atingiram / leads.length) * 1000) / 10 : 0,
    }
  })
  const funnel = {
    total_leads: leads.length,
    pagos: pagosFunnel,
    conversao_pct: leads.length ? Math.round((pagosFunnel / leads.length) * 1000) / 10 : 0,
    por_stage: stages
      .map((s) => ({ stage_id: s.id, name: s.name, count: byStageMap.get(s.id) ?? 0 }))
      .filter((s) => s.count > 0 || stageName.has(s.stage_id)),
    etapas,
    por_source: [...bySourceMap.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
  }

  // ---------------------------------------------------------------------------
  // 2) Checkout (Asaas = gateway vivo; PagBank/e.Rede = histórico) — confirmados no período.
  //    Asaas tem `method` ('pix'|'card'): pix entra no balde PIX, card no balde Cartão.
  // ---------------------------------------------------------------------------
  const [pagbankRes, redeRes, asaasRes] = await Promise.all([
    admin
      .from('pagbank_checkouts')
      .select('amount_cents, kit, status, created_at, paid_at, coupon_code, discount_cents')
      .eq('tenant_id', tenantId),
    admin
      .from('rede_payments')
      // `method` estava fora do select, e por isso o código não tinha como separar PIX de
      // cartão nesta tabela: jogava tudo no balde de cartão.
      .select('amount_cents, method, installments, status, created_at, paid_at, kit, coupon_code, discount_cents')
      .eq('tenant_id', tenantId),
    admin
      .from('asaas_payments')
      .select('amount_cents, method, installments, status, created_at, paid_at, kit, coupon_code, discount_cents')
      .eq('tenant_id', tenantId),
  ])
  type CheckoutRow = {
    amount_cents: number | null
    installments?: number | null
    status: string | null
    created_at: string | null
    paid_at: string | null
    kit: string | null
    coupon_code: string | null
    discount_cents: number | null
  }
  const pagbank = (pagbankRes.data ?? []) as CheckoutRow[]
  const rede = (redeRes.data ?? []) as Array<CheckoutRow & { method: string | null }>
  const asaas = (asaasRes.data ?? []) as Array<CheckoutRow & { method: string | null }>

  // A e.Rede processa PIX desde 20/jun. Antes desta correção a tabela `rede_payments`
  // inteira ia para o balde "cartão", sem olhar a coluna `method`: 51 pagamentos PIX
  // (R$ 23.734) apareciam como cartão. O total ficava certo e a divisão invertida, que é
  // pior do que errar os dois, porque o número fecha e ninguém desconfia.
  const ehCartao = (r: { method: string | null }) => String(r.method ?? '') === 'card'

  // PagBank é PIX por natureza (checkout PIX); Rede e Asaas se declaram em `method`.
  const pixSource: CheckoutRow[] = [
    ...pagbank,
    ...rede.filter((r) => !ehCartao(r)),
    ...asaas.filter((r) => !ehCartao(r)),
  ]
  const cardSource: CheckoutRow[] = [...rede.filter(ehCartao), ...asaas.filter(ehCartao)]

  const startMs = Date.parse(startIso)
  const endMs = Date.parse(endIso)
  const inRange = (iso: string | null): boolean => {
    if (!iso) return false
    const t = Date.parse(iso)
    return Number.isFinite(t) && t >= startMs && t <= endMs
  }
  const isPaid = (status: string | null, paidAt: string | null): boolean =>
    !!paidAt || ['paid', 'pago', 'available', 'approved', 'completed'].includes(String(status ?? '').toLowerCase())

  // Mix de kit e cupons consolidam PIX + cartão (antes só PIX entrava no mix).
  const kitMap = new Map<string, { count: number; total_cents: number }>()
  const couponMap = new Map<string, { count: number; total_cents: number }>()
  let descontoTotalCents = 0
  const addKit = (kit: string | null, cents: number) => {
    const key = kit || 'avulso'
    const k = kitMap.get(key) ?? { count: 0, total_cents: 0 }
    k.count += 1
    k.total_cents += cents
    kitMap.set(key, k)
  }
  const addCoupon = (code: string | null, discount: number | null, cents: number) => {
    descontoTotalCents += Number(discount ?? 0) || 0
    const c = (code ?? '').trim()
    if (!c) return
    const v = couponMap.get(c) ?? { count: 0, total_cents: 0 }
    v.count += 1
    v.total_cents += cents
    couponMap.set(c, v)
  }

  // PIX/PagBank
  let pixPagos = 0
  let pixCents = 0
  let pixGerados = 0
  const pixDayRows: Array<{ day: string; cents: number }> = []
  for (const r of pixSource) {
    if (inRange(r.created_at)) pixGerados += 1
    if (isPaid(r.status, r.paid_at) && inRange(r.paid_at ?? r.created_at)) {
      const cents = r.amount_cents ?? 0
      pixPagos += 1
      pixCents += cents
      pixDayRows.push({ day: isoDay(r.paid_at ?? r.created_at ?? ''), cents })
      addKit(r.kit, cents)
      addCoupon(r.coupon_code, r.discount_cents, cents)
    }
  }

  // Cartão/e.Rede
  let cardPagos = 0
  let cardCents = 0
  let cardGerados = 0
  let parcelasSoma = 0
  const cardDayRows: Array<{ day: string; cents: number }> = []
  for (const r of cardSource) {
    if (inRange(r.created_at)) cardGerados += 1
    if (isPaid(r.status, r.paid_at) && inRange(r.paid_at ?? r.created_at)) {
      const cents = r.amount_cents ?? 0
      cardPagos += 1
      cardCents += cents
      parcelasSoma += Number(r.installments ?? 1) || 1
      cardDayRows.push({ day: isoDay(r.paid_at ?? r.created_at ?? ''), cents })
      addKit(r.kit, cents)
      addCoupon(r.coupon_code, r.discount_cents, cents)
    }
  }

  const checkoutTotalCents = pixCents + cardCents
  const checkoutPagos = pixPagos + cardPagos
  const checkout = {
    total_cents: checkoutTotalCents,
    total_pagos: checkoutPagos,
    ticket_medio_cents: checkoutPagos ? Math.round(checkoutTotalCents / checkoutPagos) : 0,
    pix: { pagos: pixPagos, gerados: pixGerados, total_cents: pixCents },
    cartao: {
      pagos: cardPagos,
      gerados: cardGerados,
      total_cents: cardCents,
      parcelamento_medio: cardPagos ? Math.round((parcelasSoma / cardPagos) * 10) / 10 : 0,
    },
    por_kit: [...kitMap.entries()]
      .map(([kit, v]) => ({ kit, count: v.count, total_cents: v.total_cents }))
      .sort((a, b) => b.total_cents - a.total_cents),
    por_dia: bucketByDay([...pixDayRows, ...cardDayRows]),
    desconto_total_cents: descontoTotalCents,
    por_cupom: [...couponMap.entries()]
      .map(([code, v]) => ({ code, count: v.count, total_cents: v.total_cents }))
      .sort((a, b) => b.total_cents - a.total_cents),
  }

  // ---------------------------------------------------------------------------
  // 3) Bling — faturamento real (pedidos de venda) + estoque
  // ---------------------------------------------------------------------------
  let bling: Record<string, unknown> = {
    connected: false,
    faturamento_cents: 0,
    pedidos: 0,
    ticket_medio_cents: 0,
    por_dia: [] as DayBucket[],
    estoque: [] as Array<{ nome: string; codigo: string; estoque: number | null; preco: number }>,
    error: null as string | null,
    /** true quando a listagem bateu no teto de páginas: o total mostrado está incompleto. */
    truncado: false,
    /**
     * Quebra por situação do pedido no Bling, para o faturamento deixar de ser um número
     * único e opaco. A auditoria de 29/07 mostrou que pedido CANCELADO entra no total
     * (2 em julho, R$ 298) e que "Em aberto" pesa R$ 152 mil em 12 meses. Decidir o que
     * conta como faturamento é do negócio, não do código: aqui a informação fica visível
     * em vez de o total embutir a escolha em silêncio.
     */
    por_situacao: [] as Array<{ situacao_id: number | null; pedidos: number; total_cents: number }>,
  }
  const token = await getValidBlingToken(admin, tenantId)
  if (token) {
    bling.connected = true
    try {
      // maxPages 10 (1.000 pedidos) cortava o botão "12 meses" pela metade: 2.281 pedidos
      // reais viravam 1.000, e como o Bling ordena do mais recente para o mais antigo a
      // tela dizia 12 meses e cobria 5. `truncado` avisa em vez de cortar calado.
      const { orders, truncado } = await blingListSaleOrdersDetalhado(token, { dataInicial, dataFinal })
      const faturamento = orders.reduce((acc, o) => acc + o.totalCents, 0)
      bling.faturamento_cents = faturamento
      bling.pedidos = orders.length
      bling.truncado = truncado
      bling.ticket_medio_cents = orders.length ? Math.round(faturamento / orders.length) : 0
      bling.por_dia = bucketByDay(orders.map((o) => ({ day: o.data, cents: o.totalCents })))
      const porSituacao = new Map<number | null, { pedidos: number; total_cents: number }>()
      for (const o of orders) {
        const chave = o.situacaoId ?? null
        const atual = porSituacao.get(chave) ?? { pedidos: 0, total_cents: 0 }
        atual.pedidos += 1
        atual.total_cents += o.totalCents
        porSituacao.set(chave, atual)
      }
      bling.por_situacao = [...porSituacao.entries()]
        .map(([situacao_id, v]) => ({ situacao_id, ...v }))
        .sort((a, b) => b.total_cents - a.total_cents)
    } catch (e) {
      bling.error = e instanceof Error ? e.message : String(e)
    }
    try {
      const cat = await buildBlingCatalog(admin, tenantId)
      bling.estoque = cat.items
        .map((i) => ({ nome: i.nome, codigo: i.codigo, estoque: i.estoque, preco: i.preco }))
        .sort((a, b) => (a.estoque ?? 0) - (b.estoque ?? 0))
    } catch {
      // catálogo é best-effort
    }
  }

  return json({
    ok: true,
    range: { start: startIso, end: endIso },
    funnel,
    checkout,
    bling,
  })
  } catch (e) {
    // Nunca responder sem CORS: qualquer throw vira 500 com headers (senão o
    // navegador reporta como erro de CORS e o dashboard inteiro quebra).
    console.error('[crm-tricopill-bi] erro nao tratado:', e instanceof Error ? e.message : String(e))
    return json({ error: 'internal_error', message: e instanceof Error ? e.message.slice(0, 200) : String(e) }, 500)
  }
})
