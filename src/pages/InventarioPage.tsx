import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ClipboardCheck, Plus, Check, Ban, ListChecks } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { estoqueTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import {
  type StockCount,
  cancelCount,
  finalizeCount,
  listCounts,
  openCount,
  setCountedQty,
} from '@/services/estoqueInventario'

export function InventarioPage() {
  const { tenant } = useTenant()
  const [counts, setCounts] = useState<StockCount[]>([])
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(false)
  const [label, setLabel] = useState('')
  const [opening, setOpening] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const itemName = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])

  const load = async () => {
    setLoading(true)
    try {
      const [c, it] = await Promise.all([listCounts(), listStockItems(true)])
      setCounts(c)
      setItems(it)
      // mantém aberta a contagem selecionada, ou abre a primeira 'aberta'
      const open = c.find((x) => x.id === activeId) ?? c.find((x) => x.status === 'aberta')
      setActiveId(open?.id ?? null)
      if (open) {
        const d: Record<string, string> = {}
        for (const ci of open.items) if (ci.countedQty != null) d[ci.id] = String(ci.countedQty)
        setDrafts(d)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar inventário')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.id])

  const active = counts.find((c) => c.id === activeId) ?? null

  const handleOpen = async () => {
    if (items.length === 0) {
      toast.error('Cadastre itens no estoque antes de abrir uma contagem.')
      return
    }
    setOpening(true)
    try {
      const id = await openCount(label || `Contagem ${new Date().toLocaleDateString('pt-BR')}`)
      toast.success('Contagem aberta com o saldo atual do sistema.')
      setLabel('')
      setActiveId(id)
      setDrafts({})
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir contagem')
    } finally {
      setOpening(false)
    }
  }

  const saveCounted = async (countItemId: string, raw: string) => {
    const trimmed = raw.trim()
    const value = trimmed === '' ? null : Number(trimmed.replace(',', '.'))
    if (value != null && !Number.isFinite(value)) return
    try {
      await setCountedQty(countItemId, value)
      setCounts((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? { ...c, items: c.items.map((ci) => (ci.id === countItemId ? { ...ci, countedQty: value } : ci)) }
            : c,
        ),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar contagem')
    }
  }

  const handleFinalize = async () => {
    if (!active) return
    try {
      const fresh = await listStockItems(true)
      const { adjusted } = await finalizeCount(active, fresh)
      toast.success(
        adjusted === 0
          ? 'Contagem finalizada — sem divergências.'
          : `Contagem finalizada — ${adjusted} ${adjusted === 1 ? 'item ajustado' : 'itens ajustados'} no estoque.`,
      )
      setActiveId(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao finalizar contagem')
    }
  }

  const handleCancel = async (id: string) => {
    try {
      await cancelCount(id)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cancelar contagem')
    }
  }

  const pending = active ? active.items.filter((ci) => ci.countedQty == null).length : 0

  return (
    <AppLayout
      title="Inventário"
      subtitle="Contagem física do estoque — a divergência vira ajuste automático no saldo."
    >
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Plus className="size-4 text-primary" /> Nova contagem
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="inv-label">Nome/referência</Label>
                <Input
                  id="inv-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex.: Inventário mensal julho"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Abrir uma contagem fotografa o saldo atual de todos os itens ({items.length}). Depois é só digitar o que foi contado.
              </p>
              <Button className="w-full" onClick={handleOpen} disabled={opening}>
                {opening ? 'Abrindo…' : 'Abrir contagem'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListChecks className="size-4 text-primary" /> Contagens ({counts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {counts.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">Nenhuma contagem ainda.</p>
              ) : (
                counts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveId(c.id)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      c.id === activeId ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <div>
                      <div className="font-medium">{c.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(c.createdAt).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={
                        c.status === 'finalizada'
                          ? 'bg-emerald-500/15 text-emerald-600'
                          : c.status === 'cancelada'
                            ? 'bg-red-500/15 text-red-600'
                            : 'bg-sky-500/15 text-sky-600'
                      }
                    >
                      {c.status}
                    </Badge>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ClipboardCheck className="size-4 text-primary" />
              {active ? active.label : 'Contagem'}
            </CardTitle>
            {active && active.status === 'aberta' ? (
              <div className="flex gap-1.5">
                <Button size="sm" onClick={handleFinalize} disabled={pending === active.items.length}>
                  <Check className="size-3.5" /> Finalizar {pending > 0 ? `(${pending} sem contar)` : ''}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void handleCancel(active.id)}>
                  <Ban className="size-3.5" /> Cancelar
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            {!active ? (
              <EmptyState
                icon={ClipboardCheck}
                title={loading ? 'Carregando…' : 'Selecione ou abra uma contagem'}
                description="Cada contagem lista os itens com o saldo do sistema para você conferir com o físico."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Sistema</TableHead>
                      <TableHead className="text-right">Contado</TableHead>
                      <TableHead className="text-right">Diferença</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {active.items.map((ci) => {
                      const it = itemName.get(ci.itemId)
                      const counted = ci.countedQty
                      const diff = counted != null ? counted - ci.systemQty : null
                      return (
                        <TableRow key={ci.id}>
                          <TableCell className="font-medium">{it?.name ?? ci.itemId}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {ci.systemQty} {it?.unit ?? ''}
                          </TableCell>
                          <TableCell className="text-right">
                            {active.status === 'aberta' ? (
                              <Input
                                value={drafts[ci.id] ?? (counted != null ? String(counted) : '')}
                                onChange={(e) => setDrafts((d) => ({ ...d, [ci.id]: e.target.value }))}
                                onBlur={(e) => void saveCounted(ci.id, e.target.value)}
                                inputMode="decimal"
                                className="ml-auto h-8 w-20 text-right"
                                placeholder="—"
                              />
                            ) : (
                              <span className="tabular-nums">{counted ?? '—'}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {diff == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : diff === 0 ? (
                              <span className="text-emerald-600">0</span>
                            ) : (
                              <span className={diff > 0 ? 'text-sky-600' : 'text-red-500'}>
                                {diff > 0 ? `+${diff}` : diff}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
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
