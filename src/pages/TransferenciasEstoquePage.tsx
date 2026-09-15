import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDownUp, ArrowLeftRight, Plus, Trash2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { ExportarMenu } from '@/components/page/ExportarMenu'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchPicker } from '@/components/ui/search-picker'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { formatQtd, produtosParaBusca } from '@/components/kits/kitUi'
import { estoqueTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { beep } from '@/lib/beep'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { exportarExcel, exportarPdf } from '@/lib/exportar'
import { cn } from '@/lib/utils'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import {
  type StockTransfer,
  type StockWarehouse,
  createTransfer,
  listTransfers,
  listWarehouses,
  upsertWarehouse,
} from '@/services/estoqueArmazens'

type Linha = { itemId: string; qty: number }

/**
 * Levar material de um setor para outro (Principal → Centro Cirúrgico, SPA, Consultório,
 * Higienização). Era um select com os 1.500 itens do estoque em cada linha: ninguém acha
 * "luva 7,5" rolando uma lista. Agora é digitar ou bipar, como no resto do estoque.
 */
export function TransferenciasEstoquePage() {
  const { tenant } = useTenant()
  const [warehouses, setWarehouses] = useState<StockWarehouse[]>([])
  const [items, setItems] = useState<StockItem[]>([])
  const [transfers, setTransfers] = useState<StockTransfer[]>([])
  const [loading, setLoading] = useState(true)

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [note, setNote] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [saving, setSaving] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [novoSetor, setNovoSetor] = useState(false)
  const [whName, setWhName] = useState('')

  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const busca = useMemo(() => produtosParaBusca(items), [items])

  const load = async () => {
    try {
      const [w, it, tr] = await Promise.all([listWarehouses(), listStockItems(), listTransfers()])
      setWarehouses(w)
      setItems(it)
      setTransfers(tr)
      const padrao = w.find((x) => x.isDefault) ?? w[0]
      setFromId((atual) => atual || padrao?.id || '')
      setToId((atual) => atual || w.find((x) => x.id !== padrao?.id)?.id || '')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar transferências')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const incluir = (item: StockItem) => {
    beep(true)
    setLinhas((prev) => {
      const i = prev.findIndex((l) => l.itemId === item.id)
      if (i >= 0) return prev.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [{ itemId: item.id, qty: 1 }, ...prev]
    })
  }

  const onCode = (code: string) => {
    const item = acharItemPorCodigo(items, code)
    if (!item) {
      beep(false)
      setCodigo(code)
      return
    }
    incluir(item)
  }

  const transferir = async () => {
    if (!fromId || !toId || fromId === toId) {
      toast.error('Escolha setores de origem e destino diferentes.')
      return
    }
    const validas = linhas.filter((l) => l.qty > 0)
    if (validas.length === 0) {
      toast.error('Inclua ao menos um item.')
      return
    }
    setSaving(true)
    try {
      await createTransfer({ fromWarehouseId: fromId, toWarehouseId: toId, note, items: validas })
      toast.success(`Transferência registrada: ${validas.length} ${validas.length === 1 ? 'item' : 'itens'}.`)
      setLinhas([])
      setNote('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na transferência')
    } finally {
      setSaving(false)
    }
  }

  const criarSetor = async () => {
    if (whName.trim().length < 2) return
    try {
      await upsertWarehouse({ name: whName, code: null })
      toast.success(`Setor "${whName.trim()}" criado.`)
      setWhName('')
      setNovoSetor(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar setor')
    }
  }

  const setores = (valor: string, onChange: (id: string) => void, bloqueado: string) => (
    <div className="flex flex-wrap gap-1.5">
      {warehouses.map((w) => (
        <button
          key={w.id}
          type="button"
          disabled={w.id === bloqueado}
          onClick={() => onChange(w.id)}
          className={cn(
            'rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            valor === w.id ? 'border-primary bg-primary/10 font-medium' : 'border-border bg-card hover:bg-muted',
          )}
        >
          {w.name}
        </button>
      ))}
    </div>
  )

  const linhasHistorico = transfers.flatMap((t) =>
    t.items.map((i) => [new Date(t.createdAt).toLocaleString('pt-BR'), t.fromName, t.toName, porId.get(i.itemId)?.name ?? '?', i.qty, t.note ?? '']),
  )

  return (
    <AppLayout
      title="Transferência de estoque"
      subtitle="Leve material entre setores: digite ou bipe o item, ajuste a quantidade e confirme."
      actions={
        <ExportarMenu
          disabled={transfers.length === 0}
          onExcel={() =>
            exportarExcel('transferencias-estoque', [
              { nome: 'Transferências', colunas: ['Data', 'De', 'Para', 'Item', 'Quantidade', 'Observação'], linhas: linhasHistorico },
            ])
          }
          onPdf={() =>
            exportarPdf({
              titulo: 'Transferências de estoque',
              subtitulo: tenant.name,
              colunas: ['Data', 'De', 'Para', 'Item', 'Qtd', 'Observação'],
              numericas: [4],
              linhas: linhasHistorico,
            })
          }
        />
      }
    >
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <section className="space-y-4 rounded-xl border border-border bg-card p-3 sm:p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Sai de</Label>
              <Button variant="ghost" size="sm" onClick={() => setNovoSetor(true)} className="text-muted-foreground">
                <Plus className="size-3.5" aria-hidden /> Novo setor
              </Button>
            </div>
            {setores(fromId, setFromId, toId)}
          </div>
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFromId(toId)
                setToId(fromId)
              }}
              aria-label="Inverter origem e destino"
            >
              <ArrowDownUp className="size-4" aria-hidden /> Inverter
            </Button>
          </div>
          <div className="space-y-2">
            <Label>Vai para</Label>
            {setores(toId, setToId, fromId)}
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <Label>Itens</Label>
            <ScanBar onCode={onCode} placeholder="Bipe o item" />
            <SearchPicker
              title="Buscar item do estoque"
              placeholder="Digite o nome do item"
              searchPlaceholder="Nome, SKU ou código de barras…"
              items={busca}
              value={null}
              onPick={(p) => {
                const item = porId.get(p.id)
                if (item) incluir(item)
              }}
            />
          </div>

          {linhas.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhum item ainda. Digite o nome ou bipe.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {linhas.map((l) => {
                const item = porId.get(l.itemId)
                const falta = item != null && l.qty > item.qty
                return (
                  <li key={l.itemId} className="flex items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{item?.name ?? 'Item'}</p>
                      <p className={cn('text-xs text-muted-foreground', falta && 'text-destructive')}>
                        saldo total {formatQtd(item?.qty ?? 0)} {item?.unit}
                      </p>
                    </div>
                    <QtyStepper
                      value={l.qty}
                      min={0}
                      label={item?.name ?? 'item'}
                      onChange={(qty) => setLinhas((prev) => prev.map((x) => (x.itemId === l.itemId ? { ...x, qty } : x)))}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 shrink-0"
                      onClick={() => setLinhas((prev) => prev.filter((x) => x.itemId !== l.itemId))}
                      aria-label={`Tirar ${item?.name ?? 'item'}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}

          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observação (opcional)" className="h-9" />
          <Button className="h-10 w-full" onClick={() => void transferir()} disabled={saving || linhas.length === 0}>
            <ArrowLeftRight className="size-4" aria-hidden />
            {saving ? 'Transferindo…' : `Transferir ${linhas.length > 0 ? `${linhas.length} ${linhas.length === 1 ? 'item' : 'itens'}` : ''}`}
          </Button>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Histórico ({transfers.length})</h2>
          {transfers.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title={loading ? 'Carregando…' : 'Nenhuma transferência'} description="As transferências confirmadas aparecem aqui." />
          ) : (
            <ul className="space-y-2">
              {transfers.map((t) => (
                <li key={t.id} className="rounded-xl border border-border bg-card p-3 text-sm">
                  <p className="font-semibold">
                    {t.fromName} → {t.toName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {t.note ? ` · ${t.note}` : ''}
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-xs">
                    {t.items.map((i) => (
                      <li key={i.id} className="flex justify-between gap-2">
                        <span className="truncate">{porId.get(i.itemId)?.name ?? '?'}</span>
                        <span className="shrink-0 tabular-nums">{formatQtd(i.qty)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={novoSetor} onOpenChange={setNovoSetor}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo setor</DialogTitle>
            <DialogDescription>Ex.: Centro Cirúrgico, SPA, Consultório.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={whName}
            onChange={(e) => setWhName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void criarSetor()}
            placeholder="Nome do setor"
            className="h-10"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoSetor(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void criarSetor()} disabled={whName.trim().length < 2}>
              Criar setor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VincularCodigoDialog
        codigo={codigo}
        itens={items}
        onClose={() => setCodigo(null)}
        onVinculado={(item) => {
          setCodigo(null)
          setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))
          incluir(item)
        }}
      />
    </AppLayout>
  )
}
