import { diaLocal } from '@/lib/diaLocal'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Boxes, Plus, ArrowDownToLine, ArrowUpFromLine, History, MoreHorizontal, Pencil, ScanBarcode, ShieldAlert } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
  listStockItems,
  registerMovement,
  upsertStockItem,
} from '@/services/estoqueCompras'
import { type StockWarehouse, listWarehouseBalances, listWarehouses } from '@/services/estoqueArmazens'
import {
  type EnderecoEstoque,
  baixarEstoque,
  compararCodigoEndereco,
  listarEnderecos,
  listarItensNosEnderecos,
} from '@/services/estoqueRastreio'
import { normalizarBusca } from '@/lib/busca'
import { formatQtd } from '@/components/kits/kitUi'
import { type BlingCatalogItem, fetchBlingCatalog } from '@/services/crmBling'
import { type StockBatch, listBatchBalances } from '@/services/estoqueKits'
import { BarcodeCameraDialog } from '@/components/estoque/BarcodeCameraDialog'
import { useTenant } from '@/context/TenantContext'

/* As telas de estoque, kits, CME e compras não têm mais barra de abas (24/09/2026): cada uma é
 * um item do menu lateral, nos grupos Kits, CME, Estoque e Compras (config/navigation.ts). */
/* A navegação do financeiro mora em `components/page/FinanceTabs.tsx`, em dois níveis.
 * Ficava aqui, numa régua plana de 14 abas — e uma tela de ESTOQUE ser a dona do menu do
 * FINANCEIRO era metade do motivo de ninguém achar nada. */

const EMPTY_ITEM = { name: '', sku: '', barcode: '', category: '', unit: 'un', minQty: '', controlled: false, blingProductId: '', custoRef: '' }

const centavosDoCampo = (v: string): number | null => {
  const n = Number(v.trim().replace(/\./g, '').replace(',', '.'))
  return v.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}
const campoDosCentavos = (c: number | null | undefined) => (c != null && c > 0 ? (c / 100).toFixed(2).replace('.', ',') : '')

