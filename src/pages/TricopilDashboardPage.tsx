import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, MessageSquare, RefreshCw } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'

const ANALISE_TABS = [
  { to: '/tricopill-bi', label: 'BI de vendas' },
  { to: '/tricopill-loja', label: 'Loja (site)' },
]
import { buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { fetchTricopillBi, fetchTricopillPaidOrders, formatBRL, kitLabel, type TricopillBi, type TricopillOrderLite } from '@/services/tricopillBi'
import { classifyDelivery, type DeliveryKind } from '@/lib/deliveryType'
import { TricopillMarginCard } from '@/components/payments/TricopillMarginCard'
import { TricopillCacCard } from '@/components/payments/TricopillCacCard'

const CHART_COLORS = [
  'oklch(0.638 0.065 44)',
  'oklch(0.58 0.08 240)',
  'oklch(0.58 0.11 152)',
  'oklch(0.72 0.09 48)',
  'oklch(0.82 0.14 82)',
  'oklch(0.52 0.19 25)',
]

const QUICK_RANGES = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
  { label: '12 meses', days: 365 },
]

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  meta_whatsapp: 'WhatsApp (Meta)',
  meta_instagram: 'Instagram',
  meta_facebook: 'Facebook',
  manual: 'Manual',
  desconhecido: 'Sem origem',
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function shortDay(iso: string): string {
  const [, m, d] = iso.split('-')
  return m && d ? `${d}/${m}` : iso
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: string
}) {
  return (
    <div className="rounded-3xl border border-border/40 bg-card/50 p-6 transition-all hover:bg-card/80">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">{label}</p>
      <p className={cn('mt-2 text-3xl font-black tabular-nums tracking-tight', tone)}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground/70">{hint}</p> : null}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 mt-2 flex items-center gap-3">
      <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/50">{children}</h3>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  )
}

export function TricopilDashboardPage() {
  const [end, setEnd] = useState<string>(isoDate(new Date()))
  const [start, setStart] = useState<string>(isoDate(new Date(Date.now() - 30 * 86400000)))
  const [data, setData] = useState<TricopillBi | null>(null)
  const [orders, setOrders] = useState<TricopillOrderLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchTricopillBi({ start: new Date(`${start}T00:00:00`), end: new Date(`${end}T23:59:59`) })
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar o BI.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [start, end, reloadKey])

  // Pedidos pagos + custom_fields p/ classificar o TIPO DE ENTREGA (o BI agregado não traz).
  useEffect(() => {
    let cancelled = false
    fetchTricopillPaidOrders({ start: new Date(`${start}T00:00:00`), end: new Date(`${end}T23:59:59`) })
      .then((res) => {
        if (!cancelled) setOrders(res)
      })
      .catch(() => {
        if (!cancelled) setOrders([])
      })
    return () => {
      cancelled = true
    }
  }, [start, end, reloadKey])

  // Quebra por tipo de entrega (🛵 motoboy / 🏠 retirada / 📦 correios / não informado).
  const deliveryBreakdown = useMemo(() => {
    const counts: Record<DeliveryKind, number> = { motoboy: 0, retirada: 0, correios: 0, desconhecido: 0 }
    let inferred = 0
    for (const o of orders) {
      const c = classifyDelivery(o)
      counts[c.kind] += 1
      if (c.inferred) inferred += 1
    }
    const rows: Array<{ kind: DeliveryKind; emoji: string; label: string; count: number }> = [
      { kind: 'motoboy', emoji: '🛵', label: 'Motoboy (Maringá e região)', count: counts.motoboy },
      { kind: 'retirada', emoji: '🏠', label: 'Retirada na clínica', count: counts.retirada },
      { kind: 'correios', emoji: '📦', label: 'Envio Correios', count: counts.correios },
      { kind: 'desconhecido', emoji: '—', label: 'Não informado', count: counts.desconhecido },
    ]
    return { rows, total: orders.length, inferred }
  }, [orders])

  const applyQuick = (days: number) => {
    setEnd(isoDate(new Date()))
    setStart(isoDate(new Date(Date.now() - days * 86400000)))
  }

  // Série diária combinada: faturamento Bling vs nosso checkout.
  const dailySeries = useMemo(() => {
    const map = new Map<string, { dia: string; bling: number; checkout: number }>()
    for (const b of data?.bling.por_dia ?? []) {
      const row = map.get(b.dia) ?? { dia: b.dia, bling: 0, checkout: 0 }
      row.bling += b.total_cents / 100
      map.set(b.dia, row)
    }
    for (const c of data?.checkout.por_dia ?? []) {
      const row = map.get(c.dia) ?? { dia: c.dia, bling: 0, checkout: 0 }
      row.checkout += c.total_cents / 100
      map.set(c.dia, row)
    }
    return [...map.values()].sort((a, b) => a.dia.localeCompare(b.dia)).map((r) => ({ ...r, label: shortDay(r.dia) }))
  }, [data])

  const stageBars = useMemo(
    () => (data?.funnel.por_stage ?? []).map((s) => ({ name: s.name, leads: s.count })),
    [data],
  )

  if (loading && !data) {
    return (
      <AppLayout title="BI Tricopill">
        <SkeletonBlocks rows={8} />
      </AppLayout>
    )
  }

  const bling = data?.bling
  const checkout = data?.checkout
  const funnel = data?.funnel

  return (
    <AppLayout
      title="BI Tricopill — Vendas & Faturamento"
      actions={
        <div className="flex items-center gap-2">
          <Link
            to="/tricopill"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'rounded-xl border-border/40')}
          >
            <MessageSquare className="size-4 mr-2" />
            Conversas
          </Link>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className={cn(buttonVariants({ size: 'sm' }), 'rounded-xl')}
          >
            <RefreshCw className={cn('size-4 mr-2', loading && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      }
    >
      <SubTabs tabs={ANALISE_TABS} />
      {/* Filtros de período */}
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-border/30 bg-muted/10 p-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">De</span>
          <input
            type="date"
            value={start}
            max={end}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-md border border-border/40 bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Até</span>
          <input
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-md border border-border/40 bg-background px-2 py-1 text-sm"
          />
        </label>
        <div className="flex gap-1">
          {QUICK_RANGES.map((q) => (
            <button
              key={q.days}
              type="button"
              onClick={() => applyQuick(q.days)}
              className="rounded-md border border-border/40 px-2 py-1 text-xs hover:bg-muted/40"
            >
              {q.label}
            </button>
          ))}
        </div>
        {loading ? <span className="text-xs text-muted-foreground">Carregando…</span> : null}
      </div>

      {error ? (
        <p className="mb-6 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}

      {/* Comparativo "lado a lado": Bling x nosso checkout */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Faturamento Bling"
          value={bling?.connected ? formatBRL(bling.faturamento_cents) : '—'}
          hint={
            bling?.connected
              ? `${bling.pedidos} pedidos · ticket ${formatBRL(bling.ticket_medio_cents)}`
              : 'Bling não conectado'
          }
          tone="text-emerald-600"
        />
        <StatCard
          label="Recebido (checkout)"
          value={formatBRL(checkout?.total_cents ?? 0)}
          hint={`${checkout?.total_pagos ?? 0} pagamentos · ticket ${formatBRL(checkout?.ticket_medio_cents ?? 0)}`}
          tone="text-primary"
        />
        <StatCard
          label="Leads no período"
          value={funnel?.total_leads ?? 0}
          hint={`${funnel?.pagos ?? 0} marcados como pago`}
        />
        <StatCard
          label="Conversão lead → pago"
          value={`${funnel?.conversao_pct ?? 0}%`}
          hint="leads que chegaram a pago"
          tone="text-amber-600"
        />
      </section>

      {/* BLOCO 1 — Vendas & Faturamento */}
      <SectionTitle>Vendas & Faturamento</SectionTitle>

      <section className="mb-8 grid gap-4 lg:grid-cols-12">
        <div className="rounded-3xl border border-border/30 bg-card/40 p-6 lg:col-span-8">
          <p className="mb-4 text-sm font-bold text-foreground/90">Faturamento por dia — Bling x Checkout</p>
          {dailySeries.length === 0 ? (
            <p className="py-16 text-center text-xs text-muted-foreground">Sem faturamento no período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={dailySeries} margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v) => `R$${Math.round(Number(v) / 1000)}k`}
                />
                <Tooltip
                  formatter={(v, name) => [formatBRL(Number(v) * 100), name === 'bling' ? 'Bling' : 'Checkout']}
                  labelFormatter={(l) => `Dia ${l}`}
                  contentStyle={{ fontSize: 12, borderRadius: 12 }}
                />
                <Legend formatter={(v) => (v === 'bling' ? 'Bling (pedidos)' : 'Checkout (recebido)')} wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="bling" stroke={CHART_COLORS[2]} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="checkout" stroke={CHART_COLORS[0]} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Estoque (Bling) */}
        <div className="rounded-3xl border border-border/30 bg-card/40 p-6 lg:col-span-4">
          {(() => {
            const rupturas = (bling?.estoque ?? []).filter((p) => p.estoque != null && p.estoque <= 5).length
            return (
              <p className="mb-4 flex items-center justify-between gap-2 text-sm font-bold text-foreground/90">
                <span>Estoque (Bling)</span>
                {rupturas > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-bold text-destructive">
                    <AlertTriangle className="size-3" /> {rupturas} em ruptura
                  </span>
                ) : null}
              </p>
            )
          })()}
          {!bling?.connected ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Bling não conectado.</p>
          ) : (bling.estoque ?? []).length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Sem produtos no catálogo.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {[...bling.estoque]
                .sort((a, b) => (a.estoque ?? 9999) - (b.estoque ?? 9999))
                .slice(0, 12)
                .map((p) => {
                const low = p.estoque != null && p.estoque <= 5
                return (
                  <li key={p.codigo || p.nome} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-foreground/80">{p.nome}</span>
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-bold tabular-nums',
                        low ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-foreground/70',
                      )}
                    >
                      {low ? <AlertTriangle className="size-3" /> : null}
                      {p.estoque ?? '—'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {/* BLOCO 2 — Funil comercial */}
      <SectionTitle>Funil comercial</SectionTitle>

      <section className="mb-8 grid gap-4 lg:grid-cols-12">
        <div className="rounded-3xl border border-border/30 bg-card/40 p-6 lg:col-span-7">
          <p className="mb-4 text-sm font-bold text-foreground/90">Leads por etapa</p>
          {stageBars.length === 0 ? (
            <p className="py-16 text-center text-xs text-muted-foreground">Sem leads no período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, stageBars.length * 40)}>
              <BarChart data={stageBars} layout="vertical" margin={{ left: 8, right: 32 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Bar dataKey="leads" radius={[0, 8, 8, 0]} maxBarSize={34}>
                  {stageBars.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-3xl border border-border/30 bg-card/40 p-6 lg:col-span-5">
          <p className="mb-4 text-sm font-bold text-foreground/90">Leads por origem</p>
          {(funnel?.por_source ?? []).length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Sem dados no período.</p>
          ) : (
            <Table className="w-full text-xs">
              <TableHeader>
                <TableRow className="text-left text-muted-foreground">
                  <TableHead className="pb-2">Origem</TableHead>
                  <TableHead className="pb-2 text-right">Leads</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(funnel?.por_source ?? []).map((s) => (
                  <TableRow key={s.source} className="border-t border-border/20">
                    <TableCell className="py-1.5">{SOURCE_LABELS[s.source] ?? s.source}</TableCell>
                    <TableCell className="py-1.5 text-right font-semibold tabular-nums">{s.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {/* Conversão por etapa (funil) */}
      <section className="mb-8 rounded-3xl border border-border/30 bg-card/40 p-6">
        <p className="mb-4 text-sm font-bold text-foreground/90">Conversão por etapa</p>
        {(funnel?.etapas ?? []).length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Sem leads no período.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {(funnel?.etapas ?? []).map((e, i) => (
              <li key={e.stage_id} className="flex items-center gap-3">
                <span className="w-36 shrink-0 truncate text-xs font-semibold text-foreground/80" title={e.name}>
                  {e.name}
                </span>
                <div className="relative h-6 flex-1 overflow-hidden rounded-lg bg-muted/30">
                  <div
                    className="h-full rounded-lg transition-all"
                    style={{ width: `${Math.max(2, e.pct)}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-bold tabular-nums text-foreground/80">
                    {e.atingiram} · {e.pct}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[10px] text-muted-foreground/60">
          % de leads do período que chegaram a cada etapa (snapshot, avanço só pra frente; "Perdido" fora).
        </p>
      </section>

      {/* BLOCO 3 — Pagamentos */}
      <SectionTitle>Pagamentos</SectionTitle>

      <section className="grid gap-4 lg:grid-cols-12">
        <div className="grid content-start gap-4 sm:grid-cols-2 lg:col-span-7">
          <StatCard
            label="PIX (Asaas)"
            value={formatBRL(checkout?.pix.total_cents ?? 0)}
            hint={`${checkout?.pix.pagos ?? 0} pagos · ${checkout?.pix.gerados ?? 0} links gerados`}
            tone="text-emerald-600"
          />
          <StatCard
            label="Cartão (Asaas)"
            value={formatBRL(checkout?.cartao.total_cents ?? 0)}
            hint={`${checkout?.cartao.pagos ?? 0} pagos · ${checkout?.cartao.parcelamento_medio ?? 0}x médio`}
            tone="text-primary"
          />
          <StatCard
            label="Links gerados"
            value={(checkout?.pix.gerados ?? 0) + (checkout?.cartao.gerados ?? 0)}
            hint="PIX + cartão no período"
          />
          <StatCard
            label="Taxa de pagamento"
            value={`${
              (checkout?.pix.gerados ?? 0) + (checkout?.cartao.gerados ?? 0) > 0
                ? Math.round(
                    ((checkout?.total_pagos ?? 0) /
                      ((checkout?.pix.gerados ?? 0) + (checkout?.cartao.gerados ?? 0))) *
                      100,
                  )
                : 0
            }%`}
            hint="pagos / links gerados"
            tone="text-amber-600"
          />
          <StatCard
            label="Desconto concedido"
            value={formatBRL(checkout?.desconto_total_cents ?? 0)}
            hint={`${(checkout?.por_cupom ?? []).length} cupom(ns) usado(s)`}
            tone="text-rose-600"
          />
        </div>

        <div className="rounded-3xl border border-border/30 bg-card/40 p-6 lg:col-span-5">
          <p className="mb-4 text-sm font-bold text-foreground/90">Kits vendidos (PIX + cartão)</p>
          {(checkout?.por_kit ?? []).length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Sem vendas confirmadas no período.</p>
          ) : (
            <Table className="w-full text-xs">
              <TableHeader>
                <TableRow className="text-left text-muted-foreground">
                  <TableHead className="pb-2">Kit</TableHead>
                  <TableHead className="pb-2 text-right">Qtd</TableHead>
                  <TableHead className="pb-2 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(checkout?.por_kit ?? []).map((k) => (
                  <TableRow key={k.kit} className="border-t border-border/20">
                    <TableCell className="py-1.5">{kitLabel(k.kit)}</TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums">{k.count}</TableCell>
                    <TableCell className="py-1.5 text-right font-semibold tabular-nums">{formatBRL(k.total_cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>

      {(checkout?.por_cupom ?? []).length > 0 ? (
        <section className="mt-8">
          <SectionTitle>Cupons</SectionTitle>
          <div className="rounded-3xl border border-border/30 bg-card/40 p-6">
            <Table className="w-full text-xs">
              <TableHeader>
                <TableRow className="text-left text-muted-foreground">
                  <TableHead className="pb-2">Cupom</TableHead>
                  <TableHead className="pb-2 text-right">Usos</TableHead>
                  <TableHead className="pb-2 text-right">Receita gerada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(checkout?.por_cupom ?? []).map((c) => (
                  <TableRow key={c.code} className="border-t border-border/20">
                    <TableCell className="py-1.5 font-mono font-semibold uppercase">{c.code}</TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums">{c.count}</TableCell>
                    <TableCell className="py-1.5 text-right font-semibold tabular-nums">{formatBRL(c.total_cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <SectionTitle>Custos, Margem &amp; CAC</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <TricopillMarginCard porKit={checkout?.por_kit ?? []} revenueCents={checkout?.total_cents ?? 0} startIso={start} endIso={end} />
          <TricopillCacCard paidCount={checkout?.total_pagos ?? 0} revenueCents={checkout?.total_cents ?? 0} />
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>Entregas (pedidos pagos)</SectionTitle>
        <div className="rounded-3xl border border-border/30 bg-card/40 p-6">
          {deliveryBreakdown.total === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Sem pedidos pagos no período.</p>
          ) : (
            <>
              <Table className="w-full text-xs">
                <TableHeader>
                  <TableRow className="text-left text-muted-foreground">
                    <TableHead className="pb-2">Tipo de entrega</TableHead>
                    <TableHead className="pb-2 text-right">Pedidos</TableHead>
                    <TableHead className="pb-2 text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveryBreakdown.rows.map((r) => (
                    <TableRow key={r.kind} className="border-t border-border/20">
                      <TableCell className="py-1.5">{r.emoji} {r.label}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{r.count}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {deliveryBreakdown.total > 0 ? Math.round((r.count / deliveryBreakdown.total) * 100) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Total: {deliveryBreakdown.total} pedido(s). "Não informado" = vendas sem tipo de entrega registrado
                (em geral antigas/manuais). {deliveryBreakdown.inferred > 0 ? `${deliveryBreakdown.inferred} classificado(s) por inferência de CEP.` : ''}
              </p>
            </>
          )}
        </div>
      </section>

      {bling?.connected && bling.error ? (
        <p className="mt-6 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          Faturamento Bling indisponível no momento: {bling.error}
        </p>
      ) : null}
    </AppLayout>
  )
}
