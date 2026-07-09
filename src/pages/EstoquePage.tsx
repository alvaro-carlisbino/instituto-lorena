import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Boxes, Plus, ArrowDownToLine, ArrowUpFromLine, History, ScanBarcode, ShieldAlert } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  type StockItem,
  type StockMovement,
  listMovements,
  listStockItems,
  registerMovement,
  upsertStockItem,
} from '@/services/estoqueCompras'
import { type BlingCatalogItem, fetchBlingCatalog } from '@/services/crmBling'
import { type StockBatch, listBatchBalances } from '@/services/estoqueKits'
import { useTenant } from '@/context/TenantContext'

/** Abas do módulo. Kits cirúrgicos é só da clínica (o polo de vendas não tem procedimento). */
export function estoqueTabs(isSalesPolo: boolean): Array<{ to: string; label: string }> {
  return [
    { to: '/estoque', label: 'Estoque' },
    { to: '/compras', label: 'Ordens de compra' },
    { to: '/contas-a-pagar', label: 'Contas a pagar' },
    { to: '/inventario', label: 'Inventário' },
    ...(isSalesPolo ? [] : [{ to: '/kits', label: 'Kits cirúrgicos' }]),
    { to: '/estoque-relatorios', label: 'Relatórios' },
  ]
}

const EMPTY_ITEM = { name: '', sku: '', barcode: '', category: '', unit: 'un', minQty: '', controlled: false, blingProductId: '' }

// --------------------------------------------------- leitura de código de barras
// Leitor USB age como teclado (digita o código + Enter no campo "Bipar").
// Pela câmera usamos a BarcodeDetector API (Chrome/Android); sem suporte, o
// botão explica e o campo continua funcionando.

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
}

function getBarcodeDetector(): BarcodeDetectorLike | null {
  const w = window as unknown as {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike
  }
  if (!w.BarcodeDetector) return null
  try {
    return new w.BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'],
    })
  } catch {
    return null
  }
}

function BarcodeCameraDialog({
  open,
  onOpenChange,
  onScan,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScan: (code: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    const detector = getBarcodeDetector()
    if (!detector) {
      setError('Este navegador não lê código pela câmera. Use o leitor USB no campo "Bipar código".')
      return
    }
    let stream: MediaStream | null = null
    let timer: number | null = null
    let done = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          void videoRef.current.play()
        }
        timer = window.setInterval(() => {
          const video = videoRef.current
          if (done || !video || video.readyState < 2) return
          detector
            .detect(video)
            .then((codes) => {
              const code = codes[0]?.rawValue?.trim()
              if (code && !done) {
                done = true
                onScan(code)
              }
            })
            .catch(() => {
              /* frame ruim — tenta o próximo */
            })
        }, 300)
      })
      .catch(() => setError('Não foi possível acessar a câmera.'))
    return () => {
      done = true
      if (timer) window.clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ler código de barras</DialogTitle>
          <DialogDescription>Aponte a câmera para o código do produto.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="py-4 text-sm text-muted-foreground">{error}</p>
        ) : (
          <video ref={videoRef} className="aspect-video w-full rounded-md bg-black" muted playsInline />
        )}
      </DialogContent>
    </Dialog>
  )
}

