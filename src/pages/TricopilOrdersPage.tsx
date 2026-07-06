import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, RefreshCw, Search, Truck, X } from 'lucide-react'
import { toast } from 'sonner'

import { AppLayout } from '@/layouts/AppLayout'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
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
  needsShippingAddress,
  shipStatusLabel,
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

const PILL = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1'

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

// Origem do pedido. Não há campo de origem nos pagamentos, então é derivado do lead
// vinculado (best-effort): bot de vendas no WhatsApp (lead com instância W-API ou source
// whatsapp/meta) × loja no site (checkout sem lead do CRM) × lançamento manual.
type OrderOrigin = 'whatsapp' | 'site' | 'manual'
const ORIGIN_META: Record<OrderOrigin, { label: string; cls: string }> = {
  whatsapp: { label: '🟢 WhatsApp', cls: 'bg-green-500/10 text-green-700 ring-green-500/25 dark:text-green-300' },
  site: { label: '🛒 Site', cls: 'bg-indigo-500/10 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300' },
  manual: { label: '✍️ Manual', cls: 'bg-muted text-muted-foreground ring-border/40' },
}

const STATUS_SEG: Array<{ v: 'all' | PaymentStatus; l: string }> = [
  { v: 'all', l: 'Todos' },
  { v: 'paid', l: 'Pagos' },
  { v: 'pending', l: 'Aguardando' },
  { v: 'failed', l: 'Falhou' },
]

