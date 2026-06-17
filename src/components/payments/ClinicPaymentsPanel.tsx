import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, FileText, Paperclip, RefreshCw, Search, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { fetchRedePayments, type RedePaymentRow } from '@/services/crmRede'
import {
  deletePaymentReceipt,
  fetchReceiptsForPayments,
  getReceiptSignedUrl,
  uploadPaymentReceipt,
  type PaymentReceiptRow,
} from '@/services/crmPaymentReceipts'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const pad2 = (n: number) => String(n).padStart(2, '0')
/** Escapa célula CSV (delimitador ';' para Excel pt-BR). */
function csvCell(v: string): string {
  const s = String(v ?? '')
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function statusLabel(r: RedePaymentRow): string {
  if (isPaid(r)) return 'Pago'
  if (isFailed(r)) return 'Falhou'
  return 'Aguardando'
}
function dtBR(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const isPaid = (r: RedePaymentRow) => r.status === 'paid'
const isFailed = (r: RedePaymentRow) => r.status === 'failed' || r.status === 'denied'

function statusBadge(r: RedePaymentRow) {
  if (isPaid(r)) return <Badge className="bg-emerald-500/15 text-emerald-600">Pago</Badge>
  if (isFailed(r)) return <Badge className="bg-rose-500/15 text-rose-600">Falhou</Badge>
  return <Badge variant="secondary">Aguardando</Badge>
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/60 p-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${tone ?? ''}`}>{value}</p>
    </div>
  )
}

export function ClinicPaymentsPanel() {
  const crm = useCrm()
  const [rows, setRows] = useState<RedePaymentRow[]>([])
  const [receipts, setReceipts] = useState<Record<string, PaymentReceiptRow[]>>({})
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'all' | 'paid' | 'pending' | 'failed'>('all')
  const [period, setPeriod] = useState<'30' | '90' | 'all'>('30')
  const [search, setSearch] = useState('')
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingPaymentId = useRef<string | null>(null)

  const leadName = useMemo(() => {
    const map = new Map(crm.leads.map((l) => [l.id, l.patientName]))
    return (id: string | null) => (id ? map.get(id) ?? null : null)
  }, [crm.leads])

  const load = useCallback(async () => {
    setLoading(true)
    setNowMs(Date.now())
    try {
      const data = await fetchRedePayments(200)
      setRows(data)
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

  const filtered = useMemo(() => {
    const minMs = period === 'all' || nowMs === 0 ? 0 : nowMs - Number(period) * 86_400_000
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (minMs && new Date(r.createdAt).getTime() < minMs) return false
      if (status === 'paid' && !isPaid(r)) return false
      if (status === 'failed' && !isFailed(r)) return false
      if (status === 'pending' && (isPaid(r) || isFailed(r))) return false
      if (q) {
        const hay = `${r.customerName ?? ''} ${leadName(r.leadId) ?? ''} ${r.description ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, period, status, search, leadName, nowMs])

  const kpis = useMemo(() => {
    let recebido = 0
    let pendente = 0
    let paidCount = 0
    for (const r of filtered) {
      if (isPaid(r)) {
        recebido += r.amountCents
        paidCount += 1
      } else if (!isFailed(r)) {
        pendente += r.amountCents
      }
    }
    return {
      recebido,
      pendente,
      total: filtered.length,
      ticket: paidCount > 0 ? Math.round(recebido / paidCount) : 0,
    }
  }, [filtered])

  const onPickFile = (paymentId: string) => {
    pendingPaymentId.current = paymentId
    fileInputRef.current?.click()
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const paymentId = pendingPaymentId.current
    e.target.value = '' // permite re-anexar o mesmo arquivo
    if (!file || !paymentId) return
    setUploadingFor(paymentId)
    try {
      const rec = await uploadPaymentReceipt(paymentId, file)
      setReceipts((prev) => ({ ...prev, [paymentId]: [rec, ...(prev[paymentId] ?? [])] }))
      toast.success('Comprovante anexado.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao anexar comprovante')
    } finally {
      setUploadingFor(null)
    }
  }

  const viewReceipt = async (rec: PaymentReceiptRow) => {
    try {
      const url = await getReceiptSignedUrl(rec.storagePath)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir comprovante')
    }
  }

  const removeReceipt = async (paymentId: string, rec: PaymentReceiptRow) => {
    if (!window.confirm('Remover este comprovante?')) return
    try {
      await deletePaymentReceipt(rec.id, rec.storagePath)
      setReceipts((prev) => ({ ...prev, [paymentId]: (prev[paymentId] ?? []).filter((x) => x.id !== rec.id) }))
      toast.success('Comprovante removido.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover comprovante')
    }
  }

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error('Nada para exportar com o filtro atual.')
      return
    }
    const headers = [
      'Gerado em', 'Pago em', 'Cliente', 'Descrição', 'Valor (R$)', 'Parcelas',
      'Status', 'TID', 'Cód. retorno', 'Comprovante', 'Nº comprovantes',
    ]
    const lines = filtered.map((r) => {
      const recs = receipts[r.id] ?? []
      return [
        dtBR(r.createdAt),
        dtBR(r.paidAt),
        r.customerName || leadName(r.leadId) || 'Cliente avulso',
        r.description ?? '',
        (r.amountCents / 100).toFixed(2).replace('.', ','),
        String(r.installments),
        statusLabel(r),
        r.tid ?? '',
        r.returnCode ?? '',
        recs.length > 0 ? 'Sim' : 'Não',
        String(recs.length),
      ].map(csvCell).join(';')
    })
    const csv = '﻿' + [headers.join(';'), ...lines].join('\r\n')
    const stamp = nowMs ? (() => { const d = new Date(nowMs); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` })() : 'export'
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `recebimentos-instituto-${stamp}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`${filtered.length} recebimento(s) exportado(s).`)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">Recebimentos (cartão)</CardTitle>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={loading || filtered.length === 0}>
            <Download className="mr-1.5 size-3.5" /> Exportar CSV
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Recebido" value={formatBRL(kpis.recebido)} tone="text-emerald-600" />
          <Kpi label="A receber" value={formatBRL(kpis.pendente)} tone="text-amber-600" />
          <Kpi label="Pagamentos" value={String(kpis.total)} />
          <Kpi label="Ticket médio" value={formatBRL(kpis.ticket)} />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome / descrição" className="pl-8" />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="paid">Pagos</SelectItem>
              <SelectItem value="pending">Aguardando</SelectItem>
              <SelectItem value="failed">Falhou</SelectItem>
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
              <SelectItem value="all">Tudo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => void onFileChange(e)}
        />

        {/* Lista */}
        {filtered.length === 0 ? (
          loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground" role="status" aria-live="polite">Carregando…</div>
          ) : (
            <EmptyState
              title="Nenhum recebimento no filtro"
              description="Os pagamentos por cartão (Rede) aparecem aqui. Anexe o comprovante de cada um para controle."
              className="py-10"
            />
          )
        ) : (
          <div className="divide-y divide-border/40">
            {filtered.map((r) => {
              const recs = receipts[r.id] ?? []
              const name = r.customerName || leadName(r.leadId) || 'Cliente avulso'
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{name}</span>
                      {statusBadge(r)}
                      {r.installments > 1 ? <Badge variant="outline" className="text-[10px]">{r.installments}x</Badge> : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatBRL(r.amountCents)}
                      {r.description ? ` · ${r.description}` : ''}
                      {isPaid(r) && r.paidAt
                        ? ` · pago ${new Date(r.paidAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                        : r.createdAt
                          ? ` · gerado ${new Date(r.createdAt).toLocaleDateString('pt-BR')}`
                          : ''}
                      {r.tid ? ` · TID ${r.tid}` : ''}
                    </p>
                    {recs.length > 0 ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {recs.map((rec) => (
                          <span key={rec.id} className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px]">
                            <button type="button" onClick={() => void viewReceipt(rec)} className="inline-flex items-center gap-1 hover:underline">
                              <FileText className="size-3" />
                              {rec.fileName ? rec.fileName.slice(0, 24) : 'comprovante'}
                            </button>
                            <button type="button" onClick={() => void removeReceipt(r.id, rec)} aria-label="Remover comprovante" className="text-muted-foreground/60 hover:text-rose-500">
                              <Trash2 className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant={recs.length > 0 ? 'ghost' : 'outline'}
                    onClick={() => onPickFile(r.id)}
                    disabled={uploadingFor === r.id}
                  >
                    <Paperclip className="mr-1.5 size-3.5" />
                    {uploadingFor === r.id ? 'Enviando…' : recs.length > 0 ? 'Anexar +' : 'Comprovante'}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