export function EstoquePage() {
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(false)

  // Bling é a fonte da verdade do estoque de VENDAS (Tricopill) — só leitura aqui.
  const [blingItems, setBlingItems] = useState<BlingCatalogItem[]>([])
  const [blingFetchedAt, setBlingFetchedAt] = useState<string | null>(null)
  const [blingLoading, setBlingLoading] = useState(false)

  const loadBling = async (refresh = false) => {
    if (!isSalesPolo) return
    setBlingLoading(true)
    try {
      const { items: rows, fetchedAt } = await fetchBlingCatalog(refresh)
      setBlingItems(rows)
      setBlingFetchedAt(fetchedAt)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar catálogo do Bling')
    } finally {
      setBlingLoading(false)
    }
  }

  useEffect(() => {
    void loadBling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSalesPolo])
  const [form, setForm] = useState({ ...EMPTY_ITEM })
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  // dialog de movimento (entrada/saída/ajuste)
  const [moveItem, setMoveItem] = useState<StockItem | null>(null)
  const [moveKind, setMoveKind] = useState<'entrada' | 'saida' | 'ajuste'>('entrada')
  const [moveQty, setMoveQty] = useState('')
  const [moveReason, setMoveReason] = useState('')
  const [moveCost, setMoveCost] = useState('')
  const [moving, setMoving] = useState(false)

  // bipar código de barras (leitor USB digita + Enter; câmera via BarcodeDetector)
  const [scanCode, setScanCode] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)

  // dialog de histórico
  const [historyItem, setHistoryItem] = useState<StockItem | null>(null)
  const [historyRows, setHistoryRows] = useState<StockMovement[]>([])

  // Lotes p/ o alerta de validade (vencidos + vencendo em ≤30 dias).
  const [batches, setBatches] = useState<StockBatch[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const [it, bs] = await Promise.all([listStockItems(), listBatchBalances()])
      setItems(it)
      setBatches(bs)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar o estoque')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.category ?? '').toLowerCase().includes(q) ||
        (i.sku ?? '').toLowerCase().includes(q) ||
        (i.barcode ?? '').includes(q),
    )
  }, [items, filter])

  // Código bipado: acha o item (barcode, depois SKU) e abre o movimento; código
  // desconhecido pré-preenche o cadastro de novo item.
  const handleScanned = (raw: string) => {
    const code = raw.trim()
    if (!code) return
    setCameraOpen(false)
    setScanCode('')
    const found = items.find((i) => i.barcode === code) ?? items.find((i) => (i.sku ?? '') === code)
    if (found) {
      openMove(found, 'entrada')
    } else {
      setForm((f) => ({ ...f, barcode: code }))
      toast.info(`Código ${code} não cadastrado — já deixei preenchido no formulário de novo item.`)
    }
  }

  const belowMin = items.filter((i) => i.minQty > 0 && i.qty < i.minQty)

  // Lotes com saldo > 0 vencidos ou vencendo em ≤30 dias (o mais urgente primeiro).
  const expiringBatches = useMemo(() => {
    const today = new Date()
    const in30 = new Date()
    in30.setDate(in30.getDate() + 30)
    const todayYmd = today.toISOString().slice(0, 10)
    const in30Ymd = in30.toISOString().slice(0, 10)
    const nameById = new Map(items.map((i) => [i.id, i.name] as const))
    return batches
      .filter((b) => b.qty > 0 && b.expiresOn && b.expiresOn <= in30Ymd)
      .map((b) => ({ ...b, itemName: nameById.get(b.itemId) ?? '?', expired: b.expiresOn! < todayYmd }))
      .sort((a, b) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? ''))
  }, [batches, items])

  const handleSave = async () => {
    if (form.name.trim().length < 2) {
      toast.error('Informe o nome do item.')
      return
    }
    setSaving(true)
    try {
      await upsertStockItem({
        ...(editId ? { id: editId } : {}),
        name: form.name,
        sku: form.sku || null,
        barcode: form.barcode || null,
        category: form.category || null,
        unit: form.unit,
        minQty: form.minQty.trim() ? Number(form.minQty.replace(',', '.')) : 0,
        controlled: form.controlled,
        blingProductId: form.blingProductId || null,
      })
      toast.success(editId ? `Item "${form.name.trim()}" atualizado.` : `Item "${form.name.trim()}" cadastrado.`)
      setForm({ ...EMPTY_ITEM })
      setEditId(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar item')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (item: StockItem) => {
    setEditId(item.id)
    setForm({
      name: item.name,
      sku: item.sku ?? '',
      barcode: item.barcode ?? '',
      category: item.category ?? '',
      unit: item.unit,
      minQty: item.minQty ? String(item.minQty) : '',
      controlled: item.controlled,
      blingProductId: item.blingProductId ?? '',
    })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => {
    setEditId(null)
    setForm({ ...EMPTY_ITEM })
  }

  const openMove = (item: StockItem, kind: 'entrada' | 'saida') => {
    setMoveItem(item)
    setMoveKind(kind)
    setMoveQty('')
    setMoveReason('')
    setMoveCost('')
  }

  const handleMove = async () => {
    if (!moveItem) return
    const qty = Number(moveQty.replace(',', '.'))
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Informe uma quantidade válida.')
      return
    }
    const costNumber = Number(moveCost.replace(/\./g, '').replace(',', '.'))
    const unitCostCents =
      moveKind === 'entrada' && Number.isFinite(costNumber) && costNumber > 0
        ? Math.round(costNumber * 100)
        : null
    setMoving(true)
    try {
      await registerMovement({ itemId: moveItem.id, kind: moveKind, qty, reason: moveReason, unitCostCents })
      toast.success(`${moveKind === 'saida' ? 'Saída' : 'Entrada'} registrada em ${moveItem.name}.`)
      setMoveItem(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar movimento')
    } finally {
      setMoving(false)
    }
  }

  const openHistory = async (item: StockItem) => {
    setHistoryItem(item)
    setHistoryRows([])
    try {
      setHistoryRows(await listMovements(item.id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar histórico')
    }
  }

  return (
    <AppLayout
      title="Estoque"
      subtitle="Itens e saldos do polo atual — entrada e baixa manuais por enquanto (Shosp/Bling em fase futura)."
    >
      <SubTabs tabs={estoqueTabs(isSalesPolo)} />

      {isSalesPolo ? (
        <Card className="mb-4">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Boxes className="size-4 text-primary" /> Estoque no Bling ({blingItems.length})
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Fonte oficial do estoque de vendas — somente leitura.
                {blingFetchedAt
                  ? ` Atualizado ${new Date(blingFetchedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`
                  : ''}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadBling(true)} disabled={blingLoading}>
              {blingLoading ? 'Atualizando…' : 'Atualizar do Bling'}
            </Button>
          </CardHeader>
          <CardContent>
            {blingItems.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title={blingLoading ? 'Carregando…' : 'Sem itens do Bling'}
                description="Conecte o Bling em Integrações ou clique em “Atualizar do Bling”."
              />
            ) : (
              <div className="max-h-[280px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead className="text-right">Estoque</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blingItems.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.nome}</TableCell>
                        <TableCell className="text-muted-foreground">{b.codigo || '—'}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={b.estoque != null && b.estoque <= 0 ? 'destructive' : 'secondary'}>
                            {b.estoque ?? '—'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {belowMin.length > 0 ? (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm">
          <strong>{belowMin.length} {belowMin.length === 1 ? 'item abaixo' : 'itens abaixo'} do mínimo:</strong>{' '}
          {belowMin.map((i) => `${i.name} (${i.qty}/${i.minQty})`).join(' · ')}
        </div>
      ) : null}

      {expiringBatches.length > 0 ? (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm">
          <strong>
            {expiringBatches.filter((b) => b.expired).length > 0
              ? `${expiringBatches.filter((b) => b.expired).length} ${expiringBatches.filter((b) => b.expired).length === 1 ? 'lote vencido' : 'lotes vencidos'}`
              : `${expiringBatches.length} ${expiringBatches.length === 1 ? 'lote vencendo' : 'lotes vencendo'}`}
            :
          </strong>{' '}
          {expiringBatches
            .map(
              (b) =>
                `${b.itemName} lote ${b.lotCode} (${b.qty}un, ${b.expired ? 'venceu' : 'vence'} ${new Date(`${b.expiresOn}T12:00:00`).toLocaleDateString('pt-BR')})`,
            )
            .join(' · ')}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Plus className="size-4 text-primary" /> {editId ? 'Editar item' : 'Novo item'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="st-name">Nome</Label>
              <Input
                id="st-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ex.: Luva nitrílica M"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="st-cat">Categoria</Label>
                <Input
                  id="st-cat"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="Ex.: Descartáveis"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-sku">Código/SKU</Label>
                <Input
                  id="st-sku"
                  value={form.sku}
                  onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                  placeholder="Opcional"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-barcode" className="flex items-center gap-1.5">
                <ScanBarcode className="size-3.5" /> Código de barras (EAN)
              </Label>
              <Input
                id="st-barcode"
                value={form.barcode}
                onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                placeholder="Bipe com o leitor ou digite — a NF-e preenche sozinha"
                inputMode="numeric"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Unidade</Label>
                <Select value={form.unit} onValueChange={(v) => setForm((f) => ({ ...f, unit: v ?? 'un' }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['un', 'cx', 'pct', 'ml', 'g', 'kg', 'frasco', 'ampola'].map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-min">Estoque mínimo</Label>
                <Input
                  id="st-min"
                  value={form.minQty}
                  onChange={(e) => setForm((f) => ({ ...f, minQty: e.target.value }))}
                  placeholder="0"
                  inputMode="decimal"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.controlled}
                onChange={(e) => setForm((f) => ({ ...f, controlled: e.target.checked }))}
                className="size-4 accent-amber-500"
              />
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="size-3.5 text-amber-500" /> Substância controlada
              </span>
            </label>
            {isSalesPolo ? (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Boxes className="size-3.5" /> Produto no Bling (vínculo)
                </Label>
                <Select
                  value={form.blingProductId || '__none__'}
                  onValueChange={(v) => setForm((f) => ({ ...f, blingProductId: v === '__none__' ? '' : (v ?? '') }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sem vínculo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— sem vínculo —</SelectItem>
                    {blingItems.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Vinculado, a entrada por NF-e/compra também dá entrada no Bling (saldo que vende).
                </p>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleSave} disabled={saving}>
                {saving ? 'Salvando…' : editId ? 'Salvar alterações' : 'Cadastrar item'}
              </Button>
              {editId ? (
                <Button variant="outline" onClick={cancelEdit} disabled={saving}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Boxes className="size-4 text-primary" /> Itens ({items.length})
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1">
                <Input
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleScanned(scanCode)
                    }
                  }}
                  placeholder="Bipar código…"
                  className="h-8 w-[150px]"
                  inputMode="numeric"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2"
                  onClick={() => setCameraOpen(true)}
                  title="Ler pela câmera"
                >
                  <ScanBarcode className="size-4" />
                </Button>
              </div>
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Buscar item…"
                className="h-8 w-[160px]"
              />
            </div>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title={loading ? 'Carregando…' : 'Nenhum item cadastrado'}
                description="Cadastre os itens da clínica ao lado e registre entradas para começar o controle."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((item) => {
                      const low = item.minQty > 0 && item.qty < item.minQty
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="flex items-center gap-1.5 font-medium">
                              {item.name}
                              {item.controlled ? <ShieldAlert className="size-3.5 text-amber-500" /> : null}
                            </div>
                            {item.sku || item.barcode ? (
                              <div className="text-xs text-muted-foreground">
                                {[item.sku, item.barcode].filter(Boolean).join(' · ')}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{item.category ?? '—'}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={low ? 'destructive' : 'secondary'}>
                              {item.qty} {item.unit}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" onClick={() => openMove(item, 'entrada')}>
                                <ArrowDownToLine className="size-3.5" /> Entrada
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openMove(item, 'saida')}>
                                <ArrowUpFromLine className="size-3.5" /> Saída
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => void openHistory(item)}>
                                <History className="size-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => openEdit(item)}>
                                Editar
                              </Button>
                            </div>
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

      <Dialog open={moveItem != null} onOpenChange={(open) => (!open ? setMoveItem(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Movimentar {moveItem?.name}</DialogTitle>
            <DialogDescription>
              Saldo atual: {moveItem?.qty} {moveItem?.unit}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={moveKind} onValueChange={(v) => setMoveKind((v ?? 'entrada') as typeof moveKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="saida">Saída</SelectItem>
                  <SelectItem value="ajuste">Ajuste (+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mv-qty">Quantidade</Label>
              <Input
                id="mv-qty"
                value={moveQty}
                onChange={(e) => setMoveQty(e.target.value)}
                inputMode="decimal"
                placeholder="Ex.: 10"
              />
            </div>
            {moveKind === 'entrada' ? (
              <div className="space-y-1.5">
                <Label htmlFor="mv-cost">Custo unitário (R$)</Label>
                <Input
                  id="mv-cost"
                  value={moveCost}
                  onChange={(e) => setMoveCost(e.target.value)}
                  inputMode="decimal"
                  placeholder="Opcional — alimenta o custo por cirurgia"
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="mv-reason">Motivo</Label>
              <Input
                id="mv-reason"
                value={moveReason}
                onChange={(e) => setMoveReason(e.target.value)}
                placeholder="Ex.: uso em procedimento, compra avulsa…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleMove} disabled={moving}>
              {moving ? 'Registrando…' : 'Registrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BarcodeCameraDialog open={cameraOpen} onOpenChange={setCameraOpen} onScan={handleScanned} />

      <Dialog open={historyItem != null} onOpenChange={(open) => (!open ? setHistoryItem(null) : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Histórico — {historyItem?.name}</DialogTitle>
            <DialogDescription>Últimos {historyRows.length} movimentos.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto text-sm">
            {historyRows.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground">Sem movimentos registrados.</p>
            ) : (
              historyRows.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <div>
                    <span className={m.qtyDelta < 0 ? 'font-semibold text-red-500' : 'font-semibold text-emerald-600'}>
                      {m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}
                    </span>{' '}
                    <span className="text-muted-foreground">{m.reason ?? m.kind}</span>
                    {m.note ? <div className="text-xs text-muted-foreground">{m.note}</div> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(m.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
