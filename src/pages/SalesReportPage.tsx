import { Fragment, useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Copy, Download, RefreshCw, FileSpreadsheet, ChevronDown, ChevronRight } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatCard } from '@/components/page/StatCard'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
  const [openRow, setOpenRow] = useState<number | null>(null)

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
      toast.success('Resumo copiado, cole no financeiro.')
    } catch {
      toast.error('Não consegui copiar.')
    }
  }

  const t = report?.totals

  return (
    <AppLayout title="Relatórios de vendas" subtitle="Vendas pagas do dia (cartão, Pix e venda manual) para o financeiro.">
      <SubTabs tabs={[{ to: '/relatorio-vendas', label: 'Por dia' }, { to: '/tricopill-relatorios', label: 'Por mês' }]} />

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
        <StatCard label="Total do dia" value={t ? brl(t.totalCents) : '—'} />
        <StatCard label="Vendas" value={t?.count ?? 0} />
        <StatCard label="Cartão" valueClassName="text-lg" value={t ? brl(t.cardCents) : '—'} hint={`${t?.cardCount ?? 0} venda(s)`} />
        <StatCard label="Pix" valueClassName="text-lg" value={t ? brl(t.pixCents) : '—'} hint={`${t?.pixCount ?? 0} venda(s)`} />
      </div>

      {/* Tabela */}
      <Card className="mt-4">
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
          ) : !report || report.rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nenhuma venda paga nesse dia.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 px-2">
                    <span className="sr-only">Detalhes</span>
                  </TableHead>
                  <TableHead>Hora</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Cupom</TableHead>
                  <TableHead>Bling</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r, i) => {
                  const open = openRow === i
                  const hasDetail = !!(r.cpf || r.email || r.address || r.phone)
                  return (
                    <Fragment key={i}>
                      <TableRow
                        className={hasDetail ? 'cursor-pointer' : undefined}
                        onClick={() => hasDetail && setOpenRow(open ? null : i)}
                      >
                        <TableCell className="px-2 text-muted-foreground">
                          {hasDetail ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-expanded={open}
                              aria-label={open ? `Ocultar detalhes de ${r.customerName}` : `Ver detalhes de ${r.customerName}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setOpenRow(open ? null : i)
                              }}
                            >
                              {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                            </Button>
                          ) : null}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{hora(r.paidAt)}</TableCell>
                        <TableCell className="font-medium">
                          {r.customerName}
                          {r.cpf ? <span className="ml-2 text-xs font-normal text-muted-foreground">CPF {r.cpf}</span> : null}
                        </TableCell>
                        <TableCell>{r.product}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[0.7rem]">
                            {r.method === 'card' ? `Cartão${r.installments ? ` ${r.installments}x` : ''}` : 'Pix'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{brl(r.amountCents)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.couponCode ?? '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.blingOrderId ? `#${r.blingOrderId}` : '—'}</TableCell>
                      </TableRow>
                      {open && hasDetail ? (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell />
                          <TableCell colSpan={7} className="py-3">
                            <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                              {r.cpf ? (
                                <div className="flex gap-2"><dt className="text-muted-foreground">CPF:</dt><dd className="font-medium">{r.cpf}</dd></div>
                              ) : null}
                              {r.phone ? (
                                <div className="flex gap-2"><dt className="text-muted-foreground">Telefone:</dt><dd className="font-medium">{r.phone}</dd></div>
                              ) : null}
                              {r.email ? (
                                <div className="flex gap-2"><dt className="text-muted-foreground">E-mail:</dt><dd className="font-medium">{r.email}</dd></div>
                              ) : null}
                              {r.address ? (
                                <div className="flex gap-2 sm:col-span-2"><dt className="text-muted-foreground">Endereço:</dt><dd className="font-medium">{r.address}</dd></div>
                              ) : null}
                              {!r.address ? (
                                <div className="text-muted-foreground sm:col-span-2">Endereço não cadastrado, o bot ainda não coletou.</div>
                              ) : null}
                            </dl>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="mt-2 text-[0.7rem] text-muted-foreground">
        <FileSpreadsheet className="mr-1 inline size-3" /> Valores = total cobrado (produto + frete). Só vendas pagas.
      </p>
    </AppLayout>
  )
}
