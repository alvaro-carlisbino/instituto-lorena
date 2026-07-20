import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, RefreshCw, FileSpreadsheet, Package, Repeat, Receipt, Store, TrendingUp, TrendingDown } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { StatCard } from '@/components/page/StatCard'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  fetchMonthlyReport,
  fetchMonthlyTrend,
  fetchShipmentsReport,
  salesCsv,
  closeCsv,
  subsCsv,
  shipmentsCsv,
  downloadCsv,
  type MonthlyReport,
  type MonthPoint,
  type Shipment,
} from '@/services/tricopillReports'
import { blingSalesList, type BlingSaleRow } from '@/services/crmBling'

// CSV do relatório completo do Bling (todos os pedidos, com origem CRM × externo).
function blingCsv(rows: BlingSaleRow[]): string {
  const head = 'data;numero;cliente;valor;origem;status'
  const body = rows.map((r) => [
    r.date,
    r.numero,
    r.name.replace(/;/g, ','),
    (r.totalCents / 100).toFixed(2).replace('.', ','),
    r.viaCrm ? `CRM (${r.gateway})` : 'Marketplace/Manual',
    r.canceled ? 'cancelado' : 'ativo',
  ].join(';'))
  return [head, ...body].join('\n')
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
const STATUS_PT: Record<string, string> = { active: 'Ativa', ACTIVE: 'Ativa', paused: 'Pausada', INACTIVE: 'Pausada', canceled: 'Cancelada', cancelled: 'Cancelada' }

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-')
  return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1] ?? m}/${y.slice(2)}`
}

/** Badge de variação % vs. valor anterior (▲ verde / ▼ vermelho). null se não há base. */
function DeltaBadge({ cur, prev }: { cur: number; prev: number | undefined }) {
  if (prev == null || prev === 0) return null
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return <span className="text-[0.7rem] text-muted-foreground">0% vs. mês ant.</span>
  const up = pct > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[0.7rem] font-medium ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? '+' : ''}{pct}% vs. mês ant.
    </span>
  )
}

/** Mini gráfico de barras da evolução mensal (receita), dependency-free. */
function TrendChart({ points, month }: { points: MonthPoint[]; month: string }) {
  if (points.length === 0) return null
  const max = Math.max(1, ...points.map((p) => p.totalCents))
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="mb-3 text-xs font-semibold text-muted-foreground">Evolução da receita (últimos {points.length} meses)</p>
      <div className="flex items-end gap-2" style={{ height: 120 }}>
        {points.map((p) => {
          const h = Math.round((p.totalCents / max) * 100)
          const isCur = p.month === month
          return (
            <div key={p.month} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${monthLabel(p.month)}: ${brl(p.totalCents)} (${p.count} vendas)`}>
              <span className="text-[0.6rem] tabular-nums text-muted-foreground">{p.totalCents ? (p.totalCents / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : ''}</span>
              <div className={`w-full rounded-t ${isCur ? 'bg-emerald-500' : 'bg-emerald-500/30'}`} style={{ height: `${Math.max(2, h)}%` }} />
              <span className={`text-[0.65rem] ${isCur ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{monthLabel(p.month)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SectionHeader({ icon, title, onExport }: { icon: React.ReactNode; title: string; onExport?: () => void }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">{icon} {title}</h2>
      {onExport ? (
        <Button type="button" variant="outline" size="sm" onClick={onExport}>
          <Download className="mr-1.5 size-4" aria-hidden /> CSV
        </Button>
      ) : null}
    </div>
  )
}

export function TricopilReportsPage() {
  const [month, setMonth] = useState(currentMonth())
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [trend, setTrend] = useState<MonthPoint[]>([])
  const [blingRows, setBlingRows] = useState<BlingSaleRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (m: string) => {
    setLoading(true)
    try {
      // Intervalo do mês pro Bling (data do pedido): 1º dia até o último dia.
      const [y, mm] = m.split('-').map(Number)
      const lastDay = new Date(y, mm, 0).getDate()
      const [rep, ship, tr, bl] = await Promise.all([
        fetchMonthlyReport(m),
        fetchShipmentsReport(m).catch(() => [] as Shipment[]),
        fetchMonthlyTrend(m, 6).catch(() => [] as MonthPoint[]),
        blingSalesList(`${m}-01`, `${m}-${String(lastDay).padStart(2, '0')}`).catch(() => null),
      ])
      setReport(rep)
      setShipments(ship)
      setTrend(tr)
      setBlingRows(bl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar os relatórios.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga ao trocar o mês
    void load(month)
  }, [month, load])

  const c = report?.close
  const prevPoint = trend.length >= 2 && trend[trend.length - 1]?.month === month ? trend[trend.length - 2] : undefined
  const prevTicket = prevPoint && prevPoint.count ? Math.round(prevPoint.totalCents / prevPoint.count) : undefined
  const exportClose = () => c && downloadCsv(`fechamento-${month}.csv`, closeCsv(c))
  const exportSales = () => report && downloadCsv(`vendas-${month}.csv`, salesCsv(report.sales))
  const exportShip = () => downloadCsv(`envios-${month}.csv`, shipmentsCsv(shipments))
  const exportSubs = () => report && downloadCsv(`assinaturas-${month}.csv`, subsCsv(report.subs))
  const exportAll = () => {
    if (!report) return
    exportClose()
    exportSales()
    exportShip()
    exportSubs()
    toast.success('4 relatórios baixados.')
  }

  return (
    <AppLayout title="Relatórios de vendas" subtitle="Fechamento mensal: vendas, receita, envios e assinaturas, com exportação para o financeiro.">
      <SubTabs tabs={[{ to: '/relatorio-vendas', label: 'Por dia' }, { to: '/tricopill-relatorios', label: 'Por mês' }]} />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rep-month">Mês</Label>
          <Input id="rep-month" type="month" value={month} max={currentMonth()} onChange={(e) => setMonth(e.target.value)} className="w-44" />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load(month)} disabled={loading}>
          <RefreshCw className={`mr-1.5 size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
        </Button>
        <div className="flex-1" />
        <Button type="button" size="sm" onClick={exportAll} disabled={!report}>
          <FileSpreadsheet className="mr-1.5 size-4" aria-hidden /> Baixar tudo
        </Button>
      </div>

      {/* ---- FECHAMENTO = BLING (tudo que foi vendido: site, WhatsApp, marketplace, manual).
           O numero principal da tela e a venda COMPLETA; os gateways viram recorte abaixo. ---- */}
      <SectionHeader
        icon={<Store className="size-4 text-primary" />}
        title="Fechamento · tudo que vendemos (Bling)"
        onExport={blingRows?.length ? () => downloadCsv(`bling-${month}.csv`, blingCsv(blingRows)) : undefined}
      />
      {blingRows === null ? (
        <p className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Bling indisponível agora. O fechamento acima cobre só site e WhatsApp; atualize pra tentar de novo.
        </p>
      ) : (() => {
        const ativos = blingRows.filter((r) => !r.canceled)
        const viaCrm = ativos.filter((r) => r.viaCrm)
        const externos = ativos.filter((r) => !r.viaCrm)
        const sum = (rows: BlingSaleRow[]) => rows.reduce((s, r) => s + r.totalCents, 0)
        const totalCents = sum(ativos)
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Receita total"
                value={brl(totalCents)}
                hint={`${ativos.length} pedido(s) · ticket ${brl(ativos.length ? Math.round(totalCents / ativos.length) : 0)}`}
              />
              <StatCard
                label="Via CRM (site + WhatsApp)"
                value={brl(sum(viaCrm))}
                hint={`${viaCrm.length} pedido(s)`}
              />
              <StatCard
                label="Marketplace / manual"
                value={brl(sum(externos))}
                hint={`${externos.length} pedido(s) que só existem no Bling`}
              />
              <StatCard
                label="Cancelados"
                value={String(blingRows.length - ativos.length)}
                hint="fora da soma"
              />
            </div>
            {externos.length > 0 ? (
              <div className="mt-3 rounded-md border border-border bg-card p-3">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">
                  Pedidos fora do CRM (invisíveis nos relatórios antigos)
                </p>
                <div className="overflow-x-auto">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Pedido</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {externos.map((r) => (
                        <TableRow key={r.orderId} className="border-border/40">
                          <TableCell className="py-1.5 whitespace-nowrap">{r.date.split('-').reverse().join('/')}</TableCell>
                          <TableCell className="py-1.5 tabular-nums">#{r.numero || r.orderId}</TableCell>
                          <TableCell className="py-1.5">{r.name}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums font-medium">{brl(r.totalCents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <p className="mt-3 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                Neste mês, todo pedido do Bling nasceu no CRM (site ou WhatsApp). Quando entrar venda de marketplace ou manual, ela aparece aqui.
              </p>
            )}
          </>
        )
      })()}

      {/* ---- Recorte: recebido nos GATEWAYS (site + WhatsApp via e.Rede/Asaas) ---- */}
      <SectionHeader icon={<Receipt className="size-4 text-emerald-600" />} title="Site + WhatsApp (recebido nos gateways)" onExport={exportClose} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Recebido no período" value={brl(c?.totalCents ?? 0)} hint={`${c?.count ?? 0} venda(s)`} delta={<DeltaBadge cur={c?.totalCents ?? 0} prev={prevPoint?.totalCents} />} />
        <StatCard label="Ticket médio" value={brl(c?.ticketCents ?? 0)} delta={<DeltaBadge cur={c?.ticketCents ?? 0} prev={prevTicket} />} />
        <StatCard label="Produtos" value={brl(c?.productCents ?? 0)} hint={`Frete: ${brl(c?.freightCents ?? 0)}`} />
        <StatCard label="Cartão · Pix" valueClassName="text-base" value={`${brl(c?.cardCents ?? 0)} · ${brl(c?.pixCents ?? 0)}`} hint={`${c?.cardCount ?? 0} cartão · ${c?.pixCount ?? 0} Pix · descontos ${brl(c?.discountCents ?? 0)}`} />
      </div>
      {trend.length > 1 ? <div className="mt-3"><TrendChart points={trend} month={month} /></div> : null}
      {c && c.byProduct.length > 0 ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-border bg-card p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Por produto</p>
            <Table className="text-xs">
              <TableBody>
                {c.byProduct.map((p) => (
                  <TableRow key={p.product} className="border-border/40">
                    <TableCell className="px-0 py-1">{p.product}</TableCell>
                    <TableCell className="px-0 py-1 text-right tabular-nums text-muted-foreground">{p.count}×</TableCell>
                    <TableCell className="px-0 py-1 text-right tabular-nums font-medium">{brl(p.cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {c.byCoupon.length > 0 ? (
            <div className="rounded-md border border-border bg-card p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Cupons</p>
              <Table className="text-xs">
                <TableBody>
                  {c.byCoupon.map((cp) => (
                    <TableRow key={cp.code} className="border-border/40">
                      <TableCell className="px-0 py-1 font-medium">{cp.code}</TableCell>
                      <TableCell className="px-0 py-1 text-right tabular-nums text-muted-foreground">{cp.count}×</TableCell>
                      <TableCell className="px-0 py-1 text-right tabular-nums text-rose-600">-{brl(cp.discountCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- Vendas do mês ---- */}
      <SectionHeader icon={<Receipt className="size-4 text-sky-600" />} title={`Vendas do mês (${report?.sales.length ?? 0})`} onExport={exportSales} />
      <div className="rounded-md border border-border">
        <Table className="text-left text-xs">
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead>Data</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Forma</TableHead>
              <TableHead className="text-right">Frete</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Bling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(report?.sales ?? []).map((r, i) => (
              <TableRow key={i} className="hover:bg-muted/20">
                <TableCell className="whitespace-nowrap py-2">{dt(r.paidAt)}</TableCell>
                <TableCell className="py-2">{r.customerName}</TableCell>
                <TableCell className="py-2">{r.product}</TableCell>
                <TableCell className="py-2">{r.method === 'card' ? `Cartão${r.installments ? ` ${r.installments}x` : ''}` : 'Pix'}</TableCell>
                <TableCell className="py-2 text-right tabular-nums text-muted-foreground">{r.freightCents ? brl(r.freightCents) : '—'}</TableCell>
                <TableCell className="py-2 text-right tabular-nums font-medium">{brl(r.amountCents)}</TableCell>
                <TableCell className="py-2 text-muted-foreground">{r.blingOrderId ?? '—'}</TableCell>
              </TableRow>
            ))}
            {!loading && (report?.sales.length ?? 0) === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7}>
                  <EmptyState className="py-6" icon={Receipt} title="Sem vendas neste mês" />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {/* ---- Envios ---- */}
      <SectionHeader icon={<Package className="size-4 text-amber-600" />} title={`Envios (${shipments.length})`} onExport={exportShip} />
      <div className="rounded-md border border-border">
        <Table className="text-left text-xs">
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead>Cliente</TableHead>
              <TableHead>Rastreio</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Serviço</TableHead>
              <TableHead>Postado</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead className="text-right">Frete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipments.map((s, i) => (
              <TableRow key={i} className="hover:bg-muted/20">
                <TableCell className="py-2">{s.cliente}</TableCell>
                <TableCell className="py-2 font-mono">{s.tracking ?? '—'}</TableCell>
                <TableCell className="py-2">{s.status}</TableCell>
                <TableCell className="py-2 text-muted-foreground">{s.service}</TableCell>
                <TableCell className="whitespace-nowrap py-2">{dt(s.postedAt)}</TableCell>
                <TableCell className="py-2 text-muted-foreground">{s.cidade}</TableCell>
                <TableCell className="py-2 text-right tabular-nums">{s.priceCents ? brl(s.priceCents) : '—'}</TableCell>
              </TableRow>
            ))}
            {!loading && shipments.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7}>
                  <EmptyState className="py-6" icon={Package} title="Sem envios neste mês" description="Ou o Melhor Envio está sem etiquetas no período." />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {/* ---- Assinaturas ---- */}
      <SectionHeader icon={<Repeat className="size-4 text-violet-600" />} title="Assinaturas (clube)" onExport={exportSubs} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="MRR" value={brl(report?.subs.mrrCents ?? 0)} hint="receita recorrente/mês" />
        <StatCard label="Ativas" value={String(report?.subs.active ?? 0)} />
        <StatCard label="Pausadas" value={String(report?.subs.paused ?? 0)} />
        <StatCard label="Canceladas" value={String(report?.subs.canceled ?? 0)} />
      </div>
      {report && report.subs.rows.length > 0 ? (
        <div className="mt-3 rounded-md border border-border">
          <Table className="text-left text-xs">
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead>Cliente</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Valor/mês</TableHead>
                <TableHead className="text-right">Ciclos pagos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.subs.rows.map((r, i) => (
                <TableRow key={i} className="hover:bg-muted/20">
                  <TableCell className="py-2">{r.name}</TableCell>
                  <TableCell className="py-2 text-muted-foreground">{r.plan}</TableCell>
                  <TableCell className="py-2">{STATUS_PT[r.status] ?? r.status}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums font-medium">{brl(r.monthlyCents)}</TableCell>
                  <TableCell className="py-2 text-right tabular-nums">{r.paidCycles}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <div className="h-8" />
    </AppLayout>
  )
}
