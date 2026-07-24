import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftRight, Plus, Warehouse } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { estoqueTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import {
  type StockTransfer,
  type StockWarehouse,
  createTransfer,
  listTransfers,
  listWarehouses,
  upsertWarehouse,
} from '@/services/estoqueArmazens'

type DraftRow = { itemId: string; qty: string }

export function TransferenciasEstoquePage() {
  const { tenant } = useTenant()
  const [warehouses, setWarehouses] = useState<StockWarehouse[]>([])
  const [items, setItems] = useState<StockItem[]>([])
  const [transfers, setTransfers] = useState<StockTransfer[]>([])
  const [loading, setLoading] = useState(false)

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([{ itemId: '', qty: '' }])
  const [saving, setSaving] = useState(false)

  const [whName, setWhName] = useState('')
  const [whCode, setWhCode] = useState('')

  const itemName = useMemo(() => new Map(items.map((i) => [i.id, i.name] as const)), [items])

  const load = async () => {
    setLoading(true)
    try {
      const [w, it, tr] = await Promise.all([listWarehouses(), listStockItems(), listTransfers()])
      setWarehouses(w)
      setItems(it)
      setTransfers(tr)
      if (!fromId && w[0]) setFromId(w[0].id)
      if (!toId && w[1]) setToId(w[1].id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar transferências')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveWarehouse = async () => {
    try {
      await upsertWarehouse({ name: whName, code: whCode || null })
      toast.success(`Setor "${whName.trim()}" criado.`)
      setWhName('')
      setWhCode('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar setor')
    }
  }

  const transfer = async () => {
    const itemsPayload = rows
      .map((r) => ({ itemId: r.itemId, qty: Number(r.qty.replace(',', '.')) || 0 }))
      .filter((r) => r.itemId && r.qty > 0)
    setSaving(true)
    try {
      await createTransfer({ fromWarehouseId: fromId, toWarehouseId: toId, note, items: itemsPayload })
      toast.success('Transferência registrada.')
      setRows([{ itemId: '', qty: '' }])
      setNote('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na transferência')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppLayout
      title="Transferência de estoque"
      subtitle="Mova itens entre setores / armazéns (ex.: farmácia → centro cirúrgico)."
    >
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Warehouse className="size-4 text-primary" /> Novo setor / armazém
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="Nome (ex.: Centro cirúrgico)" />
              <Input value={whCode} onChange={(e) => setWhCode(e.target.value)} placeholder="Código (opcional)" />
              <Button className="w-full" variant="outline" onClick={() => void saveWarehouse()}>
                <Plus className="size-3.5" /> Criar setor
              </Button>
              {warehouses.length > 0 ? (
                <ul className="space-y-1 pt-2 text-sm text-muted-foreground">
                  {warehouses.map((w) => (
                    <li key={w.id}>
                      {w.name}
                      {w.isDefault ? ' · padrão' : ''}
                      {w.code ? ` (${w.code})` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ArrowLeftRight className="size-4 text-primary" /> Transferir
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>De</Label>
                  <Select value={fromId} onValueChange={(v) => setFromId(v ?? '')}>
                    <SelectTrigger>
                      <SelectValue placeholder="Origem" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Para</Label>
                  <Select value={toId} onValueChange={(v) => setToId(v ?? '')}>
                    <SelectTrigger>
                      <SelectValue placeholder="Destino" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {rows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <Select
                    value={row.itemId}
                    onValueChange={(v) =>
                      setRows((prev) => prev.map((r, j) => (j === i ? { ...r, itemId: v ?? '' } : r)))
                    }
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Item" />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((it) => (
                        <SelectItem key={it.id} value={it.id}>
                          {it.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-24"
                    value={row.qty}
                    onChange={(e) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)))}
                    placeholder="Qtd"
                    inputMode="decimal"
                  />
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setRows((p) => [...p, { itemId: '', qty: '' }])}>
                <Plus className="size-3.5" /> Item
              </Button>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observação (opcional)" />
              <Button className="w-full" onClick={() => void transfer()} disabled={saving}>
                {saving ? 'Transferindo…' : 'Confirmar transferência'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Histórico ({transfers.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {transfers.length === 0 ? (
              <EmptyState
                icon={ArrowLeftRight}
                title={loading ? 'Carregando…' : 'Nenhuma transferência'}
                description="Crie setores e mova itens entre eles."
              />
            ) : (
              transfers.map((t) => (
                <div key={t.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="font-semibold">
                    {t.fromName} → {t.toName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString('pt-BR')}
                    {t.note ? ` · ${t.note}` : ''}
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {t.items.map((i) => (
                      <li key={i.id}>
                        {i.qty}× {itemName.get(i.itemId) ?? '?'}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