export function EstoquePage() {
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
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
  // O item inteiro: salvar precisa devolver observação e ativo como estavam (o upsert zera o que não recebe).
  const [editando, setEditando] = useState<StockItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('')

  // dialog de movimento (entrada/saída/ajuste)
  const [moveItem, setMoveItem] = useState<StockItem | null>(null)
  const [moveKind, setMoveKind] = useState<'entrada' | 'saida' | 'ajuste'>('entrada')
  const [moveQty, setMoveQty] = useState('')
  const [moveReason, setMoveReason] = useState('')
  const [moveCost, setMoveCost] = useState('')
  const [moveSetor, setMoveSetor] = useState<string | null>(null)
  const [movePaciente, setMovePaciente] = useState('')
  const [moving, setMoving] = useState(false)

  // Setores: saldo por setor e o filtro da lista. Nulo = soma de todos.
  const [setores, setSetores] = useState<StockWarehouse[]>([])
  const [setorFiltro, setSetorFiltro] = useState<string | null>(null)
  const [saldoNoSetor, setSaldoNoSetor] = useState<Map<string, number>>(new Map())
  // "Onde fica": códigos de endereço por item, já com o nome do setor.
  const [enderecosDoItem, setEnderecosDoItem] = useState<Map<string, Array<EnderecoEstoque & { setorNome: string }>>>(new Map())

  // bipar código de barras (leitor USB digita + Enter; câmera via BarcodeDetector)
  const [scanCode, setScanCode] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)

  // Lotes p/ o alerta de validade (vencidos + vencendo em ≤30 dias).
  const [batches, setBatches] = useState<StockBatch[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const [it, bs, whs, saldos, ends, guardados] = await Promise.all([
        listStockItems(),
        listBatchBalances(),
        listWarehouses(),
        listWarehouseBalances(),
        listarEnderecos(),
        listarItensNosEnderecos(),
      ])
      setItems(it)
      setBatches(bs)
      setSetores(whs)
      const porSetorItem = new Map<string, number>()
      for (const b of saldos) porSetorItem.set(`${b.warehouseId}:${b.itemId}`, b.qty)
      setSaldoNoSetor(porSetorItem)
      const nomeSetor = new Map(whs.map((w) => [w.id, w.name] as const))
      const endPorId = new Map(ends.map((e) => [e.id, e] as const))
      const porItem = new Map<string, Array<EnderecoEstoque & { setorNome: string }>>()
      for (const g of guardados) {
        const e = endPorId.get(g.enderecoId)
        if (!e) continue
        const lista = porItem.get(g.itemId) ?? []
        lista.push({ ...e, setorNome: nomeSetor.get(e.setorId) ?? '' })
        porItem.set(g.itemId, lista)
      }
      for (const lista of porItem.values()) lista.sort((a, b) => compararCodigoEndereco(a.codigo, b.codigo))
      setEnderecosDoItem(porItem)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar o estoque')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const qtdNaLista = (i: StockItem) => (setorFiltro ? (saldoNoSetor.get(`${setorFiltro}:${i.id}`) ?? 0) : i.qty)

  // A busca acha também pelo LOTE e pelo ENDEREÇO: quem está com a caixa na mão lê o lote,
  // quem está na prateleira lê o código dela.
  const lotesPorItem = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const b of batches) {
      if (!b.lotCode) continue
      const lista = m.get(b.itemId) ?? []
      lista.push(b.lotCode)
      m.set(b.itemId, lista)
    }
    return m
  }, [batches])

  const filtered = useMemo(() => {
    const termos = normalizarBusca(filter).split(/\s+/).filter(Boolean)
    return items.filter((i) => {
      if (setorFiltro) {
        const noSetor = saldoNoSetor.get(`${setorFiltro}:${i.id}`) ?? 0
        const guardadoAli = (enderecosDoItem.get(i.id) ?? []).some((e) => e.setorId === setorFiltro)
        if (noSetor === 0 && !guardadoAli) return false
      }
      if (termos.length === 0) return true
      const texto = normalizarBusca(
        [
          i.name,
          i.category,
          i.sku,
          i.barcode,
          ...i.aliases,
          ...(lotesPorItem.get(i.id) ?? []),
          ...(enderecosDoItem.get(i.id) ?? []).map((e) => e.codigo),
        ]
          .filter(Boolean)
          .join(' '),
      )
      return termos.every((t) => texto.includes(t))
    })
  }, [items, filter, setorFiltro, saldoNoSetor, enderecosDoItem, lotesPorItem])


  // Código bipado: acha o item (barcode, depois SKU) e abre o movimento; código
  // desconhecido pré-preenche o cadastro de novo item.
  const handleScanned = (raw: string) => {
    const code = raw.trim()
    if (!code) return
    setCameraOpen(false)
    setScanCode('')
    const found = acharItemPorCodigo(items, code)
    if (found) {
      openMove(found, 'entrada')
    } else {
      setForm((f) => ({ ...f, barcode: code }))
      toast.info(`Código ${code} não cadastrado, já deixei preenchido no formulário de novo item.`)
    }
  }

  // As unidades que o estoque usa de verdade (UN, CX, FR, AMP...). A lista fixa era minúscula
  // ("un", "cx") e o item gravado como "UN" abria a edição com o campo vazio.
  const unidades = useMemo(() => {
    const vistas = new Map<string, string>()
    for (const u of ['UN', 'CX', 'PCT', 'FR', 'AMP', 'ML', 'L', 'G', 'KG', 'RL', 'PAR', ...items.map((i) => i.unit)]) {
      const chave = (u ?? '').trim().toUpperCase()
      if (chave && !vistas.has(chave)) vistas.set(chave, (u ?? '').trim())
    }
    if (form.unit && !vistas.has(form.unit.trim().toUpperCase())) vistas.set(form.unit.trim().toUpperCase(), form.unit)
    return [...vistas.values()]
  }, [items, form.unit])

  const belowMin = items.filter((i) => i.minQty > 0 && i.qty < i.minQty)

  // Cadastro pela metade = módulo NO AR e MORTO. Item sem mínimo nunca dispara o alerta de
  // estoque baixo (o cron roda todo dia, varre e não acha nada); item sem código de barras
  // não pode ser bipado; item sem saldo nunca teve carga inicial. Na clínica isso passou
  // batido: 110 itens cadastrados, 0 com mínimo, e o alerta diário gerou zero notificação
  // desde que existe. O painel precisa DIZER isso, senão o silêncio parece "está tudo bem".
  const semMinimo = items.filter((i) => !i.minQty || i.minQty <= 0)
  const semCodigoBarras = items.filter((i) => !i.barcode)
  const semSaldo = items.filter((i) => i.qty <= 0)
  const cadastroIncompleto = items.length > 0 && semMinimo.length > 0

  // Lotes com saldo > 0 vencidos ou vencendo em ≤30 dias (o mais urgente primeiro).
  const expiringBatches = useMemo(() => {
    const today = new Date()
    const in30 = new Date()
    in30.setDate(in30.getDate() + 30)
    const todayYmd = diaLocal(today)
    const in30Ymd = diaLocal(in30)
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
    const custoRef = centavosDoCampo(form.custoRef)
    if (form.custoRef.trim() && custoRef == null) {
      toast.error('Custo de referência inválido. Use por exemplo 12,50.')
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
        ...(custoRef !== (editando?.referenceCostCents ?? null) ? { referenceCostCents: custoRef } : {}),
        // Sem isso, editar o nome apagava a observação do item e reativava item desativado.
        ...(editando ? { note: editando.note, active: editando.active } : {}),
      })
      toast.success(editId ? `Item "${form.name.trim()}" atualizado.` : `Item "${form.name.trim()}" cadastrado.`)
      setForm({ ...EMPTY_ITEM })
      setEditId(null)
      setEditando(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar item')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (item: StockItem) => {
    setEditId(item.id)
    setEditando(item)
    setForm({
      name: item.name,
      sku: item.sku ?? '',
      barcode: item.barcode ?? '',
      category: item.category ?? '',
      unit: item.unit,
      minQty: item.minQty ? String(item.minQty) : '',
      controlled: item.controlled,
      blingProductId: item.blingProductId ?? '',
      custoRef: campoDosCentavos(item.referenceCostCents),
    })
  }

  const cancelEdit = () => {
    setEditId(null)
    setEditando(null)
    setForm({ ...EMPTY_ITEM })
  }

  const setorPadrao = setores.find((w) => w.isDefault)?.id ?? setores[0]?.id ?? null

  const openMove = (item: StockItem, kind: 'entrada' | 'saida') => {
    setMoveItem(item)
    setMoveKind(kind)
    setMoveQty('')
    setMoveReason('')
    setMoveCost('')
    setMovePaciente('')
    setMoveSetor(setorFiltro ?? setorPadrao)
  }

  // Links da ficha do item: /estoque?item=<id>&acao=entrada|saida|editar abre direto o que foi pedido.
  useEffect(() => {
    const alvo = params.get('item')
    const acao = params.get('acao')
    if (!alvo || !acao || items.length === 0) return
    const item = items.find((i) => i.id === alvo)
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('item')
        next.delete('acao')
        return next
      },
      { replace: true },
    )
    if (!item) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (acao === 'editar') openEdit(item)
    else if (acao === 'entrada' || acao === 'saida') openMove(item, acao)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, params])

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
    if (moveKind === 'saida' && moveItem.controlled && movePaciente.trim().length < 3) {
      toast.error('Saída de item controlado precisa do nome do paciente (livro de controlados).')
      return
    }
    setMoving(true)
    try {
      if (moveKind === 'saida') {
        // Pelo banco: sai por lote (vence antes sai antes) no setor escolhido, com custo do lote.
        await baixarEstoque({
          setorId: moveSetor,
          itens: [{ itemId: moveItem.id, qty }],
          motivo: moveReason,
          paciente: movePaciente,
          origem: 'manual',
        })
      } else {
        await registerMovement({ itemId: moveItem.id, kind: moveKind, qty, reason: moveReason, unitCostCents, warehouseId: moveSetor })
      }
      toast.success(`${moveKind === 'saida' ? 'Saída' : 'Entrada'} registrada em ${moveItem.name}.`)
      setMoveItem(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar movimento')
    } finally {
      setMoving(false)
    }
  }

  const abrirFicha = (item: StockItem) => navigate(`/estoque/item/${item.id}`)

  const camposDoItem = (
    <>
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
                placeholder="Bipe com o leitor ou digite, a NF-e preenche sozinha"
                inputMode="numeric"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="st-unit">Unidade</Label>
                <Select value={form.unit} onValueChange={(v) => setForm((f) => ({ ...f, unit: v ?? 'un' }))}>
                  <SelectTrigger id="st-unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {unidades.map((u) => (
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
            <div className="space-y-1.5">
              <Label htmlFor="st-custo-ref">Custo de referência (R$ por {form.unit || 'unidade'})</Label>
              <Input
                id="st-custo-ref"
                value={form.custoRef}
                onChange={(e) => setForm((f) => ({ ...f, custoRef: e.target.value }))}
                placeholder="Só para item sem nota, ex.: 12,50"
                inputMode="decimal"
              />
              <p className="text-[11px] text-muted-foreground">
                Entra no valor do estoque e na conta do paciente até chegar compra por nota.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="st-controlled"
                checked={form.controlled}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, controlled: checked }))}
              />
              <Label htmlFor="st-controlled" className="gap-1.5 font-normal">
                <ShieldAlert className="size-3.5 text-amber-500" aria-hidden /> Substância controlada
              </Label>
            </div>
            {isSalesPolo ? (
              <div className="space-y-1.5">
                <Label htmlFor="st-bling" className="flex items-center gap-1.5">
                  <Boxes className="size-3.5" aria-hidden /> Produto no Bling (vínculo)
                </Label>
                <Select
                  value={form.blingProductId || '__none__'}
                  onValueChange={(v) => setForm((f) => ({ ...f, blingProductId: v === '__none__' ? '' : (v ?? '') }))}
                >
                  <SelectTrigger id="st-bling">
                    <SelectValue placeholder="Sem vínculo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem vínculo</SelectItem>
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
    </>
  )

  return (
    <AppLayout
      title="Estoque"
      subtitle="Itens e saldos por setor. Clique no item para ver de qual nota veio, os lotes, onde fica e todo o histórico."
    >

      {isSalesPolo ? (
        <Card className="mb-4">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Boxes className="size-4 text-primary" /> Estoque no Bling ({blingItems.length})
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Fonte oficial do estoque de vendas, somente leitura.
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

      {cadastroIncompleto ? (
        <div className="mb-4 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3">
          <div className="text-xs font-bold uppercase tracking-wide text-sky-700">Cadastro incompleto</div>
          <div className="mt-1 text-sm text-sky-900/90">
            <strong className="tabular-nums">{semMinimo.length}</strong> de {items.length}{' '}
            {items.length === 1 ? 'item está' : 'itens estão'} sem estoque mínimo definido, então o alerta
            diário de estoque baixo <strong>não vai avisar</strong> sobre {items.length === 1 ? 'ele' : 'eles'}.
            {semCodigoBarras.length > 0 ? (
              <>
                {' '}
                <strong className="tabular-nums">{semCodigoBarras.length}</strong> sem código de barras (o leitor
                não bipa).
              </>
            ) : null}
            {semSaldo.length > 0 ? (
              <>
                {' '}
                <strong className="tabular-nums">{semSaldo.length}</strong> sem saldo (falta a carga inicial).
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {belowMin.length > 0 || expiringBatches.length > 0 ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wide text-amber-700">Estoque baixo</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{belowMin.length}</div>
            <div className="mt-1 line-clamp-3 text-sm text-amber-900/80">
              {belowMin.length === 0
                ? 'Nenhum item abaixo do mínimo.'
                : belowMin.map((i) => `${i.name} (${i.qty}/${i.minQty})`).join(' · ')}
            </div>
          </div>
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wide text-red-700">Validade</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {expiringBatches.filter((b) => b.expired).length}
              <span className="ml-1 text-sm font-semibold text-red-700/70">
                vencidos · {expiringBatches.length} em 30d
              </span>
            </div>
            <div className="mt-1 line-clamp-3 text-sm text-red-900/80">
              {expiringBatches.length === 0
                ? 'Nenhum lote vencendo nos próximos 30 dias.'
                : expiringBatches
                    .map(
                      (b) =>
                        `${b.itemName} lote ${b.lotCode} (${b.expired ? 'venceu' : 'vence'} ${new Date(`${b.expiresOn}T12:00:00`).toLocaleDateString('pt-BR')})`,
                    )
                    .join(' · ')}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Plus className="size-4 text-primary" /> Novo item
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {editId ? (
              <p className="text-sm text-muted-foreground">Editando “{form.name}” na janela aberta.</p>
            ) : (
              camposDoItem
            )}
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
                  aria-label="Bipar código de barras"
                  className="h-8 w-[150px]"
                  inputMode="numeric"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setCameraOpen(true)}
                  title="Ler pela câmera"
                  aria-label="Ler pela câmera"
                >
                  <ScanBarcode className="size-4" aria-hidden />
                </Button>
              </div>
              <Select value={setorFiltro ?? 'todos'} onValueChange={(v) => setSetorFiltro(!v || v === 'todos' ? null : v)}>
                <SelectTrigger aria-label="Setor" className="h-8 w-[150px]">
                  <span className="truncate text-sm">
                    {setorFiltro ? (setores.find((w) => w.id === setorFiltro)?.name ?? 'Setor') : 'Todos os setores'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os setores</SelectItem>
                  {setores.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Item, código, lote ou endereço"
                aria-label="Buscar item por nome, código, lote ou endereço"
                className="h-8 w-[200px]"
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
                {/* table-fixed: sem ele a largura por coluna é só sugestão e o navegador
                    reparte pelo conteúdo — medido, a mesma tabela vai de 37px para 57px
                    por linha e estoura 1219px num contêiner de 960px. */}
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      {/* Nome de item tem mediana de 38 e máximo de 120 caracteres nos
                          dados reais: sem teto ele empurrava as outras três colunas e
                          quebrava em três linhas. Categoria e saldo são curtos e fixos. */}
                      <TableHead>Item</TableHead>
                      <TableHead className="w-[10rem]">Categoria</TableHead>
                      <TableHead className="w-[7rem] text-right">Saldo</TableHead>
                      <TableHead className="w-[3.5rem] text-right"><span className="sr-only">Ações</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((item) => {
                      const low = item.minQty > 0 && item.qty < item.minQty
                      const onde = (enderecosDoItem.get(item.id) ?? []).filter((e) => !setorFiltro || e.setorId === setorFiltro)
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="flex min-w-0 items-center gap-1.5 font-medium">
                              <Link to={`/estoque/item/${item.id}`} className="truncate text-left hover:underline" title={`Ficha de ${item.name}: notas, lotes e histórico`}>
                                {item.name}
                              </Link>
                              {item.controlled ? <ShieldAlert className="size-3.5 shrink-0 text-amber-500" /> : null}
                            </div>
                            {item.sku || item.barcode || onde.length > 0 ? (
                              <div className="truncate text-xs tabular-nums text-muted-foreground">
                                {[
                                  ...onde.map((e) => (setores.length > 1 && !setorFiltro ? `${e.setorNome} ${e.codigo}` : e.codigo)),
                                  item.sku,
                                  item.barcode,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{item.category ?? '—'}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={low ? 'destructive' : 'secondary'} title={setorFiltro ? `Total em todos os setores: ${formatQtd(item.qty)}` : undefined}>
                              {formatQtd(qtdNaLista(item))} {item.unit}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'ml-auto')}
                                aria-label={`Ações de ${item.name}`}
                              >
                                <MoreHorizontal className="size-4" aria-hidden />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="min-w-40">
                                <DropdownMenuItem onClick={() => abrirFicha(item)}>
                                  <History className="size-4" aria-hidden /> Ficha e histórico
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openEdit(item)}>
                                  <Pencil className="size-4" aria-hidden /> Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openMove(item, 'entrada')}>
                                  <ArrowDownToLine className="size-4" aria-hidden /> Entrada
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openMove(item, 'saida')}>
                                  <ArrowUpFromLine className="size-4" aria-hidden /> Saída
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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

      <Dialog open={editId != null} onOpenChange={(open) => (!open && !saving ? cancelEdit() : null)}>
        <DialogContent className="sm:max-w-md max-sm:max-h-dvh">
          <DialogHeader>
            <DialogTitle>Editar item</DialogTitle>
            <DialogDescription>{editando?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">{camposDoItem}</div>
        </DialogContent>
      </Dialog>

      <Dialog open={moveItem != null} onOpenChange={(open) => (!open ? setMoveItem(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Movimentar {moveItem?.name}</DialogTitle>
            <DialogDescription>
              Saldo total: {formatQtd(moveItem?.qty ?? 0)} {moveItem?.unit}
              {moveItem && moveSetor && setores.length > 1
                ? ` · em ${setores.find((w) => w.id === moveSetor)?.name ?? 'setor'}: ${formatQtd(saldoNoSetor.get(`${moveSetor}:${moveItem.id}`) ?? 0)}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mv-kind">Tipo</Label>
              <Select value={moveKind} onValueChange={(v) => setMoveKind((v ?? 'entrada') as typeof moveKind)}>
                <SelectTrigger id="mv-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="saida">Saída</SelectItem>
                  <SelectItem value="ajuste">Ajuste (+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {setores.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="mv-setor">{moveKind === 'saida' ? 'Sai de' : 'Entra em'}</Label>
                <Select value={moveSetor ?? ''} onValueChange={(v) => setMoveSetor(v || null)}>
                  <SelectTrigger id="mv-setor">
                    <span className="truncate text-sm">{setores.find((w) => w.id === moveSetor)?.name ?? 'Escolha o setor'}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {setores.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
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
                  placeholder="Opcional, alimenta o custo por cirurgia"
                />
              </div>
            ) : null}
            {moveKind === 'saida' && moveItem?.controlled ? (
              <div className="space-y-1.5">
                <Label htmlFor="mv-paciente">Paciente (item controlado)</Label>
                <Input
                  id="mv-paciente"
                  value={movePaciente}
                  onChange={(e) => setMovePaciente(e.target.value)}
                  placeholder="Nome do paciente para o livro de controlados"
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

    </AppLayout>
  )
}
