import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpFromLine,
  MapPin,
  PackageX,
  Pencil,
  ShieldAlert,
  Undo2,
  X,
} from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { ExportarMenu } from '@/components/page/ExportarMenu'
import { SubTabs } from '@/components/page/SubTabs'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ComprasDoItem, LotesDoItem } from '@/components/estoque/ComprasELotesDoItem'
import { FiltrosDoKardex, KardexDoItem } from '@/components/estoque/KardexDoItem'
import { ROTULO_GRUPO, dataDia, dataHora } from '@/components/estoque/kardexUi'
import { formatBRL, formatQtd } from '@/components/kits/kitUi'
import { estoqueTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { diaLocal, diaLocalComOffset, hojeLocal } from '@/lib/diaLocal'
import { exportarExcel, exportarPdf } from '@/lib/exportar'
import {
  FILTRO_KARDEX_VAZIO,
  type FiltroKardex,
  type LinhaKardex,
  comprasDoItem,
  consumoDesde,
  filtrarKardex,
  lotesDoItem,
  rotuloOrigem,
  saldoAnterior,
  saldosPorSetor,
} from '@/lib/kardex'
import { cn } from '@/lib/utils'
import { type StockItem, getStockItem } from '@/services/estoqueCompras'
import { type StockWarehouse, listWarehouses } from '@/services/estoqueArmazens'
import {
  type JuncaoDoItem,
  desfazerJuncao,
  listarItensJuntadosNele,
  listarJuncoesDoItem,
} from '@/services/estoqueJuncao'
import {
  type EnderecoEstoque,
  type ItemNoEndereco,
  compararCodigoEndereco,
  estornarMovimento,
  guardarItemNoEndereco,
  listarEnderecos,
  listarItensNosEnderecos,
  listarKardex,
  tirarItemDoEndereco,
} from '@/services/estoqueRastreio'

const ABAS = ['kardex', 'compras', 'lotes'] as const
type Aba = (typeof ABAS)[number]

type ItemDaFicha = StockItem & { lastCostCents: number | null }

/**
 * Ficha do item: de qual nota veio, por onde passou, em que setor e lote está, onde fica e
 * para quais pacientes saiu. Nasceu do print do Álvaro (17/09): o histórico do ABOCATH Nº22
 * mostrava só "+106 inventário", sem a nota que comprou. A nota existia, gravada no item com o
 * nome do fornecedor que a contagem juntou nele; nenhuma tela seguia essa ligação.
 */
export function EstoqueItemPage() {
  const { itemId = '' } = useParams()
  const { tenant, canViewFinance } = useTenant()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const aba: Aba = ABAS.includes(params.get('aba') as Aba) ? (params.get('aba') as Aba) : 'kardex'
  const irPara = useCallback(
    (a: Aba) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('aba', a)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const [item, setItem] = useState<ItemDaFicha | null>(null)
  const [linhas, setLinhas] = useState<LinhaKardex[]>([])
  const [setores, setSetores] = useState<StockWarehouse[]>([])
  const [enderecos, setEnderecos] = useState<EnderecoEstoque[]>([])
  const [guardados, setGuardados] = useState<ItemNoEndereco[]>([])
  const [juntados, setJuntados] = useState<Array<{ id: string; nome: string }>>([])
  const [juncoes, setJuncoes] = useState<JuncaoDoItem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroKardex>(FILTRO_KARDEX_VAZIO)

  const [estornando, setEstornando] = useState<LinhaKardex | null>(null)
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [novoEndereco, setNovoEndereco] = useState('')
  const [desfazendo, setDesfazendo] = useState<JuncaoDoItem | null>(null)

  const carregar = useCallback(async () => {
    try {
      const [it, kardex, whs, ends, guard, filhos, jun] = await Promise.all([
        getStockItem(itemId),
        listarKardex(itemId),
        listWarehouses(),
        listarEnderecos(),
        listarItensNosEnderecos(),
        listarItensJuntadosNele(itemId),
        listarJuncoesDoItem(itemId),
      ])
      setItem(it)
      setLinhas(kardex)
      setSetores(whs)
      setEnderecos(ends)
      setGuardados(guard.filter((g) => g.itemId === itemId))
      setJuntados(filhos)
      setJuncoes(jun)
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o item')
    } finally {
      setCarregando(false)
    }
  }, [itemId])

  useEffect(() => {
    // Trocou de item (link de item juntado, voltar): esqueleto e filtro do zero, depois carrega.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCarregando(true)
    setFiltro(FILTRO_KARDEX_VAZIO)
    void carregar()
  }, [carregar])

  const hoje = hojeLocal()
  const unidade = item?.unit ?? 'un'
  const filtradas = useMemo(() => filtrarKardex(linhas, filtro), [linhas, filtro])
  const compras = useMemo(() => comprasDoItem(linhas), [linhas])
  const lotes = useMemo(() => lotesDoItem(linhas, hoje), [linhas, hoje])
  const porSetor = useMemo(() => saldosPorSetor(linhas).filter((s) => s.qtd !== 0), [linhas])
  const saldo = linhas.length > 0 ? linhas[0].saldo : (item?.qty ?? 0)
  const consumo30 = useMemo(() => consumoDesde(linhas, diaLocalComOffset(-30)), [linhas])
  const consumo90 = useMemo(() => consumoDesde(linhas, diaLocalComOffset(-90)), [linhas])
  const diasDeEstoque = consumo90 > 0 && saldo > 0 ? Math.floor(saldo / (consumo90 / 90)) : null
  const lotesVencidosComSaldo = lotes.filter((l) => l.vencido && l.saldo > 0)

  const resumoPeriodo = useMemo(() => {
    const entradas = filtradas.reduce((s, l) => s + (l.qtd > 0 ? l.qtd : 0), 0)
    const saidas = filtradas.reduce((s, l) => s + (l.qtd < 0 ? -l.qtd : 0), 0)
    const anterior = saldoAnterior(linhas, filtro.de, filtro.setorId)
    const ateLinha = filtro.ate
      ? linhas.find((l) => diaLocal(l.criadoEm) <= filtro.ate! && (!filtro.setorId || l.setorId === filtro.setorId))
      : linhas.find((l) => !filtro.setorId || l.setorId === filtro.setorId)
    const final = ateLinha ? (filtro.setorId ? ateLinha.saldoSetor : ateLinha.saldo) : 0
    return { entradas, saidas, anterior, final }
  }, [filtradas, linhas, filtro])

  const enderecoPorId = useMemo(() => new Map(enderecos.map((e) => [e.id, e] as const)), [enderecos])
  const setorPorId = useMemo(() => new Map(setores.map((s) => [s.id, s] as const)), [setores])
  const enderecosDoItem = guardados
    .map((g) => ({ vinculo: g, endereco: enderecoPorId.get(g.enderecoId) }))
    .filter((x): x is { vinculo: ItemNoEndereco; endereco: EnderecoEstoque } => Boolean(x.endereco))
    .sort((a, b) => compararCodigoEndereco(a.endereco.codigo, b.endereco.codigo))
  const enderecosLivres = enderecos
    .filter((e) => !guardados.some((g) => g.enderecoId === e.id))
    .sort(
      (a, b) =>
        (setorPorId.get(a.setorId)?.name ?? '').localeCompare(setorPorId.get(b.setorId)?.name ?? '', 'pt-BR') ||
        compararCodigoEndereco(a.codigo, b.codigo),
    )
  const rotuloEndereco = (e: EnderecoEstoque) =>
    `${setorPorId.get(e.setorId)?.name ?? 'Setor'} · ${e.codigo}${e.descricao ? ` (${e.descricao})` : ''}`

  const confirmarEstorno = async () => {
    if (!estornando) return
    setSalvando(true)
    try {
      await estornarMovimento(estornando.id, motivo)
      toast.success('Lançamento estornado. O original continua no histórico.')
      setEstornando(null)
      setMotivo('')
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao estornar')
    } finally {
      setSalvando(false)
    }
  }

  const guardar = async (enderecoId: string) => {
    try {
      await guardarItemNoEndereco(itemId, enderecoId)
      setNovoEndereco('')
      setGuardados((await listarItensNosEnderecos()).filter((g) => g.itemId === itemId))
      toast.success('Endereço guardado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao guardar endereço')
    }
  }

  const tirar = async (vinculoId: string) => {
    try {
      await tirarItemDoEndereco(vinculoId)
      setGuardados((prev) => prev.filter((g) => g.id !== vinculoId))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao tirar do endereço')
    }
  }

  const confirmarDesfazer = async () => {
    if (!desfazendo) return
    setSalvando(true)
    try {
      await desfazerJuncao(desfazendo.id)
      toast.success(`"${desfazendo.origemNome}" voltou a ser um item separado.`)
      setDesfazendo(null)
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao desfazer')
    } finally {
      setSalvando(false)
    }
  }

  const linhasExport = () =>
    filtradas.map((l) => {
      const { titulo, detalhe } = rotuloOrigem(l.origem)
      return [
        dataHora(l.criadoEm),
        l.seq,
        titulo,
        [detalhe, l.itemNome !== item?.name ? `entrou como ${l.itemNome}` : null].filter(Boolean).join(' · '),
        l.setorNome ?? '',
        l.lote ?? '',
        dataDia(l.validade),
        l.loteOrigem?.numero ? `NF ${l.loteOrigem.numero}` : '',
        l.qtd > 0 ? l.qtd : '',
        l.qtd < 0 ? -l.qtd : '',
        filtro.setorId ? l.saldoSetor : l.saldo,
        l.custoUnitCents != null ? l.custoUnitCents / 100 : '',
        l.autor ?? 'sistema',
        l.estornadoPor ? 'estornado' : '',
        [l.motivo, l.observacao].filter(Boolean).join(' · '),
      ]
    })
  const colunasKardex = ['Data', 'Nº', 'Operação', 'Detalhe', 'Setor', 'Lote', 'Validade', 'Nota do lote', 'Entrada', 'Saída', 'Saldo', 'Custo un. (R$)', 'Quem', 'Situação', 'Observação']
  const recorte = [
    filtro.de || filtro.ate ? `${filtro.de ? dataDia(filtro.de) : 'início'} a ${filtro.ate ? dataDia(filtro.ate) : 'hoje'}` : 'todo o histórico',
    filtro.setorId ? setorPorId.get(filtro.setorId)?.name : 'todos os setores',
    filtro.grupo !== 'tudo' ? ROTULO_GRUPO[filtro.grupo].toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(' · ')

  if (!carregando && !erro && !item) {
    return (
      <AppLayout title="Item não encontrado">
        <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />
        <EmptyState icon={PackageX} title="Este item não existe neste polo" description="Volte ao estoque e abra o item pela lista." />
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title={item?.name ?? 'Item do estoque'}
      subtitle="De qual nota veio, onde está e para onde foi"
      actions={
        item ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Link to={`/estoque?item=${item.id}&acao=entrada`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9')}>
              <ArrowDownToLine className="size-4" aria-hidden /> <span className="hidden sm:inline">Entrada</span>
            </Link>
            <Link to={`/estoque?item=${item.id}&acao=saida`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9')}>
              <ArrowUpFromLine className="size-4" aria-hidden /> <span className="hidden sm:inline">Saída</span>
            </Link>
            <Link to="/transferencias-estoque" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9')}>
              <ArrowLeftRight className="size-4" aria-hidden /> <span className="hidden sm:inline">Transferir</span>
            </Link>
            <Link to={`/estoque?item=${item.id}&acao=editar`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9')}>
              <Pencil className="size-4" aria-hidden /> <span className="hidden sm:inline">Cadastro</span>
            </Link>
            <ExportarMenu
              disabled={linhas.length === 0}
              onExcel={() =>
                exportarExcel(`kardex-${item.name}`.slice(0, 60), [
                  { nome: 'Kardex', colunas: colunasKardex, linhas: linhasExport() },
                  {
                    nome: 'Compras',
                    colunas: ['Nota', 'Fornecedor', 'Emissão', 'Entrada no estoque', 'Quantidade', 'Custo médio (R$)', 'Total (R$)', 'Lotes', 'Nome na nota', 'Chave NF-e'],
                    linhas: compras.map((c) => [
                      c.origem.tipo === 'nota' ? c.origem.numero ?? '' : 'Ordem de compra',
                      c.origem.tipo === 'nota' ? c.origem.fornecedor ?? '' : c.origem.responsavel ?? '',
                      c.origem.tipo === 'nota' ? dataDia(c.origem.emissao) : '',
                      dataHora(c.entradaEm),
                      c.qtd,
                      c.custoMedioCents != null ? c.custoMedioCents / 100 : '',
                      c.totalCents != null ? c.totalCents / 100 : '',
                      c.lotes.map((l) => l.lote).join(', '),
                      c.nomes.join(' · '),
                      c.origem.tipo === 'nota' ? c.origem.chave ?? '' : '',
                    ]),
                  },
                  {
                    nome: 'Lotes',
                    colunas: ['Lote', 'Validade', 'Saldo', 'Setores', 'Nota', 'Fornecedor', 'Pacientes (kits)'],
                    linhas: lotes.map((l) => [
                      l.lote,
                      dataDia(l.validade),
                      l.saldo,
                      l.setores.map((s) => `${s.setorNome} ${s.qtd}`).join(' · '),
                      l.nota?.numero ?? '',
                      l.nota?.fornecedor ?? '',
                      l.pacientes.map((p) => `${p.paciente ?? 'sem paciente'} (${dataDia(p.data)}, ${p.qtd})`).join('; '),
                    ]),
                  },
                ])
              }
              onPdf={() =>
                exportarPdf({
                  titulo: `Kardex · ${item.name}`,
                  subtitulo: `${tenant.name} · ${recorte}`,
                  resumo: [
                    ...(resumoPeriodo.anterior != null ? [{ rotulo: 'Saldo anterior', valor: `${formatQtd(resumoPeriodo.anterior)} ${unidade}` }] : []),
                    { rotulo: 'Entradas', valor: `${formatQtd(resumoPeriodo.entradas)} ${unidade}` },
                    { rotulo: 'Saídas', valor: `${formatQtd(resumoPeriodo.saidas)} ${unidade}` },
                    { rotulo: 'Saldo final', valor: `${formatQtd(resumoPeriodo.final)} ${unidade}` },
                  ],
                  colunas: colunasKardex,
                  numericas: [1, 8, 9, 10, 11],
                  linhas: linhasExport(),
                })
              }
            />
          </div>
        ) : null
      }
    >
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />

      <div className="mb-3">
        <button
          type="button"
          onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/estoque'))}
          className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Voltar
        </button>
      </div>

      {erro ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {erro}
        </div>
      ) : carregando || !item ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-4">
          {item.replacedBy ? (
            <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm">
              Este cadastro veio de nota e foi juntado em outro item.{' '}
              <Link to={`/estoque/item/${item.replacedBy}`} className="font-semibold text-primary hover:underline">
                Abrir o item que a equipe usa
              </Link>
            </div>
          ) : null}
          {!item.active && !item.replacedBy ? (
            <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">Item desativado.</div>
          ) : null}

          <section className="rounded-xl border border-border bg-card p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {item.category ? <Badge variant="secondary">{item.category}</Badge> : null}
              <Badge variant="outline">unidade {item.unit}</Badge>
              {item.barcode ? <Badge variant="outline" className="font-mono">{item.barcode}</Badge> : null}
              {item.sku ? <Badge variant="outline">SKU {item.sku}</Badge> : null}
              {item.controlled ? (
                <Badge variant="destructive">
                  <ShieldAlert aria-hidden /> controlado
                </Badge>
              ) : null}
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-lg bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Saldo</dt>
                <dd className={cn('text-xl font-bold tabular-nums', saldo < 0 && 'text-destructive')}>
                  {formatQtd(saldo)} <span className="text-sm font-medium">{unidade}</span>
                </dd>
                <dd className={cn('text-xs text-muted-foreground', item.minQty > 0 && saldo < item.minQty && 'font-semibold text-destructive')}>
                  {item.minQty > 0 ? `mínimo ${formatQtd(item.minQty)}` : 'sem mínimo definido'}
                </dd>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Valor em estoque</dt>
                <dd className="text-xl font-bold tabular-nums">
                  {item.lastCostCents != null && saldo > 0 ? formatBRL(Math.round(saldo * item.lastCostCents)) : 'sem custo'}
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {item.lastCostCents != null ? `último custo ${formatBRL(item.lastCostCents)}/${unidade}` : 'nunca comprado por nota'}
                </dd>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Última compra</dt>
                {compras[0] ? (
                  <>
                    <dd className="truncate text-xl font-bold tabular-nums">
                      {compras[0].origem.tipo === 'nota' ? `NF ${compras[0].origem.numero ?? ''}` : 'Ordem'}
                    </dd>
                    <dd className="truncate text-xs text-muted-foreground">
                      {dataHora(compras[0].entradaEm).slice(0, 8)}
                      {compras[0].origem.tipo === 'nota' && compras[0].origem.fornecedor ? ` · ${compras[0].origem.fornecedor}` : ''}
                    </dd>
                  </>
                ) : (
                  <>
                    <dd className="text-xl font-bold">nenhuma</dd>
                    <dd>
                      <Link to={`/estoque/item/${item.id}/juntar`} className="text-xs text-primary hover:underline">
                        procurar a nota
                      </Link>
                    </dd>
                  </>
                )}
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <dt className="text-xs text-muted-foreground">Consumo</dt>
                <dd className="text-xl font-bold tabular-nums">
                  {formatQtd(consumo30)} <span className="text-sm font-medium">em 30 dias</span>
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {formatQtd(consumo90)} em 90 dias
                  {diasDeEstoque != null ? ` · dá para ~${diasDeEstoque} dias` : ''}
                </dd>
              </div>
            </dl>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saldo por setor</p>
                {porSetor.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem saldo em nenhum setor.</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {porSetor.map((s) => (
                      <li key={s.setorId ?? 'sem'}>
                        <button
                          type="button"
                          onClick={() => {
                            setFiltro({ ...filtro, setorId: s.setorId })
                            irPara('kardex')
                          }}
                          className={cn(
                            'rounded-lg border px-2.5 py-1.5 text-sm hover:bg-muted',
                            filtro.setorId === s.setorId ? 'border-primary bg-primary/10' : 'border-border',
                          )}
                          title="Ver o histórico só deste setor"
                        >
                          {s.setorNome} <strong className={cn('tabular-nums', s.qtd < 0 && 'text-destructive')}>{formatQtd(s.qtd)}</strong>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Onde fica</span>
                  <Link to="/estoque-enderecos" className="font-normal normal-case tracking-normal text-primary hover:underline">
                    endereços dos setores
                  </Link>
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {enderecosDoItem.map(({ vinculo, endereco }) => (
                    <span key={vinculo.id} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm">
                      <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                      {setorPorId.get(endereco.setorId)?.name} · <strong>{endereco.codigo}</strong>
                      <button
                        type="button"
                        onClick={() => void tirar(vinculo.id)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Tirar do endereço ${endereco.codigo}`}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  ))}
                  {enderecos.length === 0 ? (
                    <span className="text-sm text-muted-foreground">Nenhum endereço cadastrado nos setores ainda.</span>
                  ) : enderecosLivres.length > 0 ? (
                    <Select value={novoEndereco} onValueChange={(v) => v && void guardar(v)}>
                      <LabeledSelectTrigger aria-label="Guardar em um endereço" className="h-8 w-full min-w-0 sm:w-56">
                        {enderecosDoItem.length === 0 ? 'Escolher onde fica' : 'Mais um endereço'}
                      </LabeledSelectTrigger>
                      <SelectContent>
                        {enderecosLivres.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {rotuloEndereco(e)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </div>
            </div>

            {lotesVencidosComSaldo.length > 0 ? (
              <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {lotesVencidosComSaldo.length === 1 ? 'Lote vencido com saldo' : `${lotesVencidosComSaldo.length} lotes vencidos com saldo`}:{' '}
                {lotesVencidosComSaldo.map((l) => `${l.lote} (${formatQtd(l.saldo)}, venceu ${dataDia(l.validade)})`).join(' · ')}
              </p>
            ) : null}

            {juntados.length > 0 ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  {juntados.length} {juntados.length === 1 ? 'cadastro de nota juntado' : 'cadastros de nota juntados'} neste item
                </summary>
                <ul className="mt-2 space-y-1">
                  {juntados.map((j) => {
                    const juncao = juncoes.find((x) => x.origemId === j.id && !x.desfeitaEm)
                    return (
                      <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5">
                        <Link to={`/estoque/item/${j.id}`} className="min-w-0 truncate hover:underline">
                          {j.nome}
                        </Link>
                        {juncao ? (
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDesfazendo(juncao)}>
                            <Undo2 className="size-3.5" aria-hidden /> Desfazer
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">juntado no inventário</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </details>
            ) : null}
          </section>

          <Tabs value={aba} onValueChange={(v) => irPara(v as Aba)}>
            <TabsList className="overflow-x-auto">
              <TabsTrigger value="kardex">Histórico ({linhas.length})</TabsTrigger>
              <TabsTrigger value="compras">Notas de compra ({compras.length})</TabsTrigger>
              <TabsTrigger value="lotes">Lotes ({lotes.filter((l) => l.saldo > 0).length})</TabsTrigger>
            </TabsList>
          </Tabs>

          {aba === 'kardex' ? (
            <section className="space-y-3">
              <FiltrosDoKardex filtro={filtro} setFiltro={setFiltro} setores={setores} resultados={filtradas.length} />
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {resumoPeriodo.anterior != null ? (
                  <div className="rounded-lg border border-border px-3 py-2">
                    <dt className="text-xs text-muted-foreground">Saldo antes de {dataDia(filtro.de)}</dt>
                    <dd className="font-semibold tabular-nums">{formatQtd(resumoPeriodo.anterior)}</dd>
                  </div>
                ) : null}
                <div className="rounded-lg border border-border px-3 py-2">
                  <dt className="text-xs text-muted-foreground">Entradas</dt>
                  <dd className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">+{formatQtd(resumoPeriodo.entradas)}</dd>
                </div>
                <div className="rounded-lg border border-border px-3 py-2">
                  <dt className="text-xs text-muted-foreground">Saídas</dt>
                  <dd className="font-semibold tabular-nums">-{formatQtd(resumoPeriodo.saidas)}</dd>
                </div>
                <div className="rounded-lg border border-border px-3 py-2">
                  <dt className="text-xs text-muted-foreground">Saldo {filtro.ate ? `em ${dataDia(filtro.ate)}` : 'agora'}</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatQtd(resumoPeriodo.final)} {unidade}
                  </dd>
                </div>
              </dl>
              <KardexDoItem
                linhas={filtradas}
                itemNome={item.name}
                unidade={unidade}
                porSetor={Boolean(filtro.setorId)}
                podeVerFinanceiro={canViewFinance}
                carregando={carregando}
                onEstornar={(l) => {
                  setMotivo('')
                  setEstornando(l)
                }}
              />
            </section>
          ) : null}

          {aba === 'compras' ? (
            <ComprasDoItem
              compras={compras}
              unidade={unidade}
              podeVerFinanceiro={canViewFinance}
              carregando={carregando}
              onJuntar={() => navigate(`/estoque/item/${item.id}/juntar`)}
            />
          ) : null}

          {aba === 'lotes' ? (
            <LotesDoItem lotes={lotes} unidade={unidade} hoje={hoje} podeVerFinanceiro={canViewFinance} carregando={carregando} />
          ) : null}
        </div>
      )}

      <Dialog open={estornando != null} onOpenChange={(open) => (!open && !salvando ? setEstornando(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Estornar lançamento</DialogTitle>
            <DialogDescription>
              {estornando
                ? `${estornando.qtd > 0 ? 'Entrada' : 'Saída'} de ${formatQtd(Math.abs(estornando.qtd))} ${unidade} em ${dataHora(estornando.criadoEm)}. Entra um lançamento contrário; o original continua no histórico.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="estorno-motivo">Motivo</Label>
            <Textarea
              id="estorno-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: lançado em dobro, quantidade errada"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEstornando(null)} disabled={salvando}>
              Voltar
            </Button>
            <Button onClick={() => void confirmarEstorno()} disabled={salvando || motivo.trim().length < 3}>
              {salvando ? 'Estornando…' : 'Estornar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={desfazendo != null} onOpenChange={(open) => (!open && !salvando ? setDesfazendo(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Separar os itens de novo</DialogTitle>
            <DialogDescription>
              {desfazendo
                ? `"${desfazendo.origemNome}" volta a ser um item separado, com o saldo, os lotes e os modelos de kit que tinha quando foi juntado.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDesfazendo(null)} disabled={salvando}>
              Voltar
            </Button>
            <Button onClick={() => void confirmarDesfazer()} disabled={salvando}>
              {salvando ? 'Separando…' : 'Separar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
