import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BadgeCheck,
  CheckCircle2,
  CircleDashed,
  Download,
  FileText,
  Paperclip,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import {
  deletePaymentReceipt,
  fetchReceiptsForPayments,
  getReceiptSignedUrl,
  uploadPaymentReceipt,
  type PaymentReceiptRow,
} from '@/services/crmPaymentReceipts'
import {
  fetchReconciliations,
  fetchUnifiedPayments,
  markReconciled,
  matchStatementToPayments,
  parseBankStatementCsv,
  reconKey,
  unmarkReconciled,
  type PaymentMethod,
  type ReconciliationRow,
  type UnifiedPayment,
} from '@/services/crmPaymentsUnified'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
const pad2 = (n: number) => String(n).padStart(2, '0')
function csvCell(v: string): string {
  const s = String(v ?? '')
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function dtBR(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function fmtPhone(p: string | null): string {
  const d = String(p ?? '').replace(/\D/g, '')
  if (d.length < 10) return p ?? ''
  const local = d.startsWith('55') && d.length > 11 ? d.slice(2) : d
  const ddd = local.slice(0, 2)
  const rest = local.slice(2)
  return rest.length === 9 ? `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}` : `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`
}
const statusLabel = (s: UnifiedPayment['status']) => (s === 'paid' ? 'Pago' : s === 'failed' ? 'Falhou' : 'Aguardando')

function statusBadge(s: UnifiedPayment['status']) {
  if (s === 'paid') return <Badge className="bg-emerald-500/15 text-emerald-600">Pago</Badge>
  if (s === 'failed') return <Badge className="bg-rose-500/15 text-rose-600">Falhou</Badge>
  return <Badge variant="secondary">Aguardando</Badge>
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/60 p-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${tone ?? ''}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function PaymentsPanel() {
  const crm = useCrm()
  const [rows, setRows] = useState<UnifiedPayment[]>([])
  const [receipts, setReceipts] = useState<Record<string, PaymentReceiptRow[]>>({})
  const [recon, setRecon] = useState<Map<string, ReconciliationRow>>(new Map())
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'all' | 'paid' | 'pending' | 'failed'>('all')
  const [method, setMethod] = useState<'all' | PaymentMethod>('all')
  const [period, setPeriod] = useState<'30' | '90' | 'all'>('30')
  const [search, setSearch] = useState('')
  const [onlyPending, setOnlyPending] = useState<'recon' | 'receipt' | null>(null)
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [importReport, setImportReport] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bankInputRef = useRef<HTMLInputElement>(null)
  const pendingTarget = useRef<{ id: string; method: PaymentMethod } | null>(null)

  const leadName = useMemo(() => {
    const map = new Map(crm.leads.map((l) => [l.id, l.patientName]))
    return (id: string | null) => (id ? map.get(id) ?? null : null)
  }, [crm.leads])

  const load = useCallback(async () => {
    setLoading(true)
    setNowMs(Date.now())
    try {
      const [data, reconMap] = await Promise.all([fetchUnifiedPayments(500), fetchReconciliations()])
      setRows(data)
      setRecon(reconMap)
      const recs = await fetchReceiptsForPayments(data.map((r) => r.id))
      const grouped: Record<string, PaymentReceiptRow[]> = {}
      for (const rec of recs) (grouped[rec.paymentId] ??= []).push(rec)
      setReceipts(grouped)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar recebimentos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const isReconciled = useCallback((p: UnifiedPayment) => recon.has(reconKey(p.method, p.id)), [recon])
  const hasReceipt = useCallback((p: UnifiedPayment) => (receipts[p.id]?.length ?? 0) > 0, [receipts])

  const filtered = useMemo(() => {
    const minMs = period === 'all' || nowMs === 0 ? 0 : nowMs - Number(period) * 86_400_000
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (minMs && new Date(r.createdAt).getTime() < minMs) return false
      if (status !== 'all' && r.status !== status) return false
      if (method !== 'all' && r.method !== method) return false
      if (onlyPending === 'recon' && (r.status !== 'paid' || isReconciled(r))) return false
      if (onlyPending === 'receipt' && (r.status !== 'paid' || hasReceipt(r))) return false
      if (q) {
        const hay = `${r.customerName ?? ''} ${leadName(r.leadId) ?? ''} ${r.description ?? ''} ${r.phone ?? ''} ${r.customerDoc ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, period, status, method, search, onlyPending, leadName, nowMs, isReconciled, hasReceipt])

  // Dashboard financeiro: tudo derivado dos pagamentos PAGOS no filtro atual.
  const dash = useMemo(() => {
    let recCard = 0, recPix = 0, pendente = 0, paidCount = 0, conciliados = 0, comComprovante = 0, comBling = 0
    const byDay = new Map<string, number>()
    for (const r of filtered) {
      if (r.status === 'paid') {
        paidCount += 1
        if (r.method === 'card') recCard += r.amountCents
        else recPix += r.amountCents
        if (isReconciled(r)) conciliados += 1
        if (hasReceipt(r)) comComprovante += 1
        if (r.blingOrderId) comBling += 1
        const day = (r.paidAt || r.createdAt || '').slice(0, 10)
        if (day) byDay.set(day, (byDay.get(day) ?? 0) + r.amountCents)
      } else if (r.status === 'pending') {
        pendente += r.amountCents
      }
    }
    const recebido = recCard + recPix
    const days = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-14)
    const pct = (n: number) => (paidCount > 0 ? Math.round((n / paidCount) * 100) : 0)
    return {
      recCard, recPix, recebido, pendente, paidCount,
      ticket: paidCount > 0 ? Math.round(recebido / paidCount) : 0,
      conciliados, comprovante: comComprovante, bling: comBling,
      pctConciliado: pct(conciliados), pctComprovante: pct(comComprovante), pctBling: pct(comBling),
      days,
    }
  }, [filtered, isReconciled, hasReceipt])

  const maxDay = useMemo(() => Math.max(1, ...dash.days.map(([, v]) => v)), [dash.days])

  // ---- Comprovante manual ----
  const onPickFile = (p: UnifiedPayment) => {
    pendingTarget.current = { id: p.id, method: p.method }
    fileInputRef.current?.click()
  }
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const target = pendingTarget.current
    e.target.value = ''
    if (!file || !target) return
    setUploadingFor(target.id)
    try {
      const rec = await uploadPaymentReceipt(target.id, file, undefined, target.method)
      setReceipts((prev) => ({ ...prev, [target.id]: [rec, ...(prev[target.id] ?? [])] }))
      toast.success('Comprovante anexado.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao anexar comprovante')
    } finally {
      setUploadingFor(null)
    }
  }
  const viewReceipt = async (rec: PaymentReceiptRow, customerName: string) => {
    // O nome do cliente sempre acompanha o comprovante: preferimos o nome gravado no próprio
    // comprovante (auto_data.customer_name) e caímos no nome da linha de pagamento (retroativo
    // p/ comprovantes antigos que ainda não carimbavam o nome).
    if (rec.source === 'auto') {
      const d = rec.autoData ?? {}
      const who = (typeof d.customer_name === 'string' && d.customer_name) || customerName
      const proof =
        d.gateway === 'asaas'
          ? `Asaas · cobrança ${d.asaas_payment_id ?? '—'} · ${d.return_code ?? 'confirmado'} · ${d.installments ?? 1}x`
          : d.gateway === 'rede'
            ? `e.Rede · TID ${d.tid ?? '—'} · cód ${d.return_code ?? '—'} · ${d.installments ?? 1}x`
            : `PagBank · ref ${d.reference_id ?? '—'} · tx ${(Array.isArray(d.transaction_ids) ? d.transaction_ids[0] : d.transaction_ids) ?? '—'}`
      toast.info(`Comprovante de ${who}`, { description: proof })
      return
    }
    if (!rec.storagePath) {
      toast.info(`Comprovante de ${customerName}`)
      return
    }
    try {
      toast.info(`Comprovante de ${customerName}`)
      const url = await getReceiptSignedUrl(rec.storagePath)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir comprovante')
    }
  }
  const removeReceipt = async (paymentId: string, rec: PaymentReceiptRow) => {
    if (rec.source === 'auto') {
      toast.info('O comprovante automático do gateway não pode ser removido (prova do recebimento).')
      return
    }
    if (!window.confirm('Remover este comprovante?')) return
    try {
      await deletePaymentReceipt(rec.id, rec.storagePath)
      setReceipts((prev) => ({ ...prev, [paymentId]: (prev[paymentId] ?? []).filter((x) => x.id !== rec.id) }))
      toast.success('Comprovante removido.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover comprovante')
    }
  }

  // ---- Conciliação ----
  const toggleRecon = async (p: UnifiedPayment) => {
    const key = reconKey(p.method, p.id)
    try {
      if (recon.has(key)) {
        await unmarkReconciled(p.id, p.method)
        setRecon((prev) => { const n = new Map(prev); n.delete(key); return n })
        toast.success('Conciliação desfeita.')
      } else {
        const ref = window.prompt('Referência no extrato (NSU/E2E/linha) — opcional:', '') ?? ''
        await markReconciled({ paymentId: p.id, method: p.method, bankRef: ref.trim() || null, matchedSource: 'manual' })
        setRecon((prev) => {
          const n = new Map(prev)
          n.set(key, { paymentId: p.id, method: p.method, bankRef: ref.trim() || null, bankAmountCents: null, matchedSource: 'manual', note: null, reconciledAt: new Date().toISOString() })
          return n
        })
        toast.success('Pagamento conciliado.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao conciliar')
    }
  }

  // ---- Import de extrato bancário (CSV) ----
  const onBankCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImportReport(null)
    try {
      const text = await file.text()
      const lines = parseBankStatementCsv(text)
      if (lines.length === 0) {
        toast.error('Não consegui ler linhas com valor no CSV.')
        return
      }
      const { matched, unmatchedLines } = matchStatementToPayments(lines, rows)
      let ok = 0
      for (const m of matched) {
        try {
          await markReconciled({
            paymentId: m.payment.id,
            method: m.payment.method,
            bankRef: m.line.ref || null,
            bankAmountCents: m.line.amountCents,
            matchedSource: 'csv_import',
          })
          ok += 1
        } catch { /* segue */ }
      }
      await load()
      setImportReport(
        `Extrato: ${lines.length} linha(s) lidas · ${ok} conciliada(s) automaticamente · ${unmatchedLines.length} sem correspondência (valor/data não bateram com pagamento pago).`,
      )
      toast.success(`${ok} conciliação(ões) por extrato. ${unmatchedLines.length} sem match.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao importar extrato')
    }
  }

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error('Nada para exportar com o filtro atual.')
      return
    }
    const headers = [
      'Gerado em', 'Pago em', 'Cliente', 'Telefone', 'CPF', 'Método', 'Descrição', 'Valor (R$)', 'Parcelas',
      'Status', 'TID', 'Cód. retorno', 'Pedido Bling', 'Comprovante', 'Conciliado', 'Ref. extrato',
    ]
    const lines = filtered.map((r) => {
      const recs = receipts[r.id] ?? []
      const rc = recon.get(reconKey(r.method, r.id))
      return [
        dtBR(r.createdAt),
        dtBR(r.paidAt),
        r.customerName || leadName(r.leadId) || 'Cliente avulso',
        r.phone ?? '',
        r.customerDoc ?? '',
        r.method === 'card' ? 'Cartão' : 'Pix',
        r.description ?? '',
        (r.amountCents / 100).toFixed(2).replace('.', ','),
        String(r.installments),
        statusLabel(r.status),
        r.tid ?? '',
        r.returnCode ?? '',
        r.blingOrderId ?? '',
        recs.length > 0 ? (recs.some((x) => x.source === 'auto') ? 'Auto' : 'Manual') : 'Não',
        rc ? 'Sim' : 'Não',
        rc?.bankRef ?? '',
      ].map(csvCell).join(';')
    })
    const csv = '﻿' + [headers.join(';'), ...lines].join('\r\n')
    const stamp = nowMs ? (() => { const d = new Date(nowMs); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` })() : 'export'
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `recebimentos-${stamp}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`${filtered.length} recebimento(s) exportado(s).`)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">Recebimentos & financeiro</CardTitle>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => bankInputRef.current?.click()} disabled={loading}>
            <Upload className="mr-1.5 size-3.5" /> Importar extrato
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={loading || filtered.length === 0}>
            <Download className="mr-1.5 size-3.5" /> CSV
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Dashboard financeiro */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Recebido" value={formatBRL(dash.recebido)} tone="text-emerald-600" hint={`${formatBRL(dash.recCard)} cartão · ${formatBRL(dash.recPix)} Pix`} />
          <Kpi label="A receber" value={formatBRL(dash.pendente)} tone="text-amber-600" hint="links aguardando pagamento" />
          <Kpi label="Conciliado" value={`${dash.pctConciliado}%`} tone={dash.pctConciliado >= 100 ? 'text-emerald-600' : 'text-foreground'} hint={`${dash.conciliados}/${dash.paidCount} pagos`} />
          <Kpi label="Comprovante" value={`${dash.pctComprovante}%`} tone={dash.pctComprovante >= 100 ? 'text-emerald-600' : 'text-foreground'} hint={`${dash.comprovante}/${dash.paidCount} · Bling ${dash.pctBling}%`} />
        </div>

        {/* Recebido por dia (até 14 dias do filtro) */}
        {dash.days.length > 0 ? (
          <div className="rounded-xl border border-border/40 bg-card/40 p-3">
            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Recebido por dia</p>
            <div className="flex items-end gap-1.5" style={{ height: 64 }}>
              {dash.days.map(([day, v]) => (
                <div key={day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${day.split('-').reverse().join('/')}: ${formatBRL(v)}`}>
                  <div className="w-full rounded-t bg-emerald-500/70" style={{ height: `${Math.max(4, (v / maxDay) * 52)}px` }} />
                  <span className="text-[9px] text-muted-foreground">{day.slice(8, 10)}/{day.slice(5, 7)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {importReport ? (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">{importReport}</div>
        ) : null}

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome / telefone / CPF / descrição" className="pl-8" />
          </div>
          <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos métodos</SelectItem>
              <SelectItem value="card">Cartão</SelectItem>
              <SelectItem value="pix">Pix</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="paid">Pagos</SelectItem>
              <SelectItem value="pending">Aguardando</SelectItem>
              <SelectItem value="failed">Falhou</SelectItem>
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
              <SelectItem value="all">Tudo</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant={onlyPending === 'recon' ? 'default' : 'outline'} onClick={() => setOnlyPending((v) => (v === 'recon' ? null : 'recon'))}>
            A conciliar
          </Button>
          <Button size="sm" variant={onlyPending === 'receipt' ? 'default' : 'outline'} onClick={() => setOnlyPending((v) => (v === 'receipt' ? null : 'receipt'))}>
            Sem comprovante
          </Button>
        </div>

        <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => void onFileChange(e)} />
        <input ref={bankInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onBankCsv(e)} />

        {/* Lista */}
        {filtered.length === 0 ? (
          loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground" role="status" aria-live="polite">Carregando…</div>
          ) : (
            <EmptyState
              title="Nenhum recebimento no filtro"
              description="Pagamentos por cartão e Pix (Asaas) aparecem aqui, com comprovante automático e conciliação."
              className="py-10"
            />
          )
        ) : (
          <div className="divide-y divide-border/40">
            {filtered.map((r) => {
              const recs = receipts[r.id] ?? []
              const rc = recon.get(reconKey(r.method, r.id))
              const name = r.customerName || leadName(r.leadId) || 'Cliente avulso'
              return (
                <div key={`${r.method}:${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{name}</span>
                      <Badge variant="outline" className="text-[10px]">{r.method === 'card' ? 'Cartão' : 'Pix'}</Badge>
                      {statusBadge(r.status)}
                      {r.installments > 1 ? <Badge variant="outline" className="text-[10px]">{r.installments}x</Badge> : null}
                      {r.status === 'paid' && rc ? (
                        <Badge className="bg-sky-500/15 text-sky-600 text-[10px]"><BadgeCheck className="mr-0.5 size-3" /> Conciliado</Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatBRL(r.amountCents)}
                      {r.phone ? ` · ${fmtPhone(r.phone)}` : ''}
                      {r.description ? ` · ${r.description}` : ''}
                      {r.status === 'paid' && r.paidAt
                        ? ` · pago ${new Date(r.paidAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                        : r.createdAt ? ` · gerado ${new Date(r.createdAt).toLocaleDateString('pt-BR')}` : ''}
                      {r.blingOrderId ? ` · Bling #${r.blingOrderId}` : ''}
                    </p>
                    {recs.length > 0 ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {recs.map((rec) => (
                          <span key={rec.id} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${rec.source === 'auto' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted/60'}`}>
                            <button type="button" onClick={() => void viewReceipt(rec, name)} className="inline-flex items-center gap-1 hover:underline">
                              {rec.source === 'auto' ? <BadgeCheck className="size-3" /> : <FileText className="size-3" />}
                              {rec.source === 'auto' ? 'Auto (gateway)' : (rec.fileName ? rec.fileName.slice(0, 22) : 'comprovante')}
                            </button>
                            {rec.source !== 'auto' ? (
                              <button type="button" onClick={() => void removeReceipt(r.id, rec)} aria-label="Remover comprovante" className="text-muted-foreground/60 hover:text-rose-500">
                                <Trash2 className="size-3" />
                              </button>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {r.status === 'paid' ? (
                      <Button size="sm" variant={rc ? 'secondary' : 'outline'} onClick={() => void toggleRecon(r)} title={rc ? 'Desfazer conciliação' : 'Marcar como conciliado com o extrato'}>
                        {rc ? <CheckCircle2 className="mr-1.5 size-3.5 text-sky-600" /> : <CircleDashed className="mr-1.5 size-3.5" />}
                        {rc ? 'Conciliado' : 'Conciliar'}
                      </Button>
                    ) : null}
                    <Button size="sm" variant={recs.length > 0 ? 'ghost' : 'outline'} onClick={() => onPickFile(r)} disabled={uploadingFor === r.id}>
                      <Paperclip className="mr-1.5 size-3.5" />
                      {uploadingFor === r.id ? 'Enviando…' : recs.length > 0 ? '+' : 'Comprovante'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Compat: o nome antigo continua exportado (usado em PaymentLinksPage e afins).
export const ClinicPaymentsPanel = PaymentsPanel
