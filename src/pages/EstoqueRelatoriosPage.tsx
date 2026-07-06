import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDownUp, Boxes, CalendarClock, FileDown, FileBarChart2, Flame } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { estoqueTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import {
  type StockItem,
  type StockMovementRow,
  listMovementsInRange,
  listStockItems,
} from '@/services/estoqueCompras'
import { type StockBatch, listBatchBalances, listItemLastCosts } from '@/services/estoqueKits'
import { downloadCsv } from '@/services/tricopillReports'

const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csvRow = (cells: unknown[]) => cells.map(csvCell).join(';')

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const firstDayOfMonth = () => {
  const d = new Date()
  d.setDate(1)
  return ymd(d)
}

const KIND_LABEL: Record<string, string> = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste' }

export function EstoqueRelatoriosPage() {
  const { tenant } = useTenant()
  const [items, setItems] = useState<StockItem[]>([])
  const [batches, setBatches] = useState<StockBatch[]>([])
  const [lastCosts, setLastCosts] = useState<Map<string, number>>(new Map())
  const [movements, setMovements] = useState<StockMovementRow[]>([])
  const [from, setFrom] = useState(firstDayOfMonth())
  const [to, setTo] = useState(ymd(new Date()))
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!from || !to) return
    setLoading(true)
    try {
      const [it, bs, costs, moves] = await Promise.all([
        listStockItems(),
        listBatchBalances(),
        listItemLastCosts(),
        listMovementsInRange(from, to),
      ])
      setItems(it)
      setBatches(bs)
      setLastCosts(costs)
      setMovements(moves)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar relatórios')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])

  // ---- Posição atual (com valor em estoque pelo último custo de compra)
  const position = useMemo(
    () =>
      items.map((i) => {
        const cost = lastCosts.get(i.id) ?? null
        return {
          ...i,
          lastCostCents: cost,
          valueCents: cost != null ? Math.round(i.qty * cost) : null,
          low: i.minQty > 0 && i.qty < i.minQty,
        }
      }),
    [items, lastCosts],
  )
  const totalValueCents = position.reduce((acc, p) => acc + (p.valueCents ?? 0), 0)
  const lowCount = position.filter((p) => p.low).length
  const uncostedCount = position.filter((p) => p.qty > 0 && p.lastCostCents == null).length

  // Lotes vencendo em ≤30 dias ou vencidos (com saldo)
  const expiring = useMemo(() => {
    const in30 = new Date()
    in30.setDate(in30.getDate() + 30)
    const in30Ymd = ymd(in30)
    const todayYmd = ymd(new Date())
    return batches
      .filter((b) => b.qty > 0 && b.expiresOn && b.expiresOn <= in30Ymd)
      .map((b) => ({ ...b, itemName: itemById.get(b.itemId)?.name ?? '?', expired: b.expiresOn! < todayYmd }))
      .sort((a, b) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? ''))
  }, [batches, itemById])

  // ---- Consumo por item no período (itens de uso: saídas, kits inclusos)
  const consumption = useMemo(() => {
    const byItem = new Map<string, { qty: number; costCents: number; uncosted: boolean }>()
    for (const m of movements) {
      if (m.kind !== 'saida') continue
      const acc = byItem.get(m.itemId) ?? { qty: 0, costCents: 0, uncosted: false }
      const qty = Math.abs(m.qtyDelta)
      acc.qty += qty
      if (m.unitCostCents != null) acc.costCents += Math.round(qty * m.unitCostCents)
      else acc.uncosted = true
      byItem.set(m.itemId, acc)
    }
    return [...byItem.entries()]
      .map(([itemId, v]) => ({ itemId, name: itemById.get(itemId)?.name ?? '?', unit: itemById.get(itemId)?.unit ?? 'un', ...v }))
      .sort((a, b) => b.costCents - a.costCents || b.qty - a.qty)
  }, [movements, itemById])
  const consumptionTotalCents = consumption.reduce((acc, c) => acc + c.costCents, 0)

  const entriesTotalCents = movements
    .filter((m) => m.kind === 'entrada' && m.unitCostCents != null)
    .reduce((acc, m) => acc + Math.round(Math.abs(m.qtyDelta) * (m.unitCostCents ?? 0)), 0)

  // ---- Exports CSV
  const exportPosition = () => {
    const head = csvRow(['Item', 'SKU', 'Cód. barras', 'Categoria', 'Saldo', 'Unidade', 'Mínimo', 'Último custo (R$)', 'Valor em estoque (R$)'])
    const lines = position.map((p) =>
      csvRow([
        p.name, p.sku ?? '', p.barcode ?? '', p.category ?? '', p.qty, p.unit, p.minQty,
        p.lastCostCents != null ? (p.lastCostCents / 100).toFixed(2).replace('.', ',') : '',
        p.valueCents != null ? (p.valueCents / 100).toFixed(2).replace('.', ',') : '',
      ]),
    )
    downloadCsv(`estoque-posicao-${ymd(new Date())}.csv`, [head, ...lines].join('\n'))
  }

  const exportMovements = () => {
    const head = csvRow(['Data', 'Item', 'Tipo', 'Qtd', 'Custo unit. (R$)', 'Valor (R$)', 'Motivo', 'Origem', 'Obs'])
    const lines = movements.map((m) =>
      csvRow([
        new Date(m.createdAt).toLocaleString('pt-BR'),
        itemById.get(m.itemId)?.name ?? m.itemId,
        KIND_LABEL[m.kind] ?? m.kind,
        m.qtyDelta,
        m.unitCostCents != null ? (m.unitCostCents / 100).toFixed(2).replace('.', ',') : '',
        m.unitCostCents != null ? ((Math.abs(m.qtyDelta) * m.unitCostCents) / 100).toFixed(2).replace('.', ',') : '',
        m.reason ?? '', m.refType ?? '', m.note ?? '',
      ]),
    )
    downloadCsv(`estoque-movimentos-${from}-a-${to}.csv`, [head, ...lines].join('\n'))
  }

  const exportConsumption = () => {
    const head = csvRow(['Item', 'Qtd consumida', 'Unidade', 'Custo total (R$)'])
    const lines = consumption.map((c) =>
      csvRow([c.name, c.qty, c.unit, (c.costCents / 100).toFixed(2).replace('.', ',')]),
    )
    downloadCsv(`estoque-consumo-${from}-a-${to}.csv`, [head, ...lines].join('\n'))
  }

  return (
    <AppLayout
      title="Relatórios de estoque"
      subtitle="Posição e valor do estoque, movimentações e consumo por período — tudo exportável em CSV."
    >
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rep-from">De</Label>
          <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rep-to">Até</Label>
          <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
        </div>
        {loading ? <span className="pb-2 text-xs text-muted-foreground">Carregando…</span> : null}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Valor em estoque</p>
            <p className="text-2xl font-bold">{formatBRL(totalValueCents)}</p>
            {uncostedCount > 0 ? (
              <p className="text-xs text-muted-foreground">{uncostedCount} {uncostedCount === 1 ? 'item' : 'itens'} com saldo sem custo</p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Consumo no período</p>
            <p className="text-2xl font-bold">{formatBRL(consumptionTotalCents)}</p>
            <p className="text-xs text-muted-foreground">{consumption.length} {consumption.length === 1 ? 'item consumido' : 'itens consumidos'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Compras no período</p>
            <p className="text-2xl font-bold">{formatBRL(entriesTotalCents)}</p>
            <p className="text-xs text-muted-foreground">entradas valoradas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Alertas</p>
            <p className="text-2xl font-bold">
              {lowCount + expiring.length > 0 ? lowCount + expiring.length : '0'}
            </p>
            <p className="text-xs text-muted-foreground">
              {lowCount} abaixo do mínimo · {expiring.length} {expiring.length === 1 ? 'lote vencendo' : 'lotes vencendo'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Boxes className="size-4 text-primary" /> Posição atual ({position.length})
            </CardTitle>
            <Button size="sm" variant="outline" onClick={exportPosition} disabled={position.length === 0}>
              <FileDown className="size-3.5" /> CSV
            </Button>
          </CardHeader>
          <CardContent>
            {position.length === 0 ? (
              <EmptyState icon={Boxes} title={loading ? 'Carregando…' : 'Sem itens'} description="Cadastre itens na aba Estoque." />
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead className="text-right">Mínimo</TableHead>
                      <TableHead className="text-right">Último custo</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {position.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={p.low ? 'destructive' : 'secondary'}>
                            {p.qty} {p.unit}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{p.minQty || '—'}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {p.lastCostCents != null ? formatBRL(p.lastCostCents) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {p.valueCents != null ? formatBRL(p.valueCents) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Flame className="size-4 text-primary" /> Consumo por item (itens de uso)
              </CardTitle>
              <Button size="sm" variant="outline" onClick={exportConsumption} disabled={consumption.length === 0}>
                <FileDown className="size-3.5" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              {consumption.length === 0 ? (
                <EmptyState
                  icon={Flame}
                  title={loading ? 'Carregando…' : 'Sem consumo no período'}
                  description="As saídas (uso avulso e kits consumidos) aparecem aqui com quantidade e custo."
                />
              ) : (
                <div className="max-h-[360px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead className="text-right">Custo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {consumption.map((c) => (
                        <TableRow key={c.itemId}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-right">{c.qty} {c.unit}</TableCell>
                          <TableCell className="text-right">
                            {formatBRL(c.costCents)}
                            {c.uncosted ? <span className="text-xs text-muted-foreground"> (parcial)</span> : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarClock className="size-4 text-primary" /> Validades próximas ({expiring.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {expiring.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title="Nenhum lote vencendo"
                  description="Lotes com saldo vencidos ou vencendo em até 30 dias aparecem aqui."
                />
              ) : (
                <div className="max-h-[360px] space-y-1.5 overflow-auto">
                  {expiring.map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium">{b.itemName}</span>{' '}
                        <span className="text-xs text-muted-foreground">lote {b.lotCode} · {b.qty} un</span>
                      </div>
                      <Badge variant={b.expired ? 'destructive' : 'secondary'}>
                        {b.expired ? 'venceu' : 'vence'}{' '}
                        {new Date(`${b.expiresOn}T12:00:00`).toLocaleDateString('pt-BR')}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ArrowDownUp className="size-4 text-primary" /> Movimentações no período ({movements.length})
            </CardTitle>
            <Button size="sm" variant="outline" onClick={exportMovements} disabled={movements.length === 0}>
              <FileDown className="size-3.5" /> CSV
            </Button>
          </CardHeader>
          <CardContent>
            {movements.length === 0 ? (
              <EmptyState
                icon={FileBarChart2}
                title={loading ? 'Carregando…' : 'Sem movimentos no período'}
                description="Entradas, saídas e ajustes aparecem aqui com custo e origem (OC, NF-e, kit…)."
              />
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Motivo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(m.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell className="font-medium">{itemById.get(m.itemId)?.name ?? '?'}</TableCell>
                        <TableCell>
                          <span className={m.qtyDelta < 0 ? 'font-medium text-red-500' : 'font-medium text-emerald-600'}>
                            {KIND_LABEL[m.kind] ?? m.kind}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}</TableCell>
                        <TableCell className="text-right">
                          {m.unitCostCents != null ? formatBRL(Math.round(Math.abs(m.qtyDelta) * m.unitCostCents)) : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {[m.reason, m.note].filter(Boolean).join(' · ') || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
