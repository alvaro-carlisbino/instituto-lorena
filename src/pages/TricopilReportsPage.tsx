import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, RefreshCw, FileSpreadsheet, Package, Repeat, Receipt } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  fetchMonthlyReport,
  fetchShipmentsReport,
  salesCsv,
  closeCsv,
  subsCsv,
  shipmentsCsv,
  downloadCsv,
  type MonthlyReport,
  type Shipment,
} from '@/services/tricopillReports'

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')
const STATUS_PT: Record<string, string> = { active: 'Ativa', ACTIVE: 'Ativa', paused: 'Pausada', INACTIVE: 'Pausada', canceled: 'Cancelada', cancelled: 'Cancelada' }

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-[0.7rem] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

function SectionHeader({ icon, title, onExport }: { icon: React.ReactNode; title: string; onExport: () => void }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">{icon} {title}</h2>
      <Button type="button" variant="outline" size="sm" onClick={onExport}>
        <Download className="mr-1.5 size-4" /> CSV
      </Button>
    </div>
  )
}

export function TricopilReportsPage() {
  const [month, setMonth] = useState(currentMonth())
  const [report, setReport] = useState<MonthlyReport | null>(null)
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (m: string) => {
    setLoading(true)
    try {
      const [rep, ship] = await Promise.all([
        fetchMonthlyReport(m),
        fetchShipmentsReport(m).catch(() => [] as Shipment[]),
      ])
      setReport(rep)
      setShipments(ship)
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
    <AppLayout title="Relatórios Tricopill">
      <PageHeader title="Relatórios Tricopill" description="Fechamento mensal: vendas, receita, envios e assinaturas — com exportação para o financeiro." />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rep-month">Mês</Label>
          <Input id="rep-month" type="month" value={month} max={currentMonth()} onChange={(e) => setMonth(e.target.value)} className="w-44" />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load(month)} disabled={loading}>
          <RefreshCw className={`mr-1.5 size-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
        <div className="flex-1" />
        <Button type="button" size="sm" onClick={exportAll} disabled={!report}>
          <FileSpreadsheet className="mr-1.5 size-4" /> Baixar tudo
        </Button>
      </div>

      {/* ---- Fechamento ---- */}
      <SectionHeader icon={<Receipt className="size-4 text-emerald-600" />} title="Fechamento" onExport={exportClose} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Receita total" value={brl(c?.totalCents ?? 0)} hint={`${c?.count ?? 0} venda(s)`} />
        <Kpi label="Ticket médio" value={brl(c?.ticketCents ?? 0)} />
        <Kpi label="Produtos" value={brl(c?.productCents ?? 0)} hint={`Frete: ${brl(c?.freightCents ?? 0)}`} />
        <Kpi label="Cartão · Pix" value={`${brl(c?.cardCents ?? 0)} · ${brl(c?.pixCents ?? 0)}`} hint={`${c?.cardCount ?? 0} cartão · ${c?.pixCount ?? 0} Pix · descontos ${brl(c?.discountCents ?? 0)}`} />
      </div>
      {c && c.byProduct.length > 0 ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-border bg-card p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Por produto</p>
            <table className="w-full text-xs">
              <tbody>
                {c.byProduct.map((p) => (
                  <tr key={p.product} className="border-b border-border/40 last:border-0">
                    <td className="py-1">{p.product}</td>
                    <td className="py-1 text-right tabular-nums text-muted-foreground">{p.count}×</td>
                    <td className="py-1 text-right tabular-nums font-medium">{brl(p.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {c.byCoupon.length > 0 ? (
            <div className="rounded-md border border-border bg-card p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Cupons</p>
              <table className="w-full text-xs">
                <tbody>
                  {c.byCoupon.map((cp) => (
                    <tr key={cp.code} className="border-b border-border/40 last:border-0">
                      <td className="py-1 font-medium">{cp.code}</td>
                      <td className="py-1 text-right tabular-nums text-muted-foreground">{cp.count}×</td>
                      <td className="py-1 text-right tabular-nums text-rose-600">-{brl(cp.discountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- Vendas do mês ---- */}
      <SectionHeader icon={<Receipt className="size-4 text-sky-600" />} title={`Vendas do mês (${report?.sales.length ?? 0})`} onExport={exportSales} />
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Produto</th>
              <th className="px-3 py-2 font-medium">Forma</th>
              <th className="px-3 py-2 font-medium text-right">Frete</th>
              <th className="px-3 py-2 font-medium text-right">Valor</th>
              <th className="px-3 py-2 font-medium">Bling</th>
            </tr>
          </thead>
          <tbody>
            {(report?.sales ?? []).map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="whitespace-nowrap px-3 py-2">{dt(r.paidAt)}</td>
                <td className="px-3 py-2">{r.customerName}</td>
                <td className="px-3 py-2">{r.product}</td>
                <td className="px-3 py-2">{r.method === 'card' ? `Cartão${r.installments ? ` ${r.installments}x` : ''}` : 'Pix'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.freightCents ? brl(r.freightCents) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{brl(r.amountCents)}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.blingOrderId ?? '—'}</td>
              </tr>
            ))}
            {!loading && (report?.sales.length ?? 0) === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sem vendas neste mês.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* ---- Envios ---- */}
      <SectionHeader icon={<Package className="size-4 text-amber-600" />} title={`Envios (${shipments.length})`} onExport={exportShip} />
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Rastreio</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Serviço</th>
              <th className="px-3 py-2 font-medium">Postado</th>
              <th className="px-3 py-2 font-medium">Cidade</th>
              <th className="px-3 py-2 font-medium text-right">Frete</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2">{s.cliente}</td>
                <td className="px-3 py-2 font-mono">{s.tracking ?? '—'}</td>
                <td className="px-3 py-2">{s.status}</td>
                <td className="px-3 py-2 text-muted-foreground">{s.service}</td>
                <td className="whitespace-nowrap px-3 py-2">{dt(s.postedAt)}</td>
                <td className="px-3 py-2 text-muted-foreground">{s.cidade}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.priceCents ? brl(s.priceCents) : '—'}</td>
              </tr>
            ))}
            {!loading && shipments.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sem envios neste mês (ou Melhor Envio sem etiquetas no período).</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* ---- Assinaturas ---- */}
      <SectionHeader icon={<Repeat className="size-4 text-violet-600" />} title="Assinaturas (clube)" onExport={exportSubs} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="MRR" value={brl(report?.subs.mrrCents ?? 0)} hint="receita recorrente/mês" />
        <Kpi label="Ativas" value={String(report?.subs.active ?? 0)} />
        <Kpi label="Pausadas" value={String(report?.subs.paused ?? 0)} />
        <Kpi label="Canceladas" value={String(report?.subs.canceled ?? 0)} />
      </div>
      {report && report.subs.rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Plano</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Valor/mês</th>
                <th className="px-3 py-2 font-medium text-right">Ciclos pagos</th>
              </tr>
            </thead>
            <tbody>
              {report.subs.rows.map((r, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.plan}</td>
                  <td className="px-3 py-2">{STATUS_PT[r.status] ?? r.status}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{brl(r.monthlyCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.paidCycles}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="h-8" />
    </AppLayout>
  )
}
