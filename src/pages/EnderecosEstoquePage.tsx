import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Ban, ChevronDown, MapPin, MoreHorizontal, Pencil, Plus, Printer, RotateCcw, Star, Warehouse, X } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { type PickerItem, SearchPicker } from '@/components/ui/search-picker'
import { Textarea } from '@/components/ui/textarea'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { formatQtd, produtosParaBusca, semCodigoBipado } from '@/components/kits/kitUi'
import { beep } from '@/lib/beep'
import { combinaBusca } from '@/lib/busca'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { escaparHtml, imprimirHtml } from '@/lib/exportar'
import { cn } from '@/lib/utils'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import {
  type StockWarehouse,
  definirSetorAtivo,
  listWarehouseBalances,
  listWarehouses,
  upsertWarehouse,
} from '@/services/estoqueArmazens'
import {
  type EnderecoEstoque,
  type ItemNoEndereco,
  compararCodigoEndereco,
  criarEnderecosEmSerie,
  definirEnderecoAtivo,
  guardarItemNoEndereco,
  listarEnderecos,
  listarItensNosEnderecos,
  salvarEndereco,
  tirarItemDoEndereco,
} from '@/services/estoqueRastreio'

type Aba = 'enderecos' | 'setores'
type ParamUrl = 'aba' | 'setor' | 'endereco'
type Saldo = { warehouseId: string; itemId: string; qty: number }

const colacao = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })
const erro = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao)
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
/** Saldo de ponto flutuante: 0,0000001 que sobra de fração não é item na prateleira. */
const temSaldo = (q: number | undefined) => (q ?? 0) > 0.0001

/**
 * Onde cada item fica dentro do setor (Principal › A-03 "Armário A, prateleira 3") e o cadastro
 * dos setores. A enfermagem guardava isso de cabeça: quem cobria folga abria armário por armário.
 */
/** /estoque-setores: o cadastro dos setores, tela própria no menu (era a aba Setores). */
export function SetoresEstoquePage() {
  return <EnderecosEstoquePage tela="setores" />
}

export function EnderecosEstoquePage({ tela = 'enderecos' }: { tela?: Aba }) {
  // Setor e endereço aberto moram na URL: abrir a ficha de um item e voltar devolve a
  // enfermeira ao mesmo armário, e a tela remonta quando o navegador volta do foco.
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const aba: Aba = tela
  const mudarUrl = useCallback(
    (mudancas: Partial<Record<ParamUrl, string | null>>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [chave, valor] of Object.entries(mudancas)) {
            if (valor) next.set(chave, valor)
            else next.delete(chave)
          }
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const [setores, setSetores] = useState<StockWarehouse[]>([])
  const [enderecos, setEnderecos] = useState<EnderecoEstoque[]>([])
  const [vinculos, setVinculos] = useState<ItemNoEndereco[]>([])
  // Inclui inativos: vínculo antigo de item consolidado ainda precisa mostrar o nome.
  const [items, setItems] = useState<StockItem[]>([])
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      try {
        // Saldo de todos os setores numa consulta só: a view agrega o livro inteiro de qualquer
        // jeito, e a aba Setores precisa da contagem de todos.
        const [s, e, v, it, sd] = await Promise.all([
          listWarehouses(true),
          listarEnderecos(true),
          listarItensNosEnderecos(),
          listStockItems(true),
          listWarehouseBalances(),
        ])
        if (cancelado) return
        setSetores(s)
        setEnderecos(e)
        setVinculos(v)
        setItems(it)
        setSaldos(sd)
      } catch (e) {
        if (!cancelado) toast.error(erro(e, 'Falha ao carregar setores e endereços'))
      } finally {
        if (!cancelado) setLoading(false)
      }
    })()
    return () => {
      cancelado = true
    }
  }, [])

  const recarregarSetores = useCallback(async () => {
    try {
      setSetores(await listWarehouses(true))
    } catch (e) {
      toast.error(erro(e, 'Falha ao recarregar os setores'))
    }
  }, [])
  const recarregarEnderecos = useCallback(async () => {
    try {
      setEnderecos(await listarEnderecos(true))
    } catch (e) {
      toast.error(erro(e, 'Falha ao recarregar os endereços'))
    }
  }, [])
  const recarregarVinculos = useCallback(async () => {
    try {
      setVinculos(await listarItensNosEnderecos())
    } catch (e) {
      toast.error(erro(e, 'Falha ao recarregar os itens dos endereços'))
    }
  }, [])

  const saldoPorSetor = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const s of saldos) {
      const doSetor = m.get(s.warehouseId) ?? new Map<string, number>()
      doSetor.set(s.itemId, s.qty)
      m.set(s.warehouseId, doSetor)
    }
    return m
  }, [saldos])

  const setoresAtivos = useMemo(() => setores.filter((s) => s.active), [setores])
  const padrao = setoresAtivos.find((s) => s.isDefault) ?? setoresAtivos[0]
  const setorDaUrl = params.get('setor')
  const setor = setoresAtivos.find((s) => s.id === setorDaUrl) ?? padrao

  // Link antigo da aba Setores (`/estoque-enderecos?aba=setores`) segue para a tela nova.
  if (tela === 'enderecos' && params.get('aba') === 'setores') return <Navigate to="/estoque-setores" replace />

  return (
    <AppLayout
      title={aba === 'setores' ? 'Setores' : 'Endereços'}
      subtitle={
        aba === 'setores'
          ? 'Os lugares onde o estoque fica: Principal, Centro Cirúrgico, SPA. Setor padrão é onde entra a nota.'
          : 'Diga onde cada item fica guardado e imprima as etiquetas das prateleiras.'
      }
    >
        {aba === 'enderecos' ? (
          setor ? (
            <AbaEnderecos
              // Seleção de etiquetas, destino rápido e busca valem para um setor só: trocar de setor zera.
              key={setor.id}
              setoresAtivos={setoresAtivos}
              setor={setor}
              onSetor={(id) => mudarUrl({ setor: id, endereco: null })}
              expandidoId={params.get('endereco')}
              onExpandir={(id) => mudarUrl({ endereco: id })}
              enderecos={enderecos}
              vinculos={vinculos}
              setVinculos={setVinculos}
              items={items}
              saldoSetor={saldoPorSetor.get(setor.id) ?? new Map()}
              onEnderecosMudaram={recarregarEnderecos}
              onVinculosMudaram={recarregarVinculos}
              onItemAtualizado={(item) => setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))}
            />
          ) : (
            <EmptyState
              icon={Warehouse}
              title={loading ? 'Carregando…' : 'Nenhum setor ativo'}
              description={loading ? undefined : 'Cadastre um setor na tela Setores (menu Estoque) para criar os endereços.'}
            />
          )
        ) : (
          <AbaSetores
            setores={setores}
            enderecos={enderecos}
            saldoPorSetor={saldoPorSetor}
            loading={loading}
            onMudou={recarregarSetores}
            onVerEnderecos={(id) => navigate(`/estoque-enderecos?setor=${encodeURIComponent(id)}`)}
          />
        )}
    </AppLayout>
  )
}

