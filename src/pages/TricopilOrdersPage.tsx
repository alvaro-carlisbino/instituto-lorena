import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronDown, ChevronRight, Download, ExternalLink, FileText, PackageCheck, Plus, RefreshCw, Search, Truck, Upload, X } from 'lucide-react'
import { toast } from 'sonner'

import { AppLayout } from '@/layouts/AppLayout'
import { Button, buttonVariants } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCrm } from '@/context/CrmContext'
import {
  fetchReconciliations,
  fetchUnifiedPayments,
  markReconciled,
  matchStatementToPayments,
  parseBankStatementCsv,
  reconKey,
  unmarkReconciled,
  type BankMatchResult,
  type PaymentStatus,
  type ReconciliationRow,
  type UnifiedPayment,
} from '@/services/crmPaymentsUnified'
import { nfeEmit, retryBlingOrder } from '@/services/crmBling'
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

// Número em reais pro CSV (vírgula decimal, sem símbolo) — abre certo no Excel BR.
function reaisCsv(cents: number): string {
  return (Number(cents) / 100).toFixed(2).replace('.', ',')
}
function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function downloadCsv(filename: string, rows: string[][]): void {
  const body = rows.map((r) => r.map(csvCell).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const PILL = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1'

const STATUS_META: Record<PaymentStatus, { label: string; cls: string }> = {
  paid: { label: 'Pago', cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300' },
  pending: { label: 'Aguardando', cls: 'bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300' },
  failed: { label: 'Falhou', cls: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300' },
}

const DELIVERY_META: Record<DeliveryKind, { label: string; cls: string }> = {
  motoboy: { label: 'Motoboy', cls: 'bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300' },
  retirada: { label: 'Retirada', cls: 'bg-violet-500/10 text-violet-700 ring-violet-500/25 dark:text-violet-300' },
  correios: { label: 'Correios', cls: 'bg-orange-500/10 text-orange-700 ring-orange-500/25 dark:text-orange-300' },
  desconhecido: { label: 'Não inform.', cls: 'bg-muted text-muted-foreground ring-border/40' },
}

// Origem do pedido. Não há campo de origem nos pagamentos, então é derivado do lead
// vinculado (best-effort): bot de vendas no WhatsApp (lead com instância W-API ou source
// whatsapp/meta) × loja no site (checkout sem lead do CRM) × lançamento manual.
type OrderOrigin = 'whatsapp' | 'site' | 'manual'
const ORIGIN_META: Record<OrderOrigin, { label: string; cls: string }> = {
  whatsapp: { label: 'WhatsApp', cls: 'bg-green-500/10 text-green-700 ring-green-500/25 dark:text-green-300' },
  site: { label: 'Site', cls: 'bg-indigo-500/10 text-indigo-700 ring-indigo-500/25 dark:text-indigo-300' },
  manual: { label: 'Manual', cls: 'bg-muted text-muted-foreground ring-border/40' },
}

// NF-e: só o cartão (rede_payments) carrega estado de nota. Traduz o status cru do Bling
// num selo curto. `emitida`/`autorizada` = ok; `rejeitada`/`erro` = falha; resto = pendente.
function nfeMeta(status: string | null, numero: string | null): { label: string; cls: string; done: boolean; failed: boolean } {
  const s = (status ?? '').toLowerCase()
  if (s.includes('autoriz') || s.includes('emit') || s === 'ok' || numero) {
    return { label: numero ? `NF ${numero}` : 'Emitida', cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300', done: true, failed: false }
  }
  if (s.includes('rejeit') || s.includes('erro') || s.includes('deneg') || s.includes('fail')) {
    return { label: 'Rejeitada', cls: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300', done: false, failed: true }
  }
  if (s) return { label: 'Processando', cls: 'bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300', done: false, failed: false }
  return { label: 'Sem nota', cls: 'bg-muted text-muted-foreground ring-border/40', done: false, failed: false }
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
  const [originFilter, setOriginFilter] = useState<'all' | OrderOrigin>('all')
  const [nfeFilter, setNfeFilter] = useState<'all' | 'com' | 'sem' | 'rejeitada'>('all')
  const [shipOverride, setShipOverride] = useState<Record<string, ShipStatus>>({})
  const [savingShip, setSavingShip] = useState<string | null>(null)
  const [trackingByLead, setTrackingByLead] = useState<Record<string, string>>({})
  const [refreshingTrack, setRefreshingTrack] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [recons, setRecons] = useState<Map<string, ReconciliationRow>>(new Map())
  const [emittingNfe, setEmittingNfe] = useState<string | null>(null)
  const [nfeMsg, setNfeMsg] = useState<Record<string, string>>({})
  const [savingRecon, setSavingRecon] = useState<string | null>(null)
  const [reconInput, setReconInput] = useState<Record<string, string>>({})
  const [relaunching, setRelaunching] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<BankMatchResult | null>(null)
  const [applyingImport, setApplyingImport] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchUnifiedPayments(1000), fetchReconciliations().catch(() => new Map<string, ReconciliationRow>())])
      .then(([res, rec]) => { if (!cancelled) { setRows(res); setRecons(rec) } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar pedidos.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  const rowKey = (p: UnifiedPayment) => `${p.method}:${p.id}`
  const toggleExpand = (p: UnifiedPayment) => {
    const k = rowKey(p)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

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

  // Emite a NF-e desta venda (só cartão/rede tem nota). Atualiza a linha em memória com o
  // resultado, sem refazer o fetch inteiro.
  const doEmitNfe = async (p: UnifiedPayment) => {
    if (p.method !== 'card') return
    setEmittingNfe(p.id)
    setNfeMsg((m) => ({ ...m, [p.id]: '' }))
    try {
      const r = await nfeEmit(p.id)
      if (r.ok || r.alreadyEmitted) {
        setRows((prev) => prev.map((x) => (x.id === p.id && x.method === p.method
          ? { ...x, nfeStatus: r.status ?? 'autorizada', nfeNumero: r.numero ?? x.nfeNumero }
          : x)))
        toast.success(r.alreadyEmitted ? 'NF-e já estava emitida.' : `NF-e emitida${r.numero ? ` (nº ${r.numero})` : ''}.`)
      } else {
        const msg = r.message ?? 'Falha ao emitir NF-e.'
        setNfeMsg((m) => ({ ...m, [p.id]: msg }))
        toast.error(msg)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao emitir NF-e.'
      setNfeMsg((m) => ({ ...m, [p.id]: msg }))
      toast.error(msg)
    } finally {
      setEmittingNfe(null)
    }
  }

  // Conciliação cobrado × recebido: grava o valor líquido que caiu no banco. A diferença pro
  // valor cobrado é a taxa do gateway (mostrada na linha).
  const doReconcile = async (p: UnifiedPayment) => {
    const k = reconKey(p.method, p.id)
    const raw = (reconInput[k] ?? '').trim().replace(/\./g, '').replace(',', '.')
    const reais = Number(raw)
    if (!raw || !Number.isFinite(reais) || reais <= 0) { toast.error('Informe o valor recebido (líquido).'); return }
    const cents = Math.round(reais * 100)
    setSavingRecon(k)
    try {
      await markReconciled({ paymentId: p.id, method: p.method, bankAmountCents: cents, matchedSource: 'manual' })
      setRecons((prev) => {
        const next = new Map(prev)
        next.set(k, { paymentId: p.id, method: p.method, bankRef: null, bankAmountCents: cents, matchedSource: 'manual', note: null, reconciledAt: new Date().toISOString() })
        return next
      })
      setReconInput((m) => ({ ...m, [k]: '' }))
      toast.success('Conciliado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao conciliar.')
    } finally {
      setSavingRecon(null)
    }
  }

  const doUnreconcile = async (p: UnifiedPayment) => {
    const k = reconKey(p.method, p.id)
    setSavingRecon(k)
    try {
      await unmarkReconciled(p.id, p.method)
      setRecons((prev) => { const next = new Map(prev); next.delete(k); return next })
      toast.success('Conciliação desfeita.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao desfazer.')
    } finally {
      setSavingRecon(null)
    }
  }

  const markDelivered = (p: UnifiedPayment) => changeShip(p, 'entregue')

  // Relança no Bling uma venda paga que não gerou pedido (lead de outro canal, bug, etc.).
  const doRelaunchBling = async (p: UnifiedPayment) => {
    if (!p.leadId) { toast.error('Pedido sem lead vinculado — abra o cadastro e vincule antes.'); return }
    setRelaunching(p.id)
    try {
      const r = await retryBlingOrder(p.leadId, p.kit ?? undefined)
      if (r.orderId) {
        setRows((prev) => prev.map((x) => (x.id === p.id && x.method === p.method ? { ...x, blingOrderId: r.orderId } : x)))
        toast.success(`Pedido criado no Bling (#${r.orderId}).`)
      } else {
        toast.error('Bling não retornou o pedido. Confira no painel do Bling.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao relançar no Bling.')
    } finally {
      setRelaunching(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (methodFilter !== 'all' && p.method !== methodFilter) return false
      if (deliveryFilter !== 'all' && deliveryOf(p) !== deliveryFilter) return false
      if (shipFilter !== 'all' && shipOf(p) !== shipFilter) return false
      if (originFilter !== 'all' && originOf(p) !== originFilter) return false
      if (nfeFilter !== 'all') {
        const nm = nfeMeta(p.nfeStatus, p.nfeNumero)
        if (nfeFilter === 'com' && !nm.done) return false
        if (nfeFilter === 'rejeitada' && !nm.failed) return false
        // "Sem NF-e" = venda no cartão paga que ainda não tem nota (o que falta emitir).
        if (nfeFilter === 'sem' && !(p.method === 'card' && p.status === 'paid' && !nm.done)) return false
      }
      if (q) {
        const hay = [p.customerName, p.phone, p.customerDoc, p.description, p.kit].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, statusFilter, methodFilter, deliveryFilter, shipFilter, originFilter, nfeFilter, leadById, shipOverride])

  const kpis = useMemo(() => {
    const paid = filtered.filter((p) => p.status === 'paid')
    const pending = filtered.filter((p) => p.status === 'pending')
    const revenue = paid.reduce((s, p) => s + p.amountCents, 0)
    const comFrete = filtered.filter((p) => p.freightCents != null && p.freightCents > 0)
    const freteMedio = comFrete.length > 0 ? Math.round(comFrete.reduce((s, p) => s + (p.freightCents ?? 0), 0) / comFrete.length) : 0
    const reconciled = paid.filter((p) => recons.has(reconKey(p.method, p.id))).length
    return { total: filtered.length, paid: paid.length, pending: pending.length, revenue, freteMedio, comFreteCount: comFrete.length, reconciled }
  }, [filtered, recons])

  const hasActiveFilters = search.trim() !== '' || statusFilter !== 'all' || methodFilter !== 'all' || deliveryFilter !== 'all' || shipFilter !== 'all' || originFilter !== 'all' || nfeFilter !== 'all'
  const clearFilters = () => {
    setSearch(''); setStatusFilter('all'); setMethodFilter('all'); setDeliveryFilter('all'); setShipFilter('all'); setOriginFilter('all'); setNfeFilter('all')
  }

  // Exporta os pedidos do filtro atual pra CSV (abre no Excel/Sheets). Só dado que já está na tela.
  const exportCsv = () => {
    const header = [
      'Data', 'Cliente', 'Telefone', 'CPF/CNPJ', 'Origem', 'Kit', 'Itens', 'Valor', 'Método', 'Parcelas',
      'Pagamento', 'Pago em', 'Entrega', 'Status envio', 'Bling', 'Frete', 'NF-e', 'NF-e nº', 'Rastreio',
    ]
    const body = filtered.map((p) => {
      const lead = p.leadId ? leadById.get(p.leadId) : undefined
      const name = p.customerName || lead?.patientName || 'Cliente'
      const itens = (p.items ?? []).map((i) => `${i.qty > 1 ? `${i.qty}x ` : ''}${i.nome}`).join(' | ')
      const nm = nfeMeta(p.nfeStatus, p.nfeNumero)
      return [
        shortDateTime(p.createdAt), name, p.phone ?? '', p.customerDoc ?? '', ORIGIN_META[originOf(p)].label,
        p.kit ? kitLabel(p.kit) : (p.description ?? ''), itens, reaisCsv(p.amountCents),
        p.method === 'pix' ? 'Pix' : 'Cartão', String(p.installments || 1), STATUS_META[p.status].label,
        p.paidAt ? shortDateTime(p.paidAt) : '', DELIVERY_META[deliveryOf(p)].label, shipStatusLabel(shipOf(p)),
        p.blingOrderId ? `#${p.blingOrderId}` : '', p.freightCents != null ? reaisCsv(p.freightCents) : '',
        p.method === 'card' ? nm.label : 'Pix (sem NF)', p.nfeNumero ?? '', persistedTracking(p),
      ]
    })
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`pedidos-tricopill-${stamp}.csv`, [header, ...body])
    toast.success(`${filtered.length} pedido${filtered.length === 1 ? '' : 's'} exportado${filtered.length === 1 ? '' : 's'}.`)
  }

  // Importa o extrato (CSV do banco/gateway) e casa por valor + data com os pagamentos pagos.
  const onImportStatement = async (file: File) => {
    try {
      const text = await file.text()
      const lines = parseBankStatementCsv(text)
      if (lines.length === 0) { toast.error('Não achei lançamentos nesse arquivo. Confira se é o CSV do extrato.'); return }
      setImportResult(matchStatementToPayments(lines, rows))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ler o extrato.')
    }
  }

  // Concilia em lote os pagamentos que bateram com o extrato (grava o valor da linha do banco).
  const applyImportMatches = async () => {
    if (!importResult || importResult.matched.length === 0) return
    setApplyingImport(true)
    let ok = 0
    try {
      for (const { payment, line } of importResult.matched) {
        try {
          await markReconciled({ paymentId: payment.id, method: payment.method, bankAmountCents: line.amountCents, bankRef: line.ref || null, matchedSource: 'csv_import' })
          setRecons((prev) => {
            const next = new Map(prev)
            next.set(reconKey(payment.method, payment.id), { paymentId: payment.id, method: payment.method, bankRef: line.ref || null, bankAmountCents: line.amountCents, matchedSource: 'csv_import', note: null, reconciledAt: new Date().toISOString() })
            return next
          })
          ok += 1
        } catch { /* segue pros próximos */ }
      }
      toast.success(`${ok} pagamento${ok === 1 ? '' : 's'} conciliado${ok === 1 ? '' : 's'} pelo extrato.`)
      setImportResult(null)
    } finally {
      setApplyingImport(false)
    }
  }

  return (
    <AppLayout
      title="Pedidos"
      subtitle="Pagamento, entrega, Bling e rastreio: tudo num lugar"
      actions={
        <div className="flex items-center gap-2">
          <Link to="/frente-loja" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'rounded-xl')}>
            <Plus className="size-3.5" /> Novo pedido
          </Link>
          <label className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'cursor-pointer rounded-xl')} title="Casa o extrato do banco/gateway com os pagamentos pagos (por valor e data)">
            <Upload className="size-3.5" /> Importar extrato
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportStatement(f); e.currentTarget.value = '' }}
            />
          </label>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="size-3.5" /> Exportar CSV
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Atualizar
          </Button>
        </div>
      }
    >
      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <KpiCard label="Pedidos" value={String(kpis.total)} hint="no filtro atual" />
        <KpiCard label="Pagos" value={String(kpis.paid)} tone="text-emerald-600" />
        <KpiCard label="Aguardando" value={String(kpis.pending)} tone="text-amber-600" />
        <KpiCard label="Receita paga" value={brl(kpis.revenue)} />
        <KpiCard label="Conciliados" value={kpis.paid > 0 ? `${kpis.reconciled}/${kpis.paid}` : '—'} tone={kpis.paid > 0 && kpis.reconciled === kpis.paid ? 'text-emerald-600' : undefined} hint={kpis.paid > 0 ? `${Math.round((kpis.reconciled / kpis.paid) * 100)}% batidos` : 'sem pagos'} />
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

          <Select value={originFilter} onValueChange={(v) => setOriginFilter(v as 'all' | OrderOrigin)}>
            <LabeledSelectTrigger className={filterSelectCls} size="default">
              {originFilter === 'all' ? 'Origem' : ORIGIN_META[originFilter].label}
            </LabeledSelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs font-bold uppercase tracking-tight">Todas as origens</SelectItem>
              <SelectItem value="whatsapp" className="text-xs font-bold uppercase tracking-tight">WhatsApp</SelectItem>
              <SelectItem value="site" className="text-xs font-bold uppercase tracking-tight">Site</SelectItem>
              <SelectItem value="manual" className="text-xs font-bold uppercase tracking-tight">Manual</SelectItem>
            </SelectContent>
          </Select>

          <Select value={nfeFilter} onValueChange={(v) => setNfeFilter(v as 'all' | 'com' | 'sem' | 'rejeitada')}>
            <LabeledSelectTrigger className={filterSelectCls} size="default">
              {nfeFilter === 'all' ? 'NF-e' : nfeFilter === 'com' ? 'Com NF-e' : nfeFilter === 'sem' ? 'Sem NF-e' : 'Rejeitada'}
            </LabeledSelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs font-bold uppercase tracking-tight">NF-e (todas)</SelectItem>
              <SelectItem value="com" className="text-xs font-bold uppercase tracking-tight">Com NF-e</SelectItem>
              <SelectItem value="sem" className="text-xs font-bold uppercase tracking-tight">Sem NF-e (falta emitir)</SelectItem>
              <SelectItem value="rejeitada" className="text-xs font-bold uppercase tracking-tight">Rejeitada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {error ? <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      {importResult ? (
        <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-bold text-foreground/90">Extrato lido:</span>{' '}
              <span className="tabular-nums">{importResult.parsedCount} lançamento{importResult.parsedCount === 1 ? '' : 's'}</span>,{' '}
              <span className="font-semibold text-emerald-600">{importResult.matched.length} bateu com pagamento</span>
              {importResult.unmatchedLines.length > 0 ? <span className="text-muted-foreground">, {importResult.unmatchedLines.length} sem correspondência</span> : null}.
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" className="rounded-lg" disabled={applyingImport || importResult.matched.length === 0} onClick={() => void applyImportMatches()}>
                <CheckCircle2 className={cn('size-3.5', applyingImport && 'animate-pulse')} />
                {applyingImport ? 'Conciliando…' : `Conciliar ${importResult.matched.length} casado${importResult.matched.length === 1 ? '' : 's'}`}
              </Button>
              <button type="button" onClick={() => setImportResult(null)} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Fechar">
                <X className="size-4" />
              </button>
            </div>
          </div>
          {importResult.unmatchedLines.length > 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground/70">
              Sem correspondência (valor não bateu com nenhum pagamento pago, ou já conciliado):{' '}
              {importResult.unmatchedLines.slice(0, 8).map((l) => brl(l.amountCents)).join(', ')}
              {importResult.unmatchedLines.length > 8 ? ` e mais ${importResult.unmatchedLines.length - 8}` : ''}.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Tabela */}
      <div className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border/60">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="w-8" />
              <TableHead>Cliente</TableHead>
              <TableHead>Kit</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Pagamento</TableHead>
              <TableHead>Entrega</TableHead>
              <TableHead>Status envio</TableHead>
              <TableHead>Bling / Envio</TableHead>
              <TableHead>NF-e</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow><TableCell colSpan={11} className="py-12 text-center text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={11} className="py-12 text-center text-sm text-muted-foreground">Nenhum pedido com esses filtros.</TableCell></TableRow>
            ) : (
              filtered.map((p) => {
                const lead = p.leadId ? leadById.get(p.leadId) : undefined
                const name = p.customerName || lead?.patientName || 'Cliente'
                const dm = DELIVERY_META[deliveryOf(p)]
                const sm = STATUS_META[p.status]
                const om = ORIGIN_META[originOf(p)]
                const track = (p.leadId && trackingByLead[p.leadId]) || persistedTracking(p)
                const k = rowKey(p)
                const isOpen = expanded.has(k)
                const nm = nfeMeta(p.nfeStatus, p.nfeNumero)
                const rk = reconKey(p.method, p.id)
                const recon = recons.get(rk)
                const feeCents = recon?.bankAmountCents != null ? p.amountCents - recon.bankAmountCents : null
                return (
                  <Fragment key={k}>
                  <TableRow className={cn(isOpen && 'border-b-0 bg-muted/20')}>
                    <TableCell className="pr-0">
                      <button
                        type="button"
                        onClick={() => toggleExpand(p)}
                        className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title={isOpen ? 'Recolher' : 'Ver itens, NF-e, conciliação e ações'}
                        aria-label={isOpen ? 'Recolher' : 'Expandir'}
                      >
                        {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-foreground/90">{name}</div>
                      {p.phone ? <div className="text-xs text-muted-foreground">{p.phone}</div> : null}
                      <div className="mt-1"><span className={cn(PILL, om.cls)}>{om.label}</span></div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{p.kit ? kitLabel(p.kit) : (p.description ?? '—')}</div>
                      {p.items && p.items.length > 1 ? (
                        <div className="mt-0.5 text-[10px] font-semibold text-muted-foreground">+{p.items.length - 1} item{p.items.length - 1 === 1 ? '' : 's'}</div>
                      ) : null}
                    </TableCell>
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
                            Falta nº · pedir
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
                    <TableCell>
                      {p.method === 'card' ? (
                        <span className={cn(PILL, nm.cls)} title={p.nfeStatus ?? undefined}>
                          {nm.done ? <CheckCircle2 className="size-3" /> : <FileText className="size-3" />}
                          {nm.label}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Pix (sem NF)</span>
                      )}
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
                  {isOpen ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={11} className="bg-muted/20 p-0">
                        <div className="grid gap-4 px-6 py-4 md:grid-cols-3">
                          {/* Itens / SKU */}
                          <div className="rounded-xl bg-background/60 p-3 ring-1 ring-border/50">
                            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Itens do pedido</div>
                            {p.items && p.items.length > 0 ? (
                              <ul className="space-y-1.5">
                                {p.items.map((it, i) => (
                                  <li key={i} className="flex items-start justify-between gap-2 text-xs">
                                    <div className="min-w-0">
                                      <div className="font-medium text-foreground/90">{it.qty > 1 ? `${it.qty}× ` : ''}{it.nome}</div>
                                      {it.sku ? <div className="font-mono text-[10px] text-muted-foreground">SKU {it.sku}</div> : null}
                                    </div>
                                    {it.precoCents != null ? <div className="shrink-0 tabular-nums text-muted-foreground">{brl(it.precoCents)}</div> : null}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="text-xs text-muted-foreground">
                                {p.kit ? kitLabel(p.kit) : (p.description ?? 'Sem detalhamento de itens neste pedido.')}
                              </div>
                            )}
                          </div>

                          {/* NF-e */}
                          <div className="rounded-xl bg-background/60 p-3 ring-1 ring-border/50">
                            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Nota fiscal</div>
                            {p.method !== 'card' ? (
                              <p className="text-xs text-muted-foreground">Venda no Pix não emite NF-e por aqui.</p>
                            ) : (
                              <div className="space-y-2">
                                <span className={cn(PILL, nm.cls)} title={p.nfeStatus ?? undefined}>
                                  {nm.done ? <CheckCircle2 className="size-3" /> : <FileText className="size-3" />}{nm.label}
                                </span>
                                {!nm.done ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="w-full rounded-lg"
                                    disabled={emittingNfe === p.id || p.status !== 'paid'}
                                    onClick={() => void doEmitNfe(p)}
                                    title={p.status !== 'paid' ? 'Só emite NF-e de venda paga.' : 'Emite a NF-e no Bling.'}
                                  >
                                    <FileText className={cn('size-3.5', emittingNfe === p.id && 'animate-pulse')} />
                                    {emittingNfe === p.id ? 'Emitindo…' : nm.failed ? 'Tentar de novo' : 'Emitir NF-e'}
                                  </Button>
                                ) : null}
                                {nfeMsg[p.id] ? <p className="text-[11px] text-rose-600">{nfeMsg[p.id]}</p> : null}
                                {!p.blingOrderId ? <p className="text-[11px] text-amber-600">Sem pedido no Bling ainda — relance o pedido antes de emitir.</p> : null}
                              </div>
                            )}
                          </div>

                          {/* Conciliação cobrado × recebido */}
                          <div className="rounded-xl bg-background/60 p-3 ring-1 ring-border/50">
                            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Conciliação</div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Cobrado</span>
                              <span className="font-semibold tabular-nums">{brl(p.amountCents)}</span>
                            </div>
                            {recon?.bankAmountCents != null ? (
                              <div className="mt-1 space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">Recebido</span>
                                  <span className="font-semibold tabular-nums text-emerald-600">{brl(recon.bankAmountCents)}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">Taxa/diferença</span>
                                  <span className={cn('font-semibold tabular-nums', (feeCents ?? 0) > 0 ? 'text-rose-600' : 'text-muted-foreground')}>{feeCents != null ? brl(feeCents) : '—'}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void doUnreconcile(p)}
                                  disabled={savingRecon === rk}
                                  className="mt-1 text-[11px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                                >
                                  Desfazer conciliação
                                </button>
                              </div>
                            ) : (
                              <div className="mt-2 flex items-center gap-1.5">
                                <input
                                  value={reconInput[rk] ?? ''}
                                  onChange={(e) => setReconInput((m) => ({ ...m, [rk]: e.target.value }))}
                                  onKeyDown={(e) => { if (e.key === 'Enter') void doReconcile(p) }}
                                  placeholder="Recebido (R$)"
                                  inputMode="decimal"
                                  className="h-7 w-full rounded-lg border border-border/50 bg-background px-2 text-xs outline-none focus-visible:border-ring"
                                />
                                <Button size="sm" className="h-7 shrink-0 rounded-lg px-2.5" disabled={savingRecon === rk} onClick={() => void doReconcile(p)}>
                                  {savingRecon === rk ? '…' : 'Conciliar'}
                                </Button>
                              </div>
                            )}
                          </div>

                          {/* Ações */}
                          <div className="md:col-span-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Button size="sm" variant="outline" className="rounded-lg" disabled={!p.leadId || savingShip === p.leadId || shipOf(p) === 'entregue'} onClick={() => void markDelivered(p)}>
                                <PackageCheck className="size-3.5" /> Marcar entregue
                              </Button>
                              {!p.blingOrderId ? (
                                <Button size="sm" variant="outline" className="rounded-lg" disabled={relaunching === p.id || !p.leadId} onClick={() => void doRelaunchBling(p)}>
                                  <RefreshCw className={cn('size-3.5', relaunching === p.id && 'animate-spin')} /> {relaunching === p.id ? 'Relançando…' : 'Criar pedido no Bling'}
                                </Button>
                              ) : null}
                              {p.leadId ? (
                                <Link to={`/leads/${p.leadId}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'rounded-lg')}>
                                  <ExternalLink className="size-3.5" /> Abrir cadastro
                                </Link>
                              ) : null}
                              {p.tid ? <span className="ml-auto font-mono text-[10px] text-muted-foreground">TID {p.tid}</span> : null}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                  </Fragment>
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
