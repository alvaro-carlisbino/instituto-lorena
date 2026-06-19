import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, RefreshCw, Truck } from 'lucide-react'
import { toast } from 'sonner'

import { AppLayout } from '@/layouts/AppLayout'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCrm } from '@/context/CrmContext'
import { fetchUnifiedPayments, type PaymentStatus, type UnifiedPayment } from '@/services/crmPaymentsUnified'
import { setShipStatus } from '@/services/crmOrders'
import { refreshTracking } from '@/services/crmFrete'
import { kitLabel } from '@/services/tricopillBi'
import {
  classifyDelivery,
  DELIVERY_FILTER_OPTIONS,
  getShipStatus,
  SHIP_STATUS_OPTIONS,
  type DeliveryKind,
  type ShipStatus,
} from '@/lib/deliveryType'
import { cn } from '@/lib/utils'

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function shortDateTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const STATUS_META: Record<PaymentStatus, { label: string; cls: string }> = {
  paid: { label: '✓ Pago', cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300' },
  pending: { label: '⏳ Aguardando', cls: 'bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300' },
  failed: { label: '✕ Falhou', cls: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300' },
}

const DELIVERY_META: Record<DeliveryKind, { label: string; cls: string }> = {
  motoboy: { label: '🛵 Motoboy', cls: 'bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300' },
  retirada: { label: '🏠 Retirada', cls: 'bg-violet-500/10 text-violet-700 ring-violet-500/25 dark:text-violet-300' },
  correios: { label: '📦 Correios', cls: 'bg-orange-500/10 text-orange-700 ring-orange-500/25 dark:text-orange-300' },
  desconhecido: { label: '— Não inform.', cls: 'bg-muted text-muted-foreground ring-border/40' },
}

const PILL = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1'

export function TricopilOrdersPage() {
  const crm = useCrm()
  const [rows, setRows] = useState<UnifiedPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | PaymentStatus>('all')
  const [methodFilter, setMethodFilter] = useState<'all' | 'pix' | 'card'>('all')
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | DeliveryKind>('all')
  const [shipFilter, setShipFilter] = useState<'all' | ShipStatus>('all')
  // Override otimista do status logístico por lead (evita reler tudo após salvar).
  const [shipOverride, setShipOverride] = useState<Record<string, ShipStatus>>({})
  const [savingShip, setSavingShip] = useState<string | null>(null)
  const [trackingByLead, setTrackingByLead] = useState<Record<string, string>>({})
  const [refreshingTrack, setRefreshingTrack] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchUnifiedPayments(1000)
      .then((res) => {
        if (!cancelled) setRows(res)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar pedidos.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  // Mapa leadId → lead (p/ classificar entrega e completar nome).
  const leadById = useMemo(() => {
    const m = new Map<string, (typeof crm.leads)[number]>()
    for (const l of crm.leads) m.set(l.id, l)
    return m
  }, [crm.leads])

  const deliveryOf = (p: UnifiedPayment): DeliveryKind => {
    const lead = p.leadId ? leadById.get(p.leadId) : undefined
    if (!lead) return 'desconhecido'
    return classifyDelivery(lead).kind
  }

  const shipOf = (p: UnifiedPayment): ShipStatus => {
    if (!p.leadId) return 'a_preparar'
    return shipOverride[p.leadId] ?? getShipStatus(leadById.get(p.leadId))
  }

  // Rastreio já salvo no lead (custom_fields.entrega.tracking), preenchido pelo refresh.
  const persistedTracking = (p: UnifiedPayment): string => {
    if (!p.leadId) return ''
    const ent = ((leadById.get(p.leadId)?.customFields ?? {}) as Record<string, unknown>).entrega as
      | Record<string, unknown>
      | undefined
    return ent?.tracking ? String(ent.tracking) : ''
  }

  const doRefreshTracking = async (p: UnifiedPayment) => {
    if (!p.leadId) return
    setRefreshingTrack(p.leadId)
    try {
      const r = await refreshTracking(p.leadId)
      if (!r.ok) {
        toast.message(r.error === 'sem_envio_me' ? 'Sem envio no Melhor Envio pra este pedido.' : 'Ainda sem rastreio no Melhor Envio (compre a etiqueta no painel).')
        return
      }
      if (r.mapped) setShipOverride((m) => ({ ...m, [p.leadId as string]: r.mapped as ShipStatus }))
      if (r.tracking) setTrackingByLead((m) => ({ ...m, [p.leadId as string]: r.tracking as string }))
      toast.success(r.tracking ? `Rastreio: ${r.tracking}${r.meStatus ? ` (${r.meStatus})` : ''}` : `Status no ME: ${r.meStatus ?? 'sem rastreio ainda'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar rastreio.')
    } finally {
      setRefreshingTrack(null)
    }
  }

  const changeShip = async (p: UnifiedPayment, next: ShipStatus) => {
    if (!p.leadId) return
    const lead = leadById.get(p.leadId)
    const prev = shipOf(p)
    setShipOverride((m) => ({ ...m, [p.leadId as string]: next }))
    setSavingShip(p.leadId)
    try {
      await setShipStatus(p.leadId, lead?.customFields ?? null, next)
    } catch (e) {
      setShipOverride((m) => ({ ...m, [p.leadId as string]: prev }))
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar o status de envio.')
    } finally {
      setSavingShip(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (methodFilter !== 'all' && p.method !== methodFilter) return false
      if (deliveryFilter !== 'all' && deliveryOf(p) !== deliveryFilter) return false
      if (shipFilter !== 'all' && shipOf(p) !== shipFilter) return false
      if (q) {
        const hay = [p.customerName, p.phone, p.customerDoc, p.description, p.kit].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, statusFilter, methodFilter, deliveryFilter, shipFilter, leadById, shipOverride])

  const kpis = useMemo(() => {
    const paid = filtered.filter((p) => p.status === 'paid')
    const pending = filtered.filter((p) => p.status === 'pending')
    const revenue = paid.reduce((s, p) => s + p.amountCents, 0)
    // Frete médio: só pedidos com frete informado e > 0 (exclui retirada/Maringá grátis e
    // pedidos antigos sem o dado). Asaas é o único que grava freight_cents.
    const comFrete = filtered.filter((p) => p.freightCents != null && p.freightCents > 0)
    const freteMedio = comFrete.length > 0 ? Math.round(comFrete.reduce((s, p) => s + (p.freightCents ?? 0), 0) / comFrete.length) : 0
    return { total: filtered.length, paid: paid.length, pending: pending.length, revenue, freteMedio, comFreteCount: comFrete.length }
  }, [filtered])

  return (
    <AppLayout title="Pedidos Tricopill">
      <PageHeader
        title="Pedidos"
        description="Todos os pedidos do Tricopill num lugar só — pagamento, tipo de entrega e Bling."
        actions={
          <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Atualizar
          </Button>
        }
      />

      {/* KPIs */}
      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Pedidos (filtro)" value={String(kpis.total)} />
        <KpiCard label="Pagos" value={String(kpis.paid)} tone="text-emerald-600" />
        <KpiCard label="Aguardando" value={String(kpis.pending)} tone="text-amber-600" />
        <KpiCard label="Receita paga" value={brl(kpis.revenue)} tone="text-foreground" />
        <KpiCard
          label="Frete médio"
          value={kpis.comFreteCount > 0 ? brl(kpis.freteMedio) : '—'}
          tone="text-foreground"
        />
      </section>

      {/* Filtros */}
      <section className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente, telefone, CPF…"
          className="sm:max-w-[280px]"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | PaymentStatus)}>
          <SelectTrigger className="sm:w-[160px]"><SelectValue placeholder="Pagamento" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos (pgto)</SelectItem>
            <SelectItem value="paid">✓ Pagos</SelectItem>
            <SelectItem value="pending">⏳ Aguardando</SelectItem>
            <SelectItem value="failed">✕ Falhou</SelectItem>
          </SelectContent>
        </Select>
        <Select value={methodFilter} onValueChange={(v) => setMethodFilter(v as 'all' | 'pix' | 'card')}>
          <SelectTrigger className="sm:w-[150px]"><SelectValue placeholder="Método" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos (método)</SelectItem>
            <SelectItem value="pix">Pix</SelectItem>
            <SelectItem value="card">Cartão</SelectItem>
          </SelectContent>
        </Select>
        <Select value={deliveryFilter} onValueChange={(v) => setDeliveryFilter(v as 'all' | DeliveryKind)}>
          <SelectTrigger className="sm:w-[180px]"><SelectValue placeholder="Entrega" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas (entrega)</SelectItem>
            {DELIVERY_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={shipFilter} onValueChange={(v) => setShipFilter(v as 'all' | ShipStatus)}>
          <SelectTrigger className="sm:w-[170px]"><SelectValue placeholder="Status envio" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos (envio)</SelectItem>
            {SHIP_STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {error ? (
        <p className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <div className="rounded-2xl border border-border/30 bg-card/40 overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow className="text-left text-muted-foreground">
              <TableHead className="px-3 py-2">Cliente</TableHead>
              <TableHead className="px-3 py-2">Kit</TableHead>
              <TableHead className="px-3 py-2 text-right">Valor</TableHead>
              <TableHead className="px-3 py-2">Pagamento</TableHead>
              <TableHead className="px-3 py-2">Entrega</TableHead>
              <TableHead className="px-3 py-2">Status envio</TableHead>
              <TableHead className="px-3 py-2">Bling</TableHead>
              <TableHead className="px-3 py-2">Data</TableHead>
              <TableHead className="px-3 py-2"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Nenhum pedido com esses filtros.</TableCell></TableRow>
            ) : (
              filtered.map((p) => {
                const lead = p.leadId ? leadById.get(p.leadId) : undefined
                const name = p.customerName || lead?.patientName || 'Cliente'
                const dk = deliveryOf(p)
                const dm = DELIVERY_META[dk]
                const sm = STATUS_META[p.status]
                return (
                  <TableRow key={`${p.method}:${p.id}`} className="border-t border-border/20 align-middle">
                    <TableCell className="px-3 py-2">
                      <div className="font-semibold text-foreground/90">{name}</div>
                      {p.phone ? <div className="text-[10px] text-muted-foreground">{p.phone}</div> : null}
                    </TableCell>
                    <TableCell className="px-3 py-2">{p.kit ? kitLabel(p.kit) : (p.description ?? '—')}</TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      <div className="font-semibold tabular-nums">{brl(p.amountCents)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.method === 'pix' ? 'Pix' : 'Cartão'}{p.installments > 1 ? ` · ${p.installments}x` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <span className={cn(PILL, sm.cls)}>{sm.label}</span>
                      {p.paidAt ? <div className="mt-0.5 text-[10px] text-muted-foreground">{shortDateTime(p.paidAt)}</div> : null}
                    </TableCell>
                    <TableCell className="px-3 py-2"><span className={cn(PILL, dm.cls)}>{dm.label}</span></TableCell>
                    <TableCell className="px-3 py-2">
                      {p.leadId ? (
                        <select
                          value={shipOf(p)}
                          onChange={(e) => void changeShip(p, e.target.value as ShipStatus)}
                          disabled={savingShip === p.leadId}
                          className="h-7 max-w-[130px] rounded-md border border-border/50 bg-background px-1.5 text-[11px]"
                        >
                          {SHIP_STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <div className="flex flex-col gap-0.5">
                        {p.blingOrderId ? (
                          <span className="w-fit rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Bling #{p.blingOrderId}</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">— sem pedido</span>
                        )}
                        {p.meOrderId ? (
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => void doRefreshTracking(p)}
                              disabled={refreshingTrack === p.leadId}
                              className="inline-flex w-fit items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-500/20 disabled:opacity-60"
                              title={`Melhor Envio: ${p.meOrderId}. Clique para puxar o rastreio.`}
                            >
                              <Truck className={cn('size-3', refreshingTrack === p.leadId && 'animate-pulse')} />
                              {refreshingTrack === p.leadId ? 'Buscando…' : 'Atualizar rastreio'}
                            </button>
                            {((p.leadId && trackingByLead[p.leadId]) || persistedTracking(p)) ? (
                              <span className="text-[10px] tabular-nums text-muted-foreground">
                                🔎 {(p.leadId && trackingByLead[p.leadId]) || persistedTracking(p)}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2 whitespace-nowrap text-muted-foreground">{shortDateTime(p.createdAt)}</TableCell>
                    <TableCell className="px-3 py-2">
                      {p.leadId ? (
                        <Link to={`/leads/${p.leadId}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                          Abrir <ExternalLink className="size-3" />
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Mostra cartão (Asaas/Rede) + Pix (Asaas/PagBank) do polo. "Bling" mostra o nº do pedido quando emitido automaticamente.
        Entrega "Não inform." = venda sem tipo registrado (antigas/manuais).
      </p>
    </AppLayout>
  )
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border/30 bg-card/40 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-black tabular-nums', tone ?? 'text-foreground')}>{value}</p>
    </div>
  )
}
