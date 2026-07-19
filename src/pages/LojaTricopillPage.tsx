import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowDown, ArrowUp, MessageSquare, RefreshCw, ShoppingBag } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'

const ANALISE_TABS = [
  { to: '/bi-vendas', label: 'BI de vendas' },
  { to: '/loja-analytics', label: 'Loja (site)' },
  { to: '/reengajamento', label: 'Reengajamento' },
]
import { EmptyState } from '@/components/ui/empty-state'
import { Button, buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatBRL } from '@/services/tricopillBi'
import {
  fetchLojaAnalytics,
  type LojaAnalytics,
} from '@/services/lojaTricopillAnalytics'

const CHART_COLORS = [
  'oklch(0.638 0.065 44)',
  'oklch(0.58 0.08 240)',
  'oklch(0.58 0.11 152)',
  'oklch(0.72 0.09 48)',
  'oklch(0.82 0.14 82)',
  'oklch(0.52 0.19 25)',
]

type PeriodKey = '7d' | '30d' | 'all'
const PERIODS: Array<{ key: PeriodKey; label: string; days: number | null }> = [
  { key: '7d', label: '7 dias', days: 7 },
  { key: '30d', label: '30 dias', days: 30 },
  { key: 'all', label: 'Tudo', days: null },
]

type SortKey = 'views' | 'addToCart' | 'addToCartRate' | 'sessions'

function shortDay(iso: string): string {
  const [, m, d] = iso.split('-')
  return m && d ? `${d}/${m}` : iso
}
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
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
    <div className="rounded-xl border border-border bg-card p-6 transition-all hover:bg-card/80">
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

