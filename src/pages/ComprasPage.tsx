import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ClipboardList, Plus, Trash2, Truck, Check, ShoppingCart, Ban } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { estoqueTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import {
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type StockItem,
  type Supplier,
  createPurchaseOrder,
  listPurchaseOrders,
  listStockItems,
  listSuppliers,
  receivePurchaseOrder,
  setPurchaseOrderStatus,
  upsertSupplier,
} from '@/services/estoqueCompras'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const STATUS_BADGE: Record<PurchaseOrderStatus, { label: string; className: string }> = {
  solicitada: { label: 'Solicitada', className: 'bg-sky-500/15 text-sky-600' },
  aprovada: { label: 'Aprovada', className: 'bg-violet-500/15 text-violet-600' },
  comprada: { label: 'Comprada', className: 'bg-amber-500/15 text-amber-600' },
  recebida: { label: 'Recebida', className: 'bg-emerald-500/15 text-emerald-600' },
  cancelada: { label: 'Cancelada', className: 'bg-red-500/15 text-red-600' },
}

type DraftItem = { itemId: string; description: string; qty: string; unitCost: string }
const EMPTY_ROW: DraftItem = { itemId: '', description: '', qty: '', unitCost: '' }

export function ComprasPage() {
  const { tenant } = useTenant()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(false)

  const [supplierId, setSupplierId] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<DraftItem[]>([{ ...EMPTY_ROW }])
  const [saving, setSaving] = useState(false)

  const [newSupplierName, setNewSupplierName] = useState('')
  const [showNewSupplier, setShowNewSupplier] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [po, sup, items] = await Promise.all([listPurchaseOrders(), listSuppliers(), listStockItems()])
      setOrders(po)
      setSuppliers(sup)
      setStockItems(items)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar compras')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const draftTotal = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const qty = Number(r.qty.replace(',', '.')) || 0
        const cost = Number(r.unitCost.replace(',', '.')) || 0
        return sum + Math.round(qty * cost * 100)
      }, 0),
    [rows],
  )

  const setRow = (index: number, patch: Partial<DraftItem>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const pickStockItem = (index: number, itemId: string) => {
    const item = stockItems.find((i) => i.id === itemId)
    setRow(index, { itemId, description: item ? item.name : '' })
  }

  const handleCreateSupplier = async () => {
    if (newSupplierName.trim().length < 2) {
      toast.error('Informe o nome do fornecedor.')
      return
    }
    try {
      const created = await upsertSupplier({ name: newSupplierName })
      setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setSupplierId(created.id)
      setNewSupplierName('')
      setShowNewSupplier(false)
      toast.success(`Fornecedor "${created.name}" cadastrado.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar fornecedor')
    }
  }

  const handleCreate = async () => {
    const items = rows
      .map((r) => ({
        itemId: r.itemId || null,
        description: r.description.trim(),
        qty: Number(r.qty.replace(',', '.')) || 0,
        unitCostCents: Math.round((Number(r.unitCost.replace(',', '.')) || 0) * 100),
      }))
      .filter((r) => r.description && r.qty > 0)
    if (items.length === 0) {
      toast.error('Inclua ao menos um item com descrição e quantidade.')
      return
    }
    setSaving(true)
    try {
      await createPurchaseOrder({ supplierId: supplierId || null, expectedDate: expectedDate || null, note, items })
      toast.success('Ordem de compra criada.')
      setSupplierId('')
      setExpectedDate('')
      setNote('')
      setRows([{ ...EMPTY_ROW }])
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar ordem de compra')
    } finally {
      setSaving(false)
    }
  }

  const advance = async (po: PurchaseOrder, status: PurchaseOrderStatus) => {
    try {
      await setPurchaseOrderStatus(po.id, status)
      toast.success(`${po.code} → ${STATUS_BADGE[status].label.toLowerCase()}.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar a ordem')
    }
  }

  const receive = async (po: PurchaseOrder) => {
    try {
      const { stocked, skipped } = await receivePurchaseOrder(po)
      toast.success(
        `${po.code} recebida — ${stocked} ${stocked === 1 ? 'item deu' : 'itens deram'} entrada no estoque` +
          (skipped > 0 ? ` (${skipped} sem vínculo, não movimentado)` : '') + '.',
      )
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao receber a ordem')
    }
  }

  return (
    <AppLayout
      title="Ordens de compra"
      subtitle="Solicitação, aprovação e recebimento — receber a OC dá entrada automática no estoque."
    >
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,440px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Plus className="size-4 text-primary" /> Nova solicitação
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Fornecedor</Label>
              <div className="flex gap-2">
                <Select value={supplierId} onValueChange={(v) => setSupplierId(v ?? '')}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Selecionar (opcional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => setShowNewSupplier((v) => !v)}>
                  Novo
                </Button>
              </div>
              {showNewSupplier ? (
                <div className="flex gap-2 pt-1">
                  <Input
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    placeholder="Nome do fornecedor"
                  />
                  <Button size="sm" className="shrink-0" onClick={handleCreateSupplier}>
                    Salvar
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="po-date">Previsão de entrega</Label>
                <Input id="po-date" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="po-note">Observação</Label>
                <Input id="po-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Itens</Label>
              {rows.map((row, i) => (
                <div key={i} className="space-y-1.5 rounded-md border border-border p-2.5">
                  <Select value={row.itemId || 'livre'} onValueChange={(v) => pickStockItem(i, !v || v === 'livre' ? '' : v)}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="livre">Item livre (sem vínculo de estoque)</SelectItem>
                      {stockItems.map((it) => (
                        <SelectItem key={it.id} value={it.id}>
                          {it.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={row.description}
                    onChange={(e) => setRow(i, { description: e.target.value })}
                    placeholder="Descrição"
                    className="h-8"
                  />
                  <div className="flex gap-2">
                    <Input
                      value={row.qty}
                      onChange={(e) => setRow(i, { qty: e.target.value })}
                      placeholder="Qtd"
                      inputMode="decimal"
                      className="h-8"
                    />
                    <Input
                      value={row.unitCost}
                      onChange={(e) => setRow(i, { unitCost: e.target.value })}
                      placeholder="Custo unit. (R$)"
                      inputMode="decimal"
                      className="h-8"
                    />
                    {rows.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 px-2"
                        onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW }])}>
                <Plus className="size-3.5" /> Adicionar item
              </Button>
            </div>

            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-sm text-muted-foreground">Total estimado</span>
              <span className="font-semibold">{formatBRL(draftTotal)}</span>
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={saving}>
              {saving ? 'Criando…' : 'Criar solicitação'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ClipboardList className="size-4 text-primary" /> Ordens ({orders.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {orders.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title={loading ? 'Carregando…' : 'Nenhuma ordem de compra'}
                description="Crie a primeira solicitação ao lado — ela passa por aprovação antes da compra."
              />
            ) : (
              orders.map((po) => {
                const badge = STATUS_BADGE[po.status]
                return (
                  <div key={po.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{po.code}</span>
                        <Badge className={badge.className} variant="secondary">
                          {badge.label}
                        </Badge>
                      </div>
                      <span className="font-semibold">{formatBRL(po.totalCents)}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {po.supplierName ?? 'Sem fornecedor'} ·{' '}
                      {new Date(po.createdAt).toLocaleDateString('pt-BR')}
                      {po.expectedDate
                        ? ` · previsão ${new Date(`${po.expectedDate}T12:00:00`).toLocaleDateString('pt-BR')}`
                        : ''}
                    </div>
                    <ul className="mt-2 space-y-0.5 text-sm">
                      {po.items.map((it) => (
                        <li key={it.id} className="flex justify-between gap-2">
                          <span className="min-w-0 truncate">
                            {it.qty}× {it.description}
                            {!it.itemId ? <span className="text-xs text-muted-foreground"> (livre)</span> : null}
                          </span>
                          <span className="shrink-0 text-muted-foreground">{formatBRL(it.unitCostCents)}</span>
                        </li>
                      ))}
                    </ul>
                    {po.note ? <p className="mt-1.5 text-xs text-muted-foreground">{po.note}</p> : null}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {po.status === 'solicitada' ? (
                        <Button size="sm" onClick={() => void advance(po, 'aprovada')}>
                          <Check className="size-3.5" /> Aprovar
                        </Button>
                      ) : null}
                      {po.status === 'aprovada' ? (
                        <Button size="sm" onClick={() => void advance(po, 'comprada')}>
                          <ShoppingCart className="size-3.5" /> Marcar comprada
                        </Button>
                      ) : null}
                      {po.status === 'comprada' ? (
                        <Button size="sm" onClick={() => void receive(po)}>
                          <Truck className="size-3.5" /> Receber (entrada no estoque)
                        </Button>
                      ) : null}
                      {po.status !== 'recebida' && po.status !== 'cancelada' ? (
                        <Button size="sm" variant="ghost" onClick={() => void advance(po, 'cancelada')}>
                          <Ban className="size-3.5" /> Cancelar
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