const filterSelectCls = 'min-w-[140px] rounded-xl border-border/40 bg-muted/20 text-xs font-bold uppercase tracking-tight'

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
  const [shipOverride, setShipOverride] = useState<Record<string, ShipStatus>>({})
  const [savingShip, setSavingShip] = useState<string | null>(null)
  const [trackingByLead, setTrackingByLead] = useState<Record<string, string>>({})
  const [refreshingTrack, setRefreshingTrack] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchUnifiedPayments(1000)
      .then((res) => { if (!cancelled) setRows(res) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar pedidos.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  const leadById = useMemo(() => {
    const m = new Map<string, (typeof crm.leads)[number]>()
    for (const l of crm.leads) m.set(l.id, l)
    return m
  }, [crm.leads])

  const deliveryOf = (p: UnifiedPayment): DeliveryKind => {
    const lead = p.leadId ? leadById.get(p.leadId) : undefined
    return lead ? classifyDelivery(lead).kind : 'desconhecido'
  }

  const originOf = (p: UnifiedPayment): OrderOrigin => {
    const lead = p.leadId ? leadById.get(p.leadId) : undefined
    if (!lead) return 'site' // checkout da loja: cliente não vira lead do WhatsApp
    if (lead.whatsappInstanceId) return 'whatsapp' // veio do bot de vendas (W-API)
    const src = String(lead.source ?? '').toLowerCase()
    if (src.includes('whatsapp') || src.startsWith('meta')) return 'whatsapp'
    // O checkout do site grava custom_fields.origin='site' no lead — sinal CONFIÁVEL de venda
    // do site, mesmo quando o lead foi deduplicado por telefone e ficou com source 'manual'.
    if (String((lead.customFields as Record<string, unknown> | undefined)?.origin ?? '') === 'site') return 'site'
    if (String(p.leadId ?? '').startsWith('site-')) return 'site'
    return 'manual' // lead criado à mão / sem origem clara
  }

  const shipOf = (p: UnifiedPayment): ShipStatus => {
    if (!p.leadId) return 'a_preparar'
    return shipOverride[p.leadId] ?? getShipStatus(leadById.get(p.leadId))
  }

  const persistedTracking = (p: UnifiedPayment): string => {
    if (!p.leadId) return ''
    const ent = ((leadById.get(p.leadId)?.customFields ?? {}) as Record<string, unknown>).entrega as Record<string, unknown> | undefined
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
    const comFrete = filtered.filter((p) => p.freightCents != null && p.freightCents > 0)
    const freteMedio = comFrete.length > 0 ? Math.round(comFrete.reduce((s, p) => s + (p.freightCents ?? 0), 0) / comFrete.length) : 0
    return { total: filtered.length, paid: paid.length, pending: pending.length, revenue, freteMedio, comFreteCount: comFrete.length }
  }, [filtered])

  const hasActiveFilters = search.trim() !== '' || statusFilter !== 'all' || methodFilter !== 'all' || deliveryFilter !== 'all' || shipFilter !== 'all'
  const clearFilters = () => {
    setSearch(''); setStatusFilter('all'); setMethodFilter('all'); setDeliveryFilter('all'); setShipFilter('all')
  }

  return (
    <AppLayout
      title="Pedidos"
      subtitle="Pagamento, entrega, Bling e rastreio — tudo num lugar"
      actions={
        <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Atualizar
        </Button>
      }
    >
      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Pedidos" value={String(kpis.total)} hint="no filtro atual" />
        <KpiCard label="Pagos" value={String(kpis.paid)} tone="text-emerald-600" />
        <KpiCard label="Aguardando" value={String(kpis.pending)} tone="text-amber-600" />
        <KpiCard label="Receita paga" value={brl(kpis.revenue)} />
        <KpiCard label="Frete médio" value={kpis.comFreteCount > 0 ? brl(kpis.freteMedio) : '—'} hint={kpis.comFreteCount > 0 ? `${kpis.comFreteCount} c/ frete` : 'sem dado ainda'} />
      </section>

      {/* Toolbar de filtros */}
      <section className="flex flex-col gap-3 border-b border-border/20 pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <InputGroup className="w-full sm:max-w-[320px]">
            <InputGroupAddon className="rounded-l-xl border-border/40 bg-muted/20">
              <Search className="size-3.5 opacity-50" />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente, telefone, CPF…"
              className="rounded-r-xl border-border/40 bg-muted/10 text-xs font-medium placeholder:text-muted-foreground/50"
            />
          </InputGroup>
          <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground sm:ml-auto">
            <span className="tabular-nums">{filtered.length} pedido{filtered.length === 1 ? '' : 's'}</span>
            {hasActiveFilters ? (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-primary hover:bg-primary/10">
                <X className="size-3" /> Limpar
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Pagamento = filtro principal, como segmented control */}
          <div className="inline-flex shrink-0 rounded-xl bg-muted/40 p-1">
            {STATUS_SEG.map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setStatusFilter(o.v)}
                className={cn(
                  'h-7 rounded-lg px-3 text-[11px] font-bold uppercase tracking-wide transition-all duration-200',
                  statusFilter === o.v ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {o.l}
              </button>
            ))}
          </div>

          <Select value={methodFilter} onValueChange={(v) => setMethodFilter(v as 'all' | 'pix' | 'card')}>
            <LabeledSelectTrigger className={filterSelectCls} size="default">
              {methodFilter === 'all' ? 'Método' : methodFilter === 'pix' ? 'Pix' : 'Cartão'}
            </LabeledSelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs font-bold uppercase tracking-tight">Todos os métodos</SelectItem>
              <SelectItem value="pix" className="text-xs font-bold uppercase tracking-tight">Pix</SelectItem>
              <SelectItem value="card" className="text-xs font-bold uppercase tracking-tight">Cartão</SelectItem>
            </SelectContent>
          </Select>

          <Select value={deliveryFilter} onValueChange={(v) => setDeliveryFilter(v as 'all' | DeliveryKind)}>
            <LabeledSelectTrigger className={filterSelectCls} size="default">
              {deliveryFilter === 'all' ? 'Entrega' : DELIVERY_FILTER_OPTIONS.find((o) => o.value === deliveryFilter)?.label ?? 'Entrega'}
            </LabeledSelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs font-bold uppercase tracking-tight">Todas as entregas</SelectItem>
              {DELIVERY_FILTER_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs font-bold uppercase tracking-tight">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={shipFilter} onValueChange={(v) => setShipFilter(v as 'all' | ShipStatus)}>
            <LabeledSelectTrigger className={filterSelectCls} size="default">
              {shipFilter === 'all' ? 'Status envio' : shipStatusLabel(shipFilter)}
            </LabeledSelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs font-bold uppercase tracking-tight">Todos (envio)</SelectItem>
              {SHIP_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs font-bold uppercase tracking-tight">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {error ? <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      {/* Tabela */}
      <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border/60">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead>Cliente</TableHead>
              <TableHead>Kit</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Pagamento</TableHead>
              <TableHead>Entrega</TableHead>
              <TableHead>Status envio</TableHead>
              <TableHead>Bling / Envio</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">Nenhum pedido com esses filtros.</TableCell></TableRow>
            ) : (
              filtered.map((p) => {
                const lead = p.leadId ? leadById.get(p.leadId) : undefined
                const name = p.customerName || lead?.patientName || 'Cliente'
                const dm = DELIVERY_META[deliveryOf(p)]
                const sm = STATUS_META[p.status]
                const om = ORIGIN_META[originOf(p)]
                const track = (p.leadId && trackingByLead[p.leadId]) || persistedTracking(p)
                return (
                  <TableRow key={`${p.method}:${p.id}`}>
                    <TableCell>
                      <div className="font-semibold text-foreground/90">{name}</div>
                      {p.phone ? <div className="text-xs text-muted-foreground">{p.phone}</div> : null}
                      <div className="mt-1"><span className={cn(PILL, om.cls)}>{om.label}</span></div>
                    </TableCell>
                    <TableCell className="text-xs">{p.kit ? kitLabel(p.kit) : (p.description ?? '—')}</TableCell>
                    <TableCell className="text-right">
                      <div className="font-bold tabular-nums">{brl(p.amountCents)}</div>
                      <div className="text-xs text-muted-foreground">{p.method === 'pix' ? 'Pix' : 'Cartão'}{p.installments > 1 ? ` · ${p.installments}x` : ''}</div>
                    </TableCell>
                    <TableCell>
                      <span className={cn(PILL, sm.cls)}>{sm.label}</span>
                      {p.paidAt ? <div className="mt-1 text-[10px] text-muted-foreground">{shortDateTime(p.paidAt)}</div> : null}
                    </TableCell>
                    <TableCell>
                      <span className={cn(PILL, dm.cls)}>{dm.label}</span>
                      {lead && needsShippingAddress(lead) ? (
                        <div className="mt-1">
                          <a
                            href={p.phone ? `https://wa.me/${String(p.phone).replace(/\D/g, '')}?text=${encodeURIComponent('Oi! Pra despachar seu Tricopill só falta o número do seu endereço 😊 Pode me mandar? ')}` : undefined}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300',
                              p.phone ? 'hover:bg-amber-500/25' : 'pointer-events-none',
                            )}
                            title="Endereço incompleto pro envio (falta CEP ou número). Clique pra pedir no WhatsApp."
                          >
                            ⚠️ Falta nº — pedir
                          </a>
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {p.leadId ? (
                        <select
                          value={shipOf(p)}
                          onChange={(e) => void changeShip(p, e.target.value as ShipStatus)}
                          disabled={savingShip === p.leadId}
                          className="h-7 max-w-[140px] rounded-lg border border-border/50 bg-background px-2 text-xs font-medium outline-none transition-colors focus-visible:border-ring disabled:opacity-50"
                        >
                          {SHIP_STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                        </select>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        {p.blingOrderId ? (
                          <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Bling #{p.blingOrderId}</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">sem pedido</span>
                        )}
                        {p.meOrderId ? (
                          <button
                            type="button"
                            onClick={() => void doRefreshTracking(p)}
                            disabled={refreshingTrack === p.leadId}
                            className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 transition-colors hover:bg-sky-500/20 disabled:opacity-60"
                            title={`Melhor Envio: ${p.meOrderId}. Clique para puxar o rastreio.`}
                          >
                            <Truck className={cn('size-3', refreshingTrack === p.leadId && 'animate-pulse')} />
                            {refreshingTrack === p.leadId ? 'Buscando…' : track ? track : 'Atualizar rastreio'}
                          </button>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{shortDateTime(p.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {p.leadId ? (
                        <Link to={`/leads/${p.leadId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
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
      <p className="text-[11px] text-muted-foreground/70">
        Cartão (Asaas/Rede) + Pix (Asaas/PagBank) do polo. "Status envio" é editável; clique em "Atualizar rastreio" pra puxar o código do Melhor Envio após comprar a etiqueta no painel.
      </p>
    </AppLayout>
  )
}

function KpiCard({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-3xl border border-border/40 bg-card/50 p-5 transition-all hover:bg-card/80">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">{label}</p>
      <p className={cn('mt-2 text-2xl font-black tabular-nums tracking-tight', tone ?? 'text-foreground')}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground/70">{hint}</p> : null}
    </div>
  )
}