export function LojaTricopillPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const [data, setData] = useState<LojaAnalytics | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('views')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const days = PERIODS.find((p) => p.key === period)?.days ?? null
    const end = days == null ? null : new Date()
    const start = days == null ? null : new Date(Date.now() - days * 86400000)

    fetchLojaAnalytics({ start, end })
      .then((analytics) => {
        if (cancelled) return
        setData(analytics)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar a loja.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period, reloadKey])

  const sortedProducts = useMemo(() => {
    return [...(data?.products ?? [])].sort((a, b) => b[sortKey] - a[sortKey])
  }, [data, sortKey])

  const funnelRows = useMemo(() => {
    const f = data?.funnel
    if (!f) return []
    const top = Math.max(f.viewItem, 1)
    return [
      { name: 'Viu produto', count: f.viewItem, conv: null as number | null },
      { name: 'Add. carrinho', count: f.addToCart, conv: pct(f.addToCart, f.viewItem) },
      { name: 'Checkout', count: f.beginCheckout, conv: pct(f.beginCheckout, f.addToCart) },
      { name: 'Compra', count: f.purchase, conv: pct(f.purchase, f.beginCheckout) },
    ].map((r) => ({ ...r, width: Math.max(2, pct(r.count, top)) }))
  }, [data])

  const timeline = useMemo(
    () => (data?.timeline ?? []).map((t) => ({ ...t, label: shortDay(t.day) })),
    [data],
  )

  if (loading && !data) {
    return (
      <AppLayout title="Loja Tricopill">
        <SkeletonBlocks rows={8} />
      </AppLayout>
    )
  }

  const k = data?.kpis
  const sub = data?.subscription
  const hasAnyData = (data?.totalEvents ?? 0) > 0

  return (
    <AppLayout
      title="Loja Tricopill · Analytics do site"
      actions={
        <div className="flex items-center gap-2">
          <Link
            to="/bi-vendas"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'rounded-lg')}
          >
            <MessageSquare className="size-4 mr-2" />
            BI Vendas
          </Link>
          <Button
            type="button"
            size="sm"
            onClick={() => setReloadKey((x) => x + 1)}
            className="rounded-lg"
          >
            <RefreshCw className={cn('size-4 mr-2', loading && 'animate-spin')} aria-hidden />
            Atualizar
          </Button>
        </div>
      }
    >
      <SubTabs tabs={ANALISE_TABS} />
      {/* Filtro de período */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
        <span className="text-xs text-muted-foreground">Período</span>
        <div className="flex gap-1" role="group" aria-label="Filtrar por período">
          {PERIODS.map((p) => (
            <Button
              key={p.key}
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setPeriod(p.key)}
              aria-pressed={period === p.key}
              className={cn(
                'rounded-md border px-3 text-xs transition-colors',
                period === p.key
                  ? 'border-primary/40 bg-primary/10 font-semibold text-primary hover:bg-primary/10 hover:text-primary'
                  : 'border-border/40 hover:bg-muted/40',
              )}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {loading ? <span role="status" className="text-xs text-muted-foreground">Carregando…</span> : null}
      </div>

      {error ? (
        <p className="mb-6 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}

      {!hasAnyData ? (
        <div className="rounded-xl border border-border bg-card py-8">
          <EmptyState
            icon={ShoppingBag}
            title="Sem dados da loja ainda"
            description="Quando os visitantes navegarem pela loja Tricopill, os eventos (visitas, carrinho, compras) aparecem aqui."
          />
        </div>
      ) : (
        <>
          {/* 1 — KPIs */}
          <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <StatCard label="Sessões" value={k?.sessions ?? 0} hint="visitantes únicos no período" />
            <StatCard label="Viu produto" value={k?.viewItem ?? 0} hint="eventos view_item" tone="text-primary" />
            <StatCard label="Add. carrinho" value={k?.addToCart ?? 0} hint="eventos add_to_cart" tone="text-amber-600" />
            <StatCard label="Foi p/ WhatsApp" value={k?.whatsappClicks ?? 0} hint="cliques no botão do zap" tone="text-green-600" />
            <StatCard label="Compras" value={k?.purchases ?? 0} hint="eventos purchase" tone="text-emerald-600" />
            <StatCard
              label="Receita"
              value={formatBRL(k?.revenueCents ?? 0)}
              hint="soma das compras"
              tone="text-emerald-600"
            />
          </section>

          {/* 2 — Funil de conversão */}
          <SectionTitle>Funil de conversão</SectionTitle>
          <section className="mb-8 rounded-xl border border-border bg-card p-6">
            {(data?.funnel.viewItem ?? 0) === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Sem visualizações de produto no período.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {funnelRows.map((r, i) => (
                  <li key={r.name} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 truncate text-xs font-semibold text-foreground/80" title={r.name}>
                      {r.name}
                    </span>
                    <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-muted/30">
                      <div
                        className="h-full rounded-lg transition-all"
                        style={{ width: `${r.width}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-bold tabular-nums text-foreground/80">
                        {r.count}
                      </span>
                    </div>
                    <span className="w-28 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {r.conv == null ? '—' : `${r.conv}% da etapa ant.`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] text-muted-foreground/60">
              <span>
                Conversão geral viu produto → compra:{' '}
                <strong className="text-foreground/70">{pct(data?.funnel.purchase ?? 0, data?.funnel.viewItem ?? 0)}%</strong>
              </span>
              <span>
                Abandono no carrinho:{' '}
                <strong className="text-amber-600">{pct((data?.funnel.addToCart ?? 0) - (data?.funnel.purchase ?? 0), data?.funnel.addToCart ?? 0)}%</strong>
                {' '}({Math.max(0, (data?.funnel.addToCart ?? 0) - (data?.funnel.purchase ?? 0))} de {data?.funnel.addToCart ?? 0} sem comprar)
              </span>
            </div>
          </section>

          {/* 3 + 4 — Produtos & Páginas */}
          <section className="mb-8 grid gap-4 lg:grid-cols-12">
            {/* Produtos mais acessados (view agregada — acumulado) */}
            <div className="rounded-xl border border-border bg-card p-6 lg:col-span-7">
              <div className="mb-4 flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-foreground/90">Produtos mais vistos</p>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
                  {PERIODS.find((p) => p.key === period)?.label ?? 'no período'}
                </span>
              </div>
              {sortedProducts.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">Sem produtos vistos no período.</p>
              ) : (
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Produto</TableHead>
                      {([
                        ['views', 'Views'],
                        ['addToCart', 'Carrinho'],
                        ['addToCartRate', 'Taxa'],
                        ['sessions', 'Sessões'],
                      ] as Array<[SortKey, string]>).map(([key, label]) => (
                        <TableHead key={key} className="pb-2 text-right" aria-sort={sortKey === key ? 'descending' : undefined}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => setSortKey(key)}
                            aria-label={`Ordenar por ${label}`}
                            aria-pressed={sortKey === key}
                            className={cn(
                              'h-auto gap-1 p-0 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-transparent hover:text-foreground',
                              sortKey === key && 'font-bold text-foreground',
                            )}
                          >
                            {label}
                            {sortKey === key ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3 opacity-20" aria-hidden />}
                          </Button>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedProducts.slice(0, 15).map((p) => (
                      <TableRow key={p.productId || p.productName} className="border-t border-border/20">
                        <TableCell className="py-1.5 max-w-[220px] truncate" title={p.productName}>
                          {p.productName}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{p.views}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{p.addToCart}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">{p.addToCartRate}%</TableCell>
                        <TableCell className="py-1.5 text-right font-semibold tabular-nums">{p.sessions}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {/* Páginas mais acessadas */}
            <div className="rounded-xl border border-border bg-card p-6 lg:col-span-5">
              <p className="mb-4 text-sm font-bold text-foreground/90">Páginas mais acessadas</p>
              {(data?.pages ?? []).length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">Sem páginas no período.</p>
              ) : (
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Página</TableHead>
                      <TableHead className="pb-2 text-right">Sessões</TableHead>
                      <TableHead className="pb-2 text-right">Views</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.pages ?? []).slice(0, 15).map((p) => (
                      <TableRow key={p.path} className="border-t border-border/20">
                        <TableCell className="py-1.5 max-w-[200px] truncate font-mono text-[11px]" title={p.path}>
                          {p.path}
                        </TableCell>
                        <TableCell className="py-1.5 text-right font-semibold tabular-nums">{p.sessions}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">{p.views}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </section>

          {/* 5 — Linha do tempo */}
          <SectionTitle>Linha do tempo</SectionTitle>
          <section className="mb-8 rounded-xl border border-border bg-card p-6">
            <p className="mb-4 text-sm font-bold text-foreground/90">Eventos por dia</p>
            {timeline.length === 0 ? (
              <p className="py-16 text-center text-xs text-muted-foreground">Sem eventos no período.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={timeline} margin={{ left: 8, right: 16, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                  <Tooltip
                    formatter={(v, name) => [
                      v,
                      name === 'view_item' ? 'Viu produto' : name === 'add_to_cart' ? 'Add. carrinho' : 'Compra',
                    ]}
                    labelFormatter={(l) => `Dia ${l}`}
                    contentStyle={{ fontSize: 12, borderRadius: 12 }}
                  />
                  <Legend
                    formatter={(v) =>
                      v === 'view_item' ? 'Viu produto' : v === 'add_to_cart' ? 'Add. carrinho' : 'Compra'
                    }
                    wrapperStyle={{ fontSize: 11 }}
                  />
                  <Line type="monotone" dataKey="view_item" stroke={CHART_COLORS[1]} strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="add_to_cart" stroke={CHART_COLORS[3]} strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="purchase" stroke={CHART_COLORS[2]} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </section>

          {/* 6 — Assinatura vs avulso */}
          <SectionTitle>Assinatura vs avulso</SectionTitle>
          <section className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Viu assinatura"
              value={sub?.viewSubscription ?? 0}
              hint="eventos view_subscription"
            />
            <StatCard
              label="Assinaturas"
              value={sub?.subscribe ?? 0}
              hint={formatBRL(sub?.subscribeRevenueCents ?? 0)}
              tone="text-primary"
            />
            <StatCard
              label="Compras avulsas"
              value={sub?.purchase ?? 0}
              hint={formatBRL(sub?.purchaseRevenueCents ?? 0)}
              tone="text-emerald-600"
            />
            <StatCard
              label="% assinatura"
              value={`${pct(sub?.subscribe ?? 0, (sub?.subscribe ?? 0) + (sub?.purchase ?? 0))}%`}
              hint="assinaturas / (assinaturas + avulsas)"
              tone="text-amber-600"
            />
          </section>
          <p className="text-[10px] text-muted-foreground/60">
            Foco do negócio é crescer assinatura. "Recompra" (reorder) no período: {sub?.reorder ?? 0}.
          </p>
        </>
      )}
    </AppLayout>
  )
}