// ================================================================ aba Endereços

function AbaEnderecos({
  setoresAtivos,
  setor,
  onSetor,
  expandidoId,
  onExpandir,
  enderecos,
  vinculos,
  setVinculos,
  items,
  saldoSetor,
  onEnderecosMudaram,
  onVinculosMudaram,
  onItemAtualizado,
}: {
  setoresAtivos: StockWarehouse[]
  setor: StockWarehouse
  onSetor: (id: string) => void
  expandidoId: string | null
  onExpandir: (id: string | null) => void
  enderecos: EnderecoEstoque[]
  vinculos: ItemNoEndereco[]
  setVinculos: React.Dispatch<React.SetStateAction<ItemNoEndereco[]>>
  items: StockItem[]
  saldoSetor: Map<string, number>
  onEnderecosMudaram: () => Promise<void>
  onVinculosMudaram: () => Promise<void>
  onItemAtualizado: (item: StockItem) => void
}) {
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [criando, setCriando] = useState(false)
  const [editando, setEditando] = useState<EnderecoEstoque | null>(null)
  const [desativando, setDesativando] = useState<EnderecoEstoque | null>(null)
  const [codigoNaoAchado, setCodigoNaoAchado] = useState<string | null>(null)
  const [buscaSem, setBuscaSem] = useState('')
  const [alvoId, setAlvoId] = useState<string | null>(null)
  const [limiteSem, setLimiteSem] = useState(60)
  const [guardando, setGuardando] = useState<string | null>(null)

  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const ativos = useMemo(() => items.filter((i) => i.active), [items])

  const doSetor = useMemo(
    () => enderecos.filter((e) => e.setorId === setor.id).sort((a, b) => compararCodigoEndereco(a.codigo, b.codigo)),
    [enderecos, setor.id],
  )
  const ativosDoSetor = useMemo(() => doSetor.filter((e) => e.ativo), [doSetor])
  const inativosQtd = doSetor.length - ativosDoSetor.length
  const visiveis = mostrarInativos ? doSetor : ativosDoSetor
  const expandido = doSetor.find((e) => e.id === expandidoId) ?? null
  const alvo = ativosDoSetor.find((e) => e.id === alvoId) ?? null

  const porEndereco = useMemo(() => {
    const m = new Map<string, ItemNoEndereco[]>()
    for (const v of vinculos) {
      const lista = m.get(v.enderecoId) ?? []
      lista.push(v)
      m.set(v.enderecoId, lista)
    }
    return m
  }, [vinculos])

  // Endereços ATIVOS deste setor onde cada item está: base do "também em" e do "sem endereço".
  const enderecosDoItem = useMemo(() => {
    const ativosIds = new Map(ativosDoSetor.map((e) => [e.id, e] as const))
    const m = new Map<string, EnderecoEstoque[]>()
    for (const v of vinculos) {
      const e = ativosIds.get(v.enderecoId)
      if (!e) continue
      const lista = m.get(v.itemId) ?? []
      lista.push(e)
      m.set(v.itemId, lista)
    }
    return m
  }, [vinculos, ativosDoSetor])

  const nomesNoEndereco = useCallback(
    (enderecoId: string) =>
      (porEndereco.get(enderecoId) ?? [])
        .map((v) => porId.get(v.itemId)?.name ?? 'Item')
        .sort((a, b) => colacao.compare(a, b)),
    [porEndereco, porId],
  )

  // Na busca de item, quem tem saldo neste setor vem primeiro e o número é o saldo daqui.
  const buscaItens = useMemo(() => {
    const unidade = new Map(ativos.map((i) => [i.id, i.unit] as const))
    return produtosParaBusca(ativos)
      .map((p) => ({ ...p, meta: `${formatQtd(saldoSetor.get(p.id) ?? 0)} ${unidade.get(p.id) ?? 'un'}` }))
      .sort((a, b) => Number(temSaldo(saldoSetor.get(b.id))) - Number(temSaldo(saldoSetor.get(a.id))))
  }, [ativos, saldoSetor])

  const opcoesEndereco: PickerItem[] = useMemo(
    () =>
      ativosDoSetor.map((e) => ({
        id: e.id,
        label: e.codigo,
        hint: e.descricao ?? undefined,
        meta: plural(porEndereco.get(e.id)?.length ?? 0, 'item', 'itens'),
      })),
    [ativosDoSetor, porEndereco],
  )

  const semEndereco = useMemo(
    () =>
      [...saldoSetor.entries()]
        .filter(([itemId, qty]) => temSaldo(qty) && !enderecosDoItem.has(itemId))
        .map(([itemId, qty]) => ({ item: porId.get(itemId), qty }))
        .filter((x): x is { item: StockItem; qty: number } => x.item != null && x.item.active)
        .sort((a, b) => colacao.compare(a.item.name, b.item.name)),
    [saldoSetor, enderecosDoItem, porId],
  )
  const semFiltrado = useMemo(
    () => (buscaSem.trim() ? semEndereco.filter((x) => combinaBusca(buscaSem, x.item.name, x.item.sku, x.item.barcode)) : semEndereco),
    [semEndereco, buscaSem],
  )

  const guardar = async (item: StockItem, endereco: EnderecoEstoque) => {
    if ((porEndereco.get(endereco.id) ?? []).some((v) => v.itemId === item.id)) {
      beep(false)
      toast.info(`${item.name} já está em ${endereco.codigo}.`)
      return
    }
    setGuardando(item.id)
    try {
      await guardarItemNoEndereco(item.id, endereco.id)
      beep(true)
      toast.success(`${item.name} guardado em ${endereco.codigo}.`)
      await onVinculosMudaram()
    } catch (e) {
      beep(false)
      toast.error(erro(e, 'Falha ao guardar o item'))
    } finally {
      setGuardando(null)
    }
  }

  const tirar = async (vinculo: ItemNoEndereco, endereco: EnderecoEstoque) => {
    const nome = porId.get(vinculo.itemId)?.name ?? 'Item'
    try {
      await tirarItemDoEndereco(vinculo.id)
      setVinculos((prev) => prev.filter((v) => v.id !== vinculo.id))
      toast.success(`${nome} saiu de ${endereco.codigo}.`)
    } catch (e) {
      toast.error(erro(e, 'Falha ao tirar o item'))
    }
  }

  const onCode = (code: string) => {
    setBuscaSem((b) => semCodigoBipado(b, code))
    if (!expandido || !expandido.ativo) return
    const item = acharItemPorCodigo(ativos, code)
    if (!item) {
      beep(false)
      setCodigoNaoAchado(code)
      return
    }
    void guardar(item, expandido)
  }

  const alternarAtivo = async (endereco: EnderecoEstoque, ativo: boolean) => {
    setDesativando(null)
    try {
      await definirEnderecoAtivo(endereco.id, ativo)
      toast.success(ativo ? `${endereco.codigo} reativado.` : `${endereco.codigo} desativado.`)
      if (!ativo && selecionados.has(endereco.id)) {
        setSelecionados((prev) => {
          const next = new Set(prev)
          next.delete(endereco.id)
          return next
        })
      }
      await onEnderecosMudaram()
    } catch (e) {
      toast.error(erro(e, 'Falha ao mudar o endereço'))
    }
  }

  const pedirDesativar = (endereco: EnderecoEstoque) => {
    // Endereço vazio sai direto; com itens, avisa que eles voltam para "sem endereço".
    if ((porEndereco.get(endereco.id)?.length ?? 0) > 0) setDesativando(endereco)
    else void alternarAtivo(endereco, false)
  }

  const imprimir = (ids: string[]) => {
    const lista = doSetor.filter((e) => ids.includes(e.id))
    if (lista.length === 0) {
      toast.error('Marque ao menos um endereço para imprimir.')
      return
    }
    try {
      imprimirHtml(
        htmlEtiquetas(
          setor.name,
          lista.map((e) => ({ codigo: e.codigo, descricao: e.descricao, itens: nomesNoEndereco(e.id) })),
        ),
      )
    } catch (e) {
      toast.error(erro(e, 'Falha ao imprimir'))
    }
  }

  const marcados = visiveis.filter((e) => selecionados.has(e.id)).length
  const todosMarcados = visiveis.length > 0 && marcados === visiveis.length

  return (
    <div className="space-y-4">
      {setoresAtivos.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Setor">
          {setoresAtivos.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === setor.id}
              onClick={() => onSetor(s.id)}
              className={cn(
                'min-h-9 rounded-lg border px-3 py-2 text-sm transition-colors',
                s.id === setor.id ? 'border-primary bg-primary/10 font-medium' : 'border-border bg-card hover:bg-muted',
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold">
            Endereços em {setor.name} ({ativosDoSetor.length})
          </h2>
          <Button className="h-9" onClick={() => setCriando(true)}>
            <Plus className="size-4" aria-hidden /> Novo endereço
          </Button>
          <Button variant="outline" className="h-9" onClick={() => imprimir([...selecionados])} disabled={selecionados.size === 0}>
            <Printer className="size-4" aria-hidden /> Etiquetas{selecionados.size > 0 ? ` (${selecionados.size})` : ''}
          </Button>
        </div>

        {doSetor.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2">
              <Checkbox
                checked={todosMarcados}
                indeterminate={marcados > 0 && !todosMarcados}
                onCheckedChange={(c) => setSelecionados(c ? new Set(visiveis.map((e) => e.id)) : new Set())}
              />
              Marcar todos para etiqueta
            </label>
            {inativosQtd > 0 ? (
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-muted-foreground">
                <Checkbox checked={mostrarInativos} onCheckedChange={(c) => setMostrarInativos(c)} />
                Mostrar inativos ({inativosQtd})
              </label>
            ) : null}
          </div>
        ) : null}

        {visiveis.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title={`Nenhum endereço em ${setor.name}`}
            description="Crie os endereços do setor (ex.: A-01 até A-06) e diga o que fica em cada um."
          />
        ) : (
          <ul className="space-y-2">
            {visiveis.map((e) => {
              const vincs = porEndereco.get(e.id) ?? []
              const aberto = expandido?.id === e.id
              return (
                <li key={e.id} className={cn('rounded-xl border border-border bg-card', aberto && 'border-primary/50', !e.ativo && 'bg-muted/40')}>
                  <div className="flex items-center gap-1 p-1.5 sm:gap-2 sm:p-2">
                    <label className="flex size-9 shrink-0 cursor-pointer items-center justify-center">
                      <Checkbox
                        checked={selecionados.has(e.id)}
                        onCheckedChange={(c) =>
                          setSelecionados((prev) => {
                            const next = new Set(prev)
                            if (c) next.add(e.id)
                            else next.delete(e.id)
                            return next
                          })
                        }
                        aria-label={`Marcar ${e.codigo} para etiqueta`}
                      />
                    </label>
                    <button
                      type="button"
                      aria-expanded={aberto}
                      onClick={() => onExpandir(aberto ? null : e.id)}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      <span className={cn('shrink-0 text-base font-semibold tabular-nums', !e.ativo && 'text-muted-foreground')}>{e.codigo}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-sm', !e.descricao && 'text-muted-foreground')}>
                          {e.descricao ?? 'Sem descrição'}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {vincs.length === 0 ? 'vazio' : plural(vincs.length, 'item', 'itens')}
                        </span>
                      </span>
                      {!e.ativo ? <Badge variant="secondary">Inativo</Badge> : null}
                      <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-180')} aria-hidden />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-9 shrink-0')}
                        aria-label={`Mais ações de ${e.codigo}`}
                      >
                        <MoreHorizontal className="size-4" aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem onClick={() => setEditando(e)}>
                          <Pencil className="size-4" aria-hidden /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => imprimir([e.id])}>
                          <Printer className="size-4" aria-hidden /> Imprimir etiqueta
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {e.ativo ? (
                          <DropdownMenuItem variant="destructive" onClick={() => pedirDesativar(e)}>
                            <Ban className="size-4" aria-hidden /> Desativar
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => void alternarAtivo(e, true)}>
                            <RotateCcw className="size-4" aria-hidden /> Reativar
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {aberto ? (
                    <PainelEndereco
                      endereco={e}
                      setorNome={setor.name}
                      vinculos={vincs}
                      porId={porId}
                      saldoSetor={saldoSetor}
                      enderecosDoItem={enderecosDoItem}
                      buscaItens={buscaItens}
                      onCode={onCode}
                      onPick={(itemId) => {
                        const item = porId.get(itemId)
                        if (item) void guardar(item, e)
                      }}
                      onTirar={(v) => void tirar(v, e)}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-card p-3 sm:p-4">
        <div>
          <h2 className="text-sm font-semibold">Sem endereço em {setor.name} ({semEndereco.length})</h2>
          <p className="text-xs text-muted-foreground">
            Itens com saldo neste setor que ainda não têm lugar marcado. Escolha o endereço e toque em Guardar em cada item.
          </p>
        </div>

        {semEndereco.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Todo item com saldo em {setor.name} já tem endereço.
          </p>
        ) : ativosDoSetor.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Crie os endereços do setor primeiro.
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <SearchPicker
                  title={`Guardar em qual endereço de ${setor.name}?`}
                  placeholder="Escolher endereço"
                  searchPlaceholder="Código ou descrição…"
                  items={opcoesEndereco}
                  value={alvo ? { id: alvo.id, label: `Guardar em ${alvo.codigo}${alvo.descricao ? ` · ${alvo.descricao}` : ''}` } : null}
                  onPick={(p) => setAlvoId(p.id)}
                  onClear={() => setAlvoId(null)}
                  className="[&_[data-slot=button]]:h-10"
                />
              </div>
              <SearchField value={buscaSem} onChange={setBuscaSem} label="Buscar item sem endereço" resultados={semFiltrado.length} className="[&_input]:h-10" />
            </div>

            {semFiltrado.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nenhum item com esse nome.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {semFiltrado.slice(0, limiteSem).map(({ item, qty }) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <Link
                        to={`/estoque/item/${item.id}`}
                        className="text-sm leading-snug hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                      >
                        {item.name}
                      </Link>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatQtd(qty)} {item.unit} no setor
                      </p>
                    </div>
                    <Button
                      variant={alvo ? 'outline' : 'ghost'}
                      className="h-9 shrink-0"
                      disabled={!alvo || guardando === item.id}
                      onClick={() => alvo && void guardar(item, alvo)}
                    >
                      <MapPin className="size-4" aria-hidden />
                      {alvo ? `Guardar em ${alvo.codigo}` : 'Guardar'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {semFiltrado.length > limiteSem ? (
              <Button variant="ghost" className="h-9 w-full text-muted-foreground" onClick={() => setLimiteSem((n) => n + 60)}>
                Mostrar mais ({semFiltrado.length - limiteSem} restantes)
              </Button>
            ) : null}
          </>
        )}
      </section>

      <NovoEnderecoDialog
        open={criando}
        onOpenChange={setCriando}
        setor={setor}
        codigosExistentes={doSetor.map((e) => e.codigo.toUpperCase())}
        onCriado={async (novoId) => {
          await onEnderecosMudaram()
          if (novoId) onExpandir(novoId)
        }}
      />

      <EditarEnderecoDialog key={editando?.id ?? 'nenhum'} endereco={editando} onClose={() => setEditando(null)} onSalvo={onEnderecosMudaram} />

      <ConfirmDialog
        open={desativando != null}
        onOpenChange={(open) => !open && setDesativando(null)}
        title={`Desativar ${desativando?.codigo ?? 'endereço'}?`}
        description={`${plural(porEndereco.get(desativando?.id ?? '')?.length ?? 0, 'item guardado aqui passa', 'itens guardados aqui passam')} para "Sem endereço" até alguém guardar em outro lugar. Dá para reativar depois.`}
        confirmLabel="Desativar"
        cancelLabel="Voltar"
        icon={Ban}
        onConfirm={() => desativando && void alternarAtivo(desativando, false)}
      />

      <VincularCodigoDialog
        codigo={codigoNaoAchado}
        itens={ativos}
        onClose={() => setCodigoNaoAchado(null)}
        onVinculado={(item) => {
          setCodigoNaoAchado(null)
          onItemAtualizado(item)
          if (expandido?.ativo) void guardar(item, expandido)
        }}
      />
    </div>
  )
}

function PainelEndereco({
  endereco,
  setorNome,
  vinculos,
  porId,
  saldoSetor,
  enderecosDoItem,
  buscaItens,
  onCode,
  onPick,
  onTirar,
}: {
  endereco: EnderecoEstoque
  setorNome: string
  vinculos: ItemNoEndereco[]
  porId: Map<string, StockItem>
  saldoSetor: Map<string, number>
  enderecosDoItem: Map<string, EnderecoEstoque[]>
  buscaItens: PickerItem[]
  onCode: (code: string) => void
  onPick: (itemId: string) => void
  onTirar: (vinculo: ItemNoEndereco) => void
}) {
  const linhas = [...vinculos].sort((a, b) => colacao.compare(porId.get(a.itemId)?.name ?? '', porId.get(b.itemId)?.name ?? ''))
  return (
    <div className="space-y-3 border-t border-border p-3">
      {endereco.ativo ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <ScanBar onCode={onCode} placeholder={`Bipe para guardar em ${endereco.codigo}`} />
          <div className="min-w-0">
            <SearchPicker
              title={`Guardar item em ${endereco.codigo} (saldo em ${setorNome})`}
              placeholder="Buscar item para guardar aqui"
              searchPlaceholder="Nome, SKU ou código de barras…"
              items={buscaItens}
              value={null}
              onPick={(p) => onPick(p.id)}
              className="[&_[data-slot=button]]:h-10"
            />
          </div>
        </div>
      ) : (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Endereço inativo. Reative pelo menu para guardar itens aqui.
        </p>
      )}

      {linhas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
          Nada guardado em {endereco.codigo} ainda. Bipe ou busque o item.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {linhas.map((v) => {
            const item = porId.get(v.itemId)
            const saldo = saldoSetor.get(v.itemId) ?? 0
            const outros = (enderecosDoItem.get(v.itemId) ?? []).filter((e) => e.id !== endereco.id)
            return (
              <li key={v.id} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/estoque/item/${v.itemId}`}
                    className="text-sm leading-snug hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                  >
                    {item?.name ?? 'Item'}
                  </Link>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    <span className={cn(saldo < -0.0001 && 'text-amber-700 dark:text-amber-300')}>
                      {Math.abs(saldo) > 0.0001 ? `${formatQtd(saldo)} ${item?.unit ?? 'un'} no setor` : 'sem saldo no setor'}
                    </span>
                    {outros.length > 0 ? ` · também em ${outros.map((e) => e.codigo).join(', ')}` : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0 text-muted-foreground"
                  onClick={() => onTirar(v)}
                  aria-label={`Tirar ${item?.name ?? 'item'} de ${endereco.codigo}`}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function NovoEnderecoDialog({
  open,
  onOpenChange,
  setor,
  codigosExistentes,
  onCriado,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  setor: StockWarehouse
  codigosExistentes: string[]
  onCriado: (novoId: string | null) => Promise<void>
}) {
  const [modo, setModo] = useState<'um' | 'serie'>('um')
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [prefixo, setPrefixo] = useState('A-')
  const [de, setDe] = useState('1')
  const [ate, setAte] = useState('6')
  const [salvando, setSalvando] = useState(false)

  // Mesma regra do serviço (criarEnderecosEmSerie), para o exemplo bater com o que vai ser criado.
  const serie = useMemo(() => {
    const deN = Number(de)
    const ateN = Number(ate)
    if (de.trim() === '' || ate.trim() === '' || !Number.isInteger(deN) || !Number.isInteger(ateN) || deN < 0) {
      return { ok: false as const, msg: 'Informe números inteiros em "de" e "até".' }
    }
    if (ateN < deN) return { ok: false as const, msg: '"Até" precisa ser maior ou igual a "de".' }
    if (ateN - deN > 199) return { ok: false as const, msg: 'No máximo 200 endereços por vez.' }
    const casas = Math.max(2, String(ateN).length)
    const cod = (n: number) => `${prefixo.trim().toUpperCase()}${String(n).padStart(casas, '0')}`
    const existentes = new Set(codigosExistentes)
    let repetidos = 0
    for (let n = deN; n <= ateN; n += 1) if (existentes.has(cod(n))) repetidos += 1
    const total = ateN - deN + 1
    return {
      ok: true as const,
      msg: `${deN === ateN ? cod(deN) : `${cod(deN)} até ${cod(ateN)}`} (${plural(total, 'endereço', 'endereços')})`,
      repetidos,
      total,
    }
  }, [de, ate, prefixo, codigosExistentes])

  const codigoRepetido = codigo.trim() !== '' && codigosExistentes.includes(codigo.trim().toUpperCase())

  const salvar = async () => {
    setSalvando(true)
    try {
      if (modo === 'um') {
        const novo = await salvarEndereco({ setorId: setor.id, codigo, descricao })
        toast.success(`Endereço ${novo.codigo} criado em ${setor.name}.`)
        setCodigo('')
        setDescricao('')
        onOpenChange(false)
        await onCriado(novo.id)
      } else {
        const { criados, pulados } = await criarEnderecosEmSerie({
          setorId: setor.id,
          prefixo,
          de: Number(de),
          ate: Number(ate),
          descricao,
        })
        const extra = pulados > 0 ? ` ${plural(pulados, 'já existia e foi pulado', 'já existiam e foram pulados')}.` : ''
        if (criados > 0) toast.success(`${plural(criados, 'endereço criado', 'endereços criados')} em ${setor.name}.${extra}`)
        else toast.info(`Nenhum endereço novo: todos já existiam em ${setor.name}.`)
        setDescricao('')
        onOpenChange(false)
        await onCriado(null)
      }
    } catch (e) {
      toast.error(erro(e, 'Falha ao criar endereço'))
    } finally {
      setSalvando(false)
    }
  }

  const podeSalvar = modo === 'um' ? codigo.trim() !== '' && !codigoRepetido : serie.ok && serie.total > serie.repetidos

  return (
    <Dialog open={open} onOpenChange={(o) => !salvando && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo endereço em {setor.name}</DialogTitle>
          <DialogDescription>Código curto que vai na etiqueta da prateleira, e a descrição de onde fica.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Quantos endereços">
          {(
            [
              ['um', 'Um só'],
              ['serie', 'Em série'],
            ] as const
          ).map(([m, rotulo]) => (
            <button
              key={m}
              type="button"
              aria-pressed={modo === m}
              onClick={() => setModo(m)}
              className={cn(
                'min-h-9 rounded-md text-sm font-medium transition-colors',
                modo === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {modo === 'um' ? (
          <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="end-codigo">Código</Label>
              <Input
                id="end-codigo"
                autoFocus
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && podeSalvar && void salvar()}
                placeholder="A-01"
                className="h-10 uppercase"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end-desc">Descrição (opcional)</Label>
              <Input
                id="end-desc"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && podeSalvar && void salvar()}
                placeholder="Armário A, prateleira 1"
                className="h-10"
              />
            </div>
            {codigoRepetido ? (
              <p className="text-xs text-destructive sm:col-span-2">Já existe {codigo.trim().toUpperCase()} em {setor.name}.</p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="serie-prefixo">Prefixo</Label>
                <Input id="serie-prefixo" value={prefixo} onChange={(e) => setPrefixo(e.target.value)} placeholder="A-" className="h-10 uppercase" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="serie-de">De</Label>
                <Input id="serie-de" value={de} onChange={(e) => setDe(e.target.value)} inputMode="numeric" className="h-10 tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="serie-ate">Até</Label>
                <Input id="serie-ate" value={ate} onChange={(e) => setAte(e.target.value)} inputMode="numeric" className="h-10 tabular-nums" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="serie-desc">Descrição para todos (opcional)</Label>
              <Input id="serie-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Armário A" className="h-10" />
            </div>
            <p className={cn('rounded-lg px-3 py-2 text-sm', serie.ok ? 'bg-muted' : 'bg-destructive/10 text-destructive')}>
              {serie.ok ? (
                <>
                  Vai criar <strong className="tabular-nums">{serie.msg}</strong>.
                  {serie.repetidos > 0 ? (
                    <span className="block text-xs text-muted-foreground">
                      {plural(serie.repetidos, 'já existe e será pulado', 'já existem e serão pulados')}.
                    </span>
                  ) : null}
                </>
              ) : (
                serie.msg
              )}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="h-9" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button className="h-9" onClick={() => void salvar()} disabled={salvando || !podeSalvar}>
            {salvando ? 'Criando…' : modo === 'um' ? 'Criar endereço' : 'Criar endereços'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditarEnderecoDialog({
  endereco,
  onClose,
  onSalvo,
}: {
  endereco: EnderecoEstoque | null
  onClose: () => void
  onSalvo: () => Promise<void>
}) {
  // O pai troca a `key` a cada endereço aberto, então o rascunho nasce do endereço certo.
  const [codigo, setCodigo] = useState(endereco?.codigo ?? '')
  const [descricao, setDescricao] = useState(endereco?.descricao ?? '')
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    if (!endereco) return
    setSalvando(true)
    try {
      const salvo = await salvarEndereco({ id: endereco.id, setorId: endereco.setorId, codigo, descricao })
      toast.success(`Endereço ${salvo.codigo} salvo.`)
      onClose()
      await onSalvo()
    } catch (e) {
      toast.error(erro(e, 'Falha ao salvar o endereço'))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={endereco != null} onOpenChange={(o) => !o && !salvando && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar {endereco?.codigo ?? 'endereço'}</DialogTitle>
          <DialogDescription>Os itens guardados continuam neste endereço. Se mudar o código, reimprima a etiqueta.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="edit-codigo">Código</Label>
            <Input id="edit-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="h-10 uppercase" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-desc">Descrição</Label>
            <Input
              id="edit-desc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && codigo.trim() && void salvar()}
              placeholder="Armário A, prateleira 1"
              className="h-10"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-9" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button className="h-9" onClick={() => void salvar()} disabled={salvando || codigo.trim() === ''}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ================================================================ aba Setores

type FormSetor = { id?: string; nome: string; codigo: string; obs: string }

function AbaSetores({
  setores,
  enderecos,
  saldoPorSetor,
  loading,
  onMudou,
  onVerEnderecos,
}: {
  setores: StockWarehouse[]
  enderecos: EnderecoEstoque[]
  saldoPorSetor: Map<string, Map<string, number>>
  loading: boolean
  onMudou: () => Promise<void>
  onVerEnderecos: (id: string) => void
}) {
  const [form, setForm] = useState<FormSetor | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [padraoAlvo, setPadraoAlvo] = useState<StockWarehouse | null>(null)
  const [mexendo, setMexendo] = useState<string | null>(null)

  const ordenados = useMemo(
    () => [...setores].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.isDefault) - Number(a.isDefault) || colacao.compare(a.name, b.name)),
    [setores],
  )

  const salvar = async () => {
    if (!form) return
    setSalvando(true)
    try {
      await upsertWarehouse({ id: form.id, name: form.nome, code: form.codigo, note: form.obs })
      toast.success(form.id ? `Setor ${form.nome.trim()} salvo.` : `Setor ${form.nome.trim()} criado.`)
      setForm(null)
      await onMudou()
    } catch (e) {
      toast.error(erro(e, 'Falha ao salvar o setor'))
    } finally {
      setSalvando(false)
    }
  }

  const tornarPadrao = async (w: StockWarehouse) => {
    setPadraoAlvo(null)
    setMexendo(w.id)
    try {
      await upsertWarehouse({ id: w.id, name: w.name, code: w.code, note: w.note, isDefault: true })
      toast.success(`${w.name} agora é o setor padrão.`)
      await onMudou()
    } catch (e) {
      toast.error(erro(e, 'Falha ao trocar o setor padrão'))
    } finally {
      setMexendo(null)
    }
  }

  const alternarAtivo = async (w: StockWarehouse, ativo: boolean) => {
    setMexendo(w.id)
    try {
      await definirSetorAtivo(w.id, ativo)
      toast.success(ativo ? `${w.name} reativado.` : `${w.name} desativado.`)
      await onMudou()
    } catch (e) {
      toast.error(erro(e, 'Falha ao mudar o setor'))
    } finally {
      setMexendo(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3 text-sm">
        <p className="min-w-0 flex-1 basis-64 text-muted-foreground">
          O setor <strong className="text-foreground">padrão</strong> recebe a entrada de nota e o kit quando ninguém escolhe setor. Setor com
          saldo não pode ser desativado: transfira o material antes.
        </p>
        <Button className="h-9 shrink-0" onClick={() => setForm({ nome: '', codigo: '', obs: '' })}>
          <Plus className="size-4" aria-hidden /> Novo setor
        </Button>
      </div>

      {ordenados.length === 0 ? (
        <EmptyState icon={Warehouse} title={loading ? 'Carregando…' : 'Nenhum setor cadastrado'} />
      ) : (
        <ul className="space-y-2">
          {ordenados.map((w) => {
            const saldos = [...(saldoPorSetor.get(w.id)?.values() ?? [])]
            const comSaldo = saldos.filter((q) => temSaldo(q)).length
            const negativos = saldos.filter((q) => q < -0.0001).length
            const nEnderecos = enderecos.filter((e) => e.setorId === w.id && e.ativo).length
            return (
              <li key={w.id} className={cn('rounded-xl border border-border bg-card p-3 sm:p-4', !w.active && 'bg-muted/40')}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn('text-sm font-semibold', !w.active && 'text-muted-foreground')}>{w.name}</span>
                  {w.code ? <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">{w.code}</span> : null}
                  {w.isDefault ? (
                    <Badge>
                      <Star aria-hidden /> Padrão
                    </Badge>
                  ) : null}
                  {!w.active ? <Badge variant="secondary">Inativo</Badge> : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {plural(comSaldo, 'item com saldo', 'itens com saldo')} · {plural(nEnderecos, 'endereço', 'endereços')}
                  {negativos > 0 ? (
                    <span className="text-amber-700 dark:text-amber-300"> · {plural(negativos, 'item com saldo negativo', 'itens com saldo negativo')}</span>
                  ) : null}
                </p>
                {w.note ? <p className="mt-1 text-xs">{w.note}</p> : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {w.active ? (
                    <Button variant="outline" size="sm" className="h-9" onClick={() => onVerEnderecos(w.id)}>
                      <MapPin className="size-4" aria-hidden /> Endereços
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => setForm({ id: w.id, nome: w.name, codigo: w.code ?? '', obs: w.note ?? '' })}
                  >
                    <Pencil className="size-4" aria-hidden /> Editar
                  </Button>
                  {w.active && !w.isDefault ? (
                    <Button variant="outline" size="sm" className="h-9" onClick={() => setPadraoAlvo(w)} disabled={mexendo === w.id}>
                      <Star className="size-4" aria-hidden /> Tornar padrão
                    </Button>
                  ) : null}
                  {w.isDefault ? null : w.active ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 text-destructive hover:text-destructive"
                      onClick={() => void alternarAtivo(w, false)}
                      disabled={mexendo === w.id}
                    >
                      <Ban className="size-4" aria-hidden /> Desativar
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="h-9" onClick={() => void alternarAtivo(w, true)} disabled={mexendo === w.id}>
                      <RotateCcw className="size-4" aria-hidden /> Reativar
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={form != null} onOpenChange={(o) => !o && !salvando && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form?.id ? `Editar ${form.nome || 'setor'}` : 'Novo setor'}</DialogTitle>
            <DialogDescription>Ex.: Centro Cirúrgico, SPA, Consultório.</DialogDescription>
          </DialogHeader>
          {form ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="setor-nome">Nome</Label>
                  <Input
                    id="setor-nome"
                    autoFocus
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                    placeholder="Centro Cirúrgico"
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="setor-codigo">Código</Label>
                  <Input
                    id="setor-codigo"
                    value={form.codigo}
                    onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                    placeholder="CC"
                    className="h-10 uppercase"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setor-obs">Observação (opcional)</Label>
                <Textarea id="setor-obs" rows={2} value={form.obs} onChange={(e) => setForm({ ...form, obs: e.target.value })} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setForm(null)} disabled={salvando}>
              Cancelar
            </Button>
            <Button className="h-9" onClick={() => void salvar()} disabled={salvando || (form?.nome.trim().length ?? 0) < 2}>
              {salvando ? 'Salvando…' : form?.id ? 'Salvar' : 'Criar setor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={padraoAlvo != null}
        onOpenChange={(open) => !open && setPadraoAlvo(null)}
        title={`Tornar ${padraoAlvo?.name ?? 'este setor'} o padrão?`}
        description={`Entrada de nota e kit sem setor escolhido passam a cair em ${padraoAlvo?.name ?? 'este setor'}. O que já foi lançado continua no setor onde está.`}
        confirmLabel="Tornar padrão"
        cancelLabel="Voltar"
        variant="default"
        icon={Star}
        onConfirm={() => padraoAlvo && void tornarPadrao(padraoAlvo)}
      />
    </div>
  )
}

// ================================================================ etiquetas

type Etiqueta = { codigo: string; descricao: string | null; itens: string[] }

/**
 * Folha A4 com 6 etiquetas grandes (2 x 3), para colar na prateleira. O código é o que se lê de
 * longe; os itens ajudam quem cobre folga a achar o armário sem abrir o sistema.
 */
function htmlEtiquetas(setorNome: string, etiquetas: Etiqueta[]): string {
  const POR_FOLHA = 6
  const MAX_ITENS = 6
  // Código comprido encolhe para não cortar na borda da etiqueta.
  const fonte = (c: string) => (c.length <= 4 ? 60 : c.length <= 6 ? 50 : c.length <= 9 ? 38 : 28)

  const etiqueta = (e: Etiqueta) => {
    const mostrar = e.itens.slice(0, MAX_ITENS)
    const resto = e.itens.length - mostrar.length
    const itens = mostrar.length
      ? `<ul class="itens">${mostrar.map((n) => `<li>${escaparHtml(n)}</li>`).join('')}${
          resto > 0 ? `<li class="mais">e mais ${plural(resto, 'item', 'itens')}</li>` : ''
        }</ul>`
      : ''
    return `<div class="etq">
      <div class="setor">${escaparHtml(setorNome)}</div>
      <div class="codigo" style="font-size:${fonte(e.codigo)}pt">${escaparHtml(e.codigo)}</div>
      ${e.descricao ? `<div class="desc">${escaparHtml(e.descricao)}</div>` : ''}
      ${itens}
    </div>`
  }

  const folhas: string[] = []
  for (let i = 0; i < etiquetas.length; i += POR_FOLHA) {
    folhas.push(`<section class="folha">${etiquetas.slice(i, i + POR_FOLHA).map(etiqueta).join('')}</section>`)
  }

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Etiquetas de endereço - ${escaparHtml(setorNome)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  html { color-scheme: light; background: #fff; }
  html, body { margin: 0; }
  body { background: #fff; color: #252A33; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .folha { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(3, 86mm); gap: 6mm;
    break-after: page; page-break-after: always; }
  .folha:last-child { break-after: auto; page-break-after: auto; }
  .etq { border: 1.2px dashed #9a9ca1; border-radius: 3mm; padding: 5mm 6mm; overflow: hidden; display: flex; flex-direction: column; min-width: 0; }
  .setor { font-size: 10pt; font-weight: 600; text-transform: uppercase; letter-spacing: .12em; color: #6b6f76; }
  .codigo { font-weight: 800; line-height: 1; letter-spacing: .01em; margin: 2mm 0 2mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .desc { font-size: 13pt; font-weight: 600; margin-bottom: 2.5mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .itens { list-style: none; margin: 0; padding: 2mm 0 0; border-top: 1px solid #DCDBD1; font-size: 9.5pt; line-height: 1.35; }
  .itens li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .itens .mais { color: #6b6f76; font-style: italic; }
</style></head><body>${folhas.join('')}</body></html>`
}
