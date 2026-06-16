import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Copy, Download, RefreshCw, FileSpreadsheet } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  fetchSalesReport,
  salesReportToCsv,
  salesReportToText,
  type SalesReport,
} from '@/services/crmSalesReport'

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'

/** Data de hoje no formato YYYY-MM-DD em horário LOCAL (não UTC). */
function todayYmd(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function SalesReportPage() {
  const [date, setDate] = useState(todayYmd())
  const [report, setReport] = useState<SalesReport | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (ymd: string) => {
    setLoading(true)
    try {
      setReport(await fetchSalesReport(ymd))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar o relatório')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga de dados ao trocar o dia
    void load(date)
  }, [date, load])

  const exportCsv = () => {
    if (!report || report.rows.length === 0) return toast.error('Sem vendas nesse dia.')
    const blob = new Blob(['﻿' + salesReportToCsv(report)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vendas-${report.date}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exportado.')
  }

  const copyText = async () => {
    if (!report || report.rows.length === 0) return toast.error('Sem vendas nesse dia.')
    try {
      await navigator.clipboard.writeText(salesReportToText(report))
      toast.success('Resumo copiado — cole no financeiro.')
    } catch {
      toast.error('Não consegui copiar.')
    }
  }

  const t = report?.totals

  return (
    <AppLayout title="Relatório de vendas">
      <PageHeader title="Relatório de vendas" description="Vendas pagas do dia (cartão, Pix e venda manual) para o financeiro." />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sr-date">Dia</Label>
          <Input id="sr-date" type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)} className="w-44" />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load(date)} disabled={loading}>
          <RefreshCw className={`mr-1.5 size-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
        <div className="flex-1" />
        <Button type="button" variant="outline" size="sm" onClick={() => void copyText()} disabled={!report || report.rows.length === 0}>
          <Copy className="mr-1.5 size-4" /> Copiar resumo
        </Button>
        <Button type="button" size="sm" onClick={exportCsv} disabled={!report || report.rows.length === 0}>
          <Download className="mr-1.5 size-4" /> Exportar CSV
        </Button>
      </div>

      {/* Totais */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Total do dia</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{t ? brl(t.totalCents) : '—'}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Vendas</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{t?.count ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Cartão</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{t ? brl(t.cardCents) : '—'} <span className="text-xs text-muted-foreground">({t?.cardCount ?? 0})</span></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Pix</CardTitle></CardHeader>
          <CardContent className="text-lg font-semibold">{t ? brl(t.pixCents) : '—'} <span className="text-xs text-muted-foreground">({t?.pixCount ?? 0})</span></CardContent>
        </Card>
      </div>

      {/* Tabela */}
      <Card className="mt-4">
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
          ) : !report || report.rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nenhuma venda paga nesse dia.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Hora</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Produto</th>
                    <th className="px-4 py-3">Forma</th>
                    <th className="px-4 py-3 text-right">Valor</th>
                    <th className="px-4 py-3">Cupom</th>
                    <th className="px-4 py-3">Bling</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/30 last:border-0">
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{hora(r.paidAt)}</td>
                      <td className="px-4 py-2.5 font-medium">{r.customerName}</td>
                      <td className="px-4 py-2.5">{r.product}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="text-[0.7rem]">
                          {r.method === 'card' ? `Cartão${r.installments ? ` ${r.installments}x` : ''}` : 'Pix'}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{brl(r.amountCents)}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.couponCode ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.blingOrderId ? `#${r.blingOrderId}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="mt-2 text-[0.7rem] text-muted-foreground">
        <FileSpreadsheet className="mr-1 inline size-3" /> Valores = total cobrado (produto + frete). Só vendas pagas.
      </p>
    </AppLayout>
  )
}
