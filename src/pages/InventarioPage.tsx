import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Ban, Check, ClipboardCheck, ListChecks, Plus } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchField } from '@/components/ui/search-field'
import { SearchPicker } from '@/components/ui/search-picker'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScanBar } from '@/components/estoque/ScanBar'
import { formatQtd, produtosParaBusca } from '@/components/kits/kitUi'
import { estoqueTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { beep } from '@/lib/beep'
import { normalizarBusca } from '@/lib/busca'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { cn } from '@/lib/utils'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import { type StockWarehouse, listWarehouses } from '@/services/estoqueArmazens'
import {
  type StockCount,
  cancelCount,
  finalizeCount,
  incluirNaContagem,
  listCounts,
  openCount,
  setCountedQty,
} from '@/services/estoqueInventario'

type Recorte = 'todos' | 'sem_contar' | 'diferenca'

export function InventarioPage() {
  const { tenant } = useTenant()
  const [counts, setCounts] = useState<StockCount[]>([])
  const [items, setItems] = useState<StockItem[]>([])
  const [setores, setSetores] = useState<StockWarehouse[]>([])
  const [loading, setLoading] = useState(false)
  const [label, setLabel] = useState('')
  const [setorNovo, setSetorNovo] = useState<string | null>(null)
  const [todosOsItens, setTodosOsItens] = useState(false)
  const [opening, setOpening] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busca, setBusca] = useState('')
  const [recorte, setRecorte] = useState<Recorte>('todos')
  const [confirmarFinalizar, setConfirmarFinalizar] = useState(false)
  const [confirmarCancelar, setConfirmarCancelar] = useState(false)
  const [finalizando, setFinalizando] = useState(false)
  const inputs = useRef(new Map<string, HTMLInputElement>())

  const itemPorId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const setorPorId = useMemo(() => new Map(setores.map((w) => [w.id, w] as const)), [setores])
  const ativos = useMemo(() => items.filter((i) => i.active), [items])
  const padrao = setores.find((w) => w.isDefault) ?? setores[0] ?? null

  const load = async () => {
    setLoading(true)
    try {
      const [c, it, whs] = await Promise.all([listCounts(), listStockItems(true), listWarehouses()])
      setCounts(c)
      setItems(it)
      setSetores(whs)
      setSetorNovo((atual) => atual ?? whs.find((w) => w.isDefault)?.id ?? whs[0]?.id ?? null)
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
  const setorDaContagem = (c: StockCount) => (c.warehouseId ? setorPorId.get(c.warehouseId)?.name : padrao?.name) ?? 'Setor'

  const linhasVisiveis = useMemo(() => {
    if (!active) return []
    const termos = normalizarBusca(busca).split(/\s+/).filter(Boolean)
    return active.items
      .filter((ci) => {
        if (recorte === 'sem_contar' && ci.countedQty != null) return false
        if (recorte === 'diferenca' && (ci.countedQty == null || ci.countedQty === ci.systemQty)) return false
        if (termos.length === 0) return true
        const it = itemPorId.get(ci.itemId)
        const texto = normalizarBusca([it?.name, it?.barcode, it?.sku, ...(it?.aliases ?? [])].filter(Boolean).join(' '))
        return termos.every((t) => texto.includes(t))
      })
      .sort((a, b) => (itemPorId.get(a.itemId)?.name ?? '').localeCompare(itemPorId.get(b.itemId)?.name ?? '', 'pt-BR'))
  }, [active, busca, recorte, itemPorId])

  const handleOpen = async () => {
    if (items.length === 0) {
      toast.error('Cadastre itens no estoque antes de abrir uma contagem.')
      return
    }
    setOpening(true)
    try {
      const nomeSetor = setorNovo ? setorPorId.get(setorNovo)?.name : null
      const id = await openCount(
        label || `Contagem ${nomeSetor ? `${nomeSetor} ` : ''}${new Date().toLocaleDateString('pt-BR')}`,
        setorNovo,
        todosOsItens,
      )
      toast.success('Contagem aberta com o saldo atual do setor.')
      setLabel('')
      setActiveId(id)
      setDrafts({})
      setBusca('')
      setRecorte('todos')
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
    if (value != null && !Number.isFinite(value)) {
      toast.error('Quantidade inválida.')
      return
    }
    const atual = active?.items.find((ci) => ci.id === countItemId)?.countedQty ?? null
    if (atual === value) return
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

  /** Bipou ou escolheu um item: se está na contagem, vai para o campo dele; se não está, inclui. */
  const irParaItem = async (item: StockItem) => {
    if (!active || active.status !== 'aberta') return
    const linha = active.items.find((ci) => ci.itemId === item.id)
    if (linha) {
      beep(true)
      setBusca('')
      setRecorte('todos')
      window.setTimeout(() => {
        const el = inputs.current.get(linha.id)
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el?.focus()
        el?.select()
      }, 60)
      return
    }
    try {
      const novaLinha = await incluirNaContagem(active.id, item.id)
      beep(true)
      toast.success(`${item.name} incluído na contagem.`)
      const c = await listCounts()
      setCounts(c)
      setBusca('')
      setRecorte('todos')
      window.setTimeout(() => {
        inputs.current.get(novaLinha)?.focus()
      }, 120)
    } catch (e) {
      beep(false)
      toast.error(e instanceof Error ? e.message : 'Falha ao incluir item')
    }
  }

  const onCode = (code: string) => {
    const item = acharItemPorCodigo(ativos, code)
    if (!item) {
      beep(false)
      toast.error(`Código ${code} não está cadastrado. Vincule o código ao item pela tela de Bipagem ou Códigos de barras.`)
      return
    }
    void irParaItem(item)
  }

  const contados = active ? active.items.filter((ci) => ci.countedQty != null) : []
  const comDiferenca = contados.filter((ci) => ci.countedQty !== ci.systemQty)
  const pending = active ? active.items.length - contados.length : 0

  const handleFinalize = async () => {
    if (!active) return
    setFinalizando(true)
    try {
      const { adjusted } = await finalizeCount(active)
      toast.success(
        adjusted === 0
          ? 'Contagem finalizada, sem divergências.'
          : `Contagem finalizada: ${adjusted} ${adjusted === 1 ? 'item ajustado' : 'itens ajustados'} no estoque.`,
      )
      setConfirmarFinalizar(false)
      setActiveId(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao finalizar contagem')
    } finally {
      setFinalizando(false)
    }
  }

  const handleCancel = async () => {
    if (!active) return
    try {
      await cancelCount(active.id)
      setConfirmarCancelar(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cancelar contagem')
    }
  }

  return (
    <AppLayout
      title="Inventário"
      subtitle="Contagem física por setor: a diferença vira ajuste no saldo, e a falta sai dos lotes que vencem antes."
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
              {setores.length > 1 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="inv-setor">Setor contado</Label>
                  <Select value={setorNovo ?? ''} onValueChange={(v) => setSetorNovo(v || null)}>
                    <SelectTrigger id="inv-setor" className="w-full">
                      <span className="truncate text-sm">{setorNovo ? setorPorId.get(setorNovo)?.name : 'Escolha o setor'}</span>
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
                <Label htmlFor="inv-label">Nome/referência</Label>
                <Input
                  id="inv-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex.: Inventário mensal setembro"
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={todosOsItens} onCheckedChange={(v) => setTodosOsItens(Boolean(v))} className="mt-0.5" />
                <span>
                  Listar todos os itens ativos
                  <span className="block text-xs text-muted-foreground">
                    Sem marcar, a lista traz só o que o sistema diz estar no setor. Item achado na prateleira se inclui bipando.
                  </span>
                </span>
              </label>
              <Button className="w-full" onClick={() => void handleOpen()} disabled={opening}>
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
                  <Button
                    key={c.id}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setActiveId(c.id)
                      setBusca('')
                      setRecorte('todos')
                    }}
                    className={cn(
                      'h-auto w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm font-normal whitespace-normal',
                      c.id === activeId ? 'border-primary bg-primary/5 hover:bg-primary/10' : 'border-border hover:bg-muted/50',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{c.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(c.createdAt).toLocaleDateString('pt-BR')} · {setorDaContagem(c)}
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
                  </Button>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ClipboardCheck className="size-4 text-primary" />
                {active ? active.label : 'Contagem'}
              </CardTitle>
              {active ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {setorDaContagem(active)} · {contados.length} de {active.items.length} contados · {comDiferenca.length} com diferença
                </p>
              ) : null}
            </div>
            {active && active.status === 'aberta' ? (
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => setConfirmarFinalizar(true)} disabled={contados.length === 0}>
                  <Check className="size-3.5" /> Finalizar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmarCancelar(true)}>
                  <Ban className="size-3.5" /> Cancelar
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {!active ? (
              <EmptyState
                icon={ClipboardCheck}
                title={loading ? 'Carregando…' : 'Selecione ou abra uma contagem'}
                description="Cada contagem lista os itens com o saldo do sistema no setor para você conferir com o físico."
              />
            ) : (
              <>
                {active.status === 'aberta' ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ScanBar onCode={onCode} placeholder="Bipe o item para achar ou incluir" />
                    <div className="min-w-0">
                      <SearchPicker
                        title="Incluir ou achar item"
                        placeholder="Achar ou incluir item"
                        searchPlaceholder="Nome, SKU ou código de barras…"
                        items={produtosParaBusca(ativos)}
                        value={null}
                        onPick={(p) => {
                          const item = itemPorId.get(p.id)
                          if (item) void irParaItem(item)
                        }}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <SearchField
                    value={busca}
                    onChange={setBusca}
                    label="Filtrar itens da contagem"
                    resultados={linhasVisiveis.length}
                    className="min-w-0 flex-1"
                  />
                  <div className="flex gap-1">
                    {(
                      [
                        ['todos', 'Todos'],
                        ['sem_contar', `Sem contar (${pending})`],
                        ['diferenca', `Diferença (${comDiferenca.length})`],
                      ] as Array<[Recorte, string]>
                    ).map(([valor, rotulo]) => (
                      <Button
                        key={valor}
                        size="sm"
                        variant={recorte === valor ? 'default' : 'outline'}
                        className="h-8"
                        onClick={() => setRecorte(valor)}
                      >
                        {rotulo}
                      </Button>
                    ))}
                  </div>
                </div>
                {linhasVisiveis.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                    {active.items.length === 0 ? 'Lista vazia. Bipe ou procure os itens que estão no setor.' : 'Nenhum item neste filtro.'}
                  </p>
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
                        {linhasVisiveis.map((ci) => {
                          const it = itemPorId.get(ci.itemId)
                          const counted = ci.countedQty
                          const diff = counted != null ? counted - ci.systemQty : null
                          return (
                            <TableRow key={ci.id}>
                              <TableCell className="font-medium">
                                {/* Aba nova: o número digitado e ainda não salvo não se perde. */}
                                <Link to={`/estoque/item/${ci.itemId}`} target="_blank" className="hover:underline">
                                  {it?.name ?? ci.itemId}
                                </Link>
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {formatQtd(ci.systemQty)} {it?.unit ?? ''}
                              </TableCell>
                              <TableCell className="text-right">
                                {active.status === 'aberta' ? (
                                  <Input
                                    ref={(el) => {
                                      if (el) inputs.current.set(ci.id, el)
                                      else inputs.current.delete(ci.id)
                                    }}
                                    value={drafts[ci.id] ?? (counted != null ? String(counted) : '')}
                                    onChange={(e) => setDrafts((d) => ({ ...d, [ci.id]: e.target.value }))}
                                    onBlur={(e) => void saveCounted(ci.id, e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                    }}
                                    inputMode="decimal"
                                    aria-label={`Quantidade contada de ${it?.name ?? ci.itemId}`}
                                    className="ml-auto h-8 w-20 text-right"
                                    placeholder="?"
                                  />
                                ) : (
                                  <span className="tabular-nums">{counted != null ? formatQtd(counted) : 'não contado'}</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {diff == null ? (
                                  <span className="text-muted-foreground">·</span>
                                ) : diff === 0 ? (
                                  <span className="text-emerald-600">0</span>
                                ) : (
                                  <span className={diff > 0 ? 'text-sky-600' : 'text-red-500'}>
                                    {diff > 0 ? `+${formatQtd(diff)}` : formatQtd(diff)}
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
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmarFinalizar}
        onOpenChange={(v) => (!finalizando ? setConfirmarFinalizar(v) : null)}
        title="Finalizar a contagem?"
        description={`${comDiferenca.length} ${comDiferenca.length === 1 ? 'item vai' : 'itens vão'} ser ajustados no setor ${active ? setorDaContagem(active) : ''} para o número contado.${pending > 0 ? ` ${pending} sem contar ficam como estão.` : ''} A contagem não pode ser reaberta.`}
        confirmLabel={finalizando ? 'Finalizando…' : 'Finalizar'}
        variant="default"
        onConfirm={() => void handleFinalize()}
      />
      <ConfirmDialog
        open={confirmarCancelar}
        onOpenChange={setConfirmarCancelar}
        title="Cancelar a contagem?"
        description="Nada muda no estoque. Os números digitados ficam guardados na contagem cancelada."
        confirmLabel="Cancelar contagem"
        cancelLabel="Voltar"
        onConfirm={() => void handleCancel()}
      />
    </AppLayout>
  )
}
