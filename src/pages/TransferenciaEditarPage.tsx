import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, ArrowLeftRight, History, PackageMinus, Save } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { SearchPicker } from '@/components/ui/search-picker'
import { Skeleton } from '@/components/ui/skeleton'
import { DiaDoUso, LinhaLevouUsou } from '@/components/estoque/LevouUsou'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { formatQtd, produtosParaBusca } from '@/components/kits/kitUi'
import { beep } from '@/lib/beep'
import { combinaBusca } from '@/lib/busca'
import { diaLocal, hojeLocal } from '@/lib/diaLocal'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import {
  type LinhaLevouUsou as Linha,
  ROTULO_SITUACAO,
  diaValido,
  linhasAlteradas,
  rotuloDoDia,
  situacaoDaTransferencia,
} from '@/lib/transferenciaUso'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import {
  type EventoDaTransferencia,
  type StockTransfer,
  buscarTransferencia,
  editarTransferencia,
  historicoDaTransferencia,
} from '@/services/estoqueArmazens'

const LISTA = '/transferencias-estoque'
const diaBr = (d: string) => d.split('-').reverse().join('/')
const quandoCurto = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const TEXTO_EVENTO: Record<EventoDaTransferencia['tipo'], string> = {
  levou: 'levou',
  voltou: 'voltou para a origem',
  usou: 'usou (baixa)',
  desfez_uso: 'usou menos, voltou ao setor',
  cancelou: 'cancelado',
}

/**
 * /transferencias-estoque/:id: dar baixa no que o setor usou e corrigir a transferência (pedido
 * de 24/09/2026: "temos que editar as transferências também"). A tela manda como cada item tem
 * que ficar e o banco grava só a diferença, no dia escolhido.
 */
export function TransferenciaEditarPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const hoje = hojeLocal()

  const [transferencia, setTransferencia] = useState<StockTransfer | null>(null)
  const [items, setItems] = useState<StockItem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [original, setOriginal] = useState<Linha[]>([])
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [dia, setDia] = useState(hoje)
  const [note, setNote] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [termo, setTermo] = useState('')
  const [historico, setHistorico] = useState<EventoDaTransferencia[] | null>(null)

  useEffect(() => {
    let vivo = true
    Promise.all([buscarTransferencia(id), listStockItems(true)])
      .then(([t, it]) => {
        if (!vivo) return
        setTransferencia(t)
        setItems(it)
        const base = (t?.items ?? []).filter((i) => i.qty > 0).map((i) => ({ itemId: i.itemId, qty: i.qty, usado: i.usado }))
        setOriginal(base)
        setLinhas(base)
        setNote(t?.note ?? '')
        setErro(null)
        if (t) {
          historicoDaTransferencia(t)
            .then((h) => vivo && setHistorico(h))
            .catch(() => vivo && setHistorico([]))
        }
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : 'Falha ao carregar a transferência'))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [id])

  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const ativos = useMemo(() => items.filter((i) => i.active), [items])
  const busca = useMemo(() => produtosParaBusca(ativos), [ativos])
  const antesPorItem = useMemo(() => new Map(original.map((l) => [l.itemId, l] as const)), [original])

  const alteradas = linhasAlteradas(original, linhas)
  const notaMudou = transferencia != null && note.trim() !== (transferencia.note ?? '')
  const temMudanca = alteradas.length > 0 || notaMudou
  // A busca filtra a lista; "Usou tudo" vale só para o que está na tela.
  const visiveis = linhas.filter((l) => combinaBusca(termo, porId.get(l.itemId)?.name, porId.get(l.itemId)?.sku, porId.get(l.itemId)?.barcode))
  const idsVisiveis = new Set(visiveis.map((l) => l.itemId))
  const todasUsadas = visiveis.some((l) => l.qty > 0) && visiveis.every((l) => l.qty <= 0 || l.usado >= l.qty)

  // O que vai acontecer no estoque, dito antes de salvar.
  const resumo = useMemo(() => {
    let baixa = 0
    let voltaSetor = 0
    let levaMais = 0
    let voltaOrigem = 0
    for (const l of alteradas) {
      const a = antesPorItem.get(l.itemId) ?? { qty: 0, usado: 0 }
      if (l.usado > a.usado) baixa++
      if (l.usado < a.usado) voltaSetor++
      if (l.qty > a.qty) levaMais++
      if (l.qty < a.qty) voltaOrigem++
    }
    return { baixa, voltaSetor, levaMais, voltaOrigem }
  }, [alteradas, antesPorItem])

  const incluir = (item: StockItem) => {
    beep(true)
    setLinhas((prev) => {
      const i = prev.findIndex((l) => l.itemId === item.id)
      if (i >= 0) return prev.map((l, j) => (j === i ? { ...l, qty: l.qty + 1, usado: l.usado >= l.qty ? l.usado + 1 : l.usado } : l))
      return [{ itemId: item.id, qty: 1, usado: 0 }, ...prev]
    })
  }

  const onCode = (code: string) => {
    const item = acharItemPorCodigo(ativos, code)
    if (!item) {
      beep(false)
      setCodigo(code)
      return
    }
    incluir(item)
  }

  const salvar = async () => {
    if (!transferencia || !temMudanca) return
    if (!diaValido(dia, hoje)) {
      toast.error('Confira o dia: entre hoje e 30 dias atrás.')
      return
    }
    setSalvando(true)
    try {
      await editarTransferencia({
        id: transferencia.id,
        dia,
        note: notaMudou ? note : undefined,
        items: alteradas,
      })
      toast.success(resumo.baixa > 0 ? 'Baixa registrada.' : 'Transferência atualizada.')
      navigate(LISTA)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const voltar = (
    <Link
      to={LISTA}
      className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
    >
      <ArrowLeft className="size-4" aria-hidden /> Transferência e uso
    </Link>
  )

  if (carregando || erro || !transferencia) {
    return (
      <AppLayout title="Dar baixa e editar">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          {voltar}
          {carregando ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-72 w-full rounded-xl" />
            </div>
          ) : erro ? (
            <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              {erro}
            </div>
          ) : (
            <EmptyState icon={ArrowLeftRight} title="Transferência não encontrada" description="Volte para a lista e abra de novo." />
          )}
        </div>
      </AppLayout>
    )
  }

  const sit = situacaoDaTransferencia(transferencia)
  const diaT = transferencia.feitoEm ?? diaLocal(transferencia.createdAt)
  const cancelada = transferencia.cancelledAt != null
  const nomeDestino = transferencia.toName

  return (
    <AppLayout
      title="Dar baixa e editar"
      subtitle={`${transferencia.fromName} → ${nomeDestino} · dia ${diaBr(diaT)} · ${ROTULO_SITUACAO[sit]}`}
    >
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {voltar}

        {cancelada ? (
          <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            Esta transferência foi cancelada{transferencia.cancelReason ? `: ${transferencia.cancelReason}` : ''}. Não dá para editar.
          </p>
        ) : null}

        <section className="space-y-4 rounded-xl border border-border bg-card p-3 sm:p-4">
          <p className="text-sm text-muted-foreground">
            "Levou" é o que saiu de {transferencia.fromName} para {nomeDestino}. "Usou" dá baixa: sai do estoque de {nomeDestino}.
            O resto continua guardado lá.
          </p>

          {!cancelada ? (
            <DiaDoUso
              dia={dia}
              hoje={hoje}
              onChange={setDia}
              rotulo="Dia do uso"
              ajuda="A baixa entra neste dia. Usou ontem? Toque em Ontem."
            />
          ) : null}

          {!cancelada ? (
            <div className="space-y-2 border-t border-border pt-4">
              <Label>Levou mais alguma coisa?</Label>
              <ScanBar onCode={onCode} placeholder="Bipe o item" />
              <SearchPicker
                title="Buscar item"
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
          ) : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Itens</Label>
              {!cancelada && linhas.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() =>
                    setLinhas((prev) => prev.map((l) => (idsVisiveis.has(l.itemId) ? { ...l, usado: todasUsadas ? 0 : l.qty } : l)))
                  }
                >
                  <PackageMinus className="size-4" aria-hidden />
                  {todasUsadas ? 'Nada foi usado' : 'Usou tudo'}
                  {termo.trim() ? ' (dos filtrados)' : ''}
                </Button>
              ) : null}
            </div>
            {linhas.length > 5 ? (
              <SearchField value={termo} onChange={setTermo} label="Buscar item nesta transferência" resultados={visiveis.length} />
            ) : null}
            {linhas.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhum item nesta transferência.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {visiveis.map((l) => {
                  const item = porId.get(l.itemId)
                  const unidade = item?.unit ?? 'un'
                  const antes = antesPorItem.get(l.itemId)
                  const mudou = antes == null || antes.qty !== l.qty || antes.usado !== l.usado
                  return (
                    <LinhaLevouUsou
                      key={l.itemId}
                      itemId={l.itemId}
                      nome={item?.name ?? 'Item'}
                      unidade={unidade}
                      levou={l.qty}
                      usou={l.usado}
                      bloqueado={cancelada}
                      onChange={({ levou, usou }) => {
                        if (cancelada) return
                        setLinhas((prev) => prev.map((x) => (x.itemId === l.itemId ? { ...x, qty: levou, usado: usou } : x)))
                      }}
                      onRemover={
                        cancelada
                          ? undefined
                          : () =>
                              setLinhas((prev) =>
                                antes
                                  ? prev.map((x) => (x.itemId === l.itemId ? { ...x, qty: 0, usado: 0 } : x))
                                  : prev.filter((x) => x.itemId !== l.itemId),
                              )
                      }
                      detalhe={
                        antes == null
                          ? `novo: sai de ${transferencia.fromName}`
                          : mudou
                            ? `antes: levou ${formatQtd(antes.qty)} · usou ${formatQtd(antes.usado)}`
                            : null
                      }
                    />
                  )
                })}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="obs-transferencia">Observação</Label>
            <Input
              id="obs-transferencia"
              value={note}
              disabled={cancelada}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opcional"
              className="h-9"
            />
          </div>

          {!cancelada && alteradas.length > 0 ? (
            <ul className="space-y-0.5 rounded-lg bg-muted/50 px-3 py-2 text-xs">
              {resumo.baixa > 0 ? (
                <li>
                  Baixa de {resumo.baixa} {resumo.baixa === 1 ? 'item' : 'itens'} no estoque de {nomeDestino}, dia{' '}
                  {rotuloDoDia(dia, hoje)}.
                </li>
              ) : null}
              {resumo.voltaSetor > 0 ? (
                <li>
                  {resumo.voltaSetor} {resumo.voltaSetor === 1 ? 'item volta' : 'itens voltam'} para o estoque de {nomeDestino} (usou menos).
                </li>
              ) : null}
              {resumo.levaMais > 0 ? (
                <li>
                  {resumo.levaMais} {resumo.levaMais === 1 ? 'item sai' : 'itens saem'} de {transferencia.fromName} para {nomeDestino}.
                </li>
              ) : null}
              {resumo.voltaOrigem > 0 ? (
                <li>
                  {resumo.voltaOrigem} {resumo.voltaOrigem === 1 ? 'item volta' : 'itens voltam'} de {nomeDestino} para {transferencia.fromName}.
                </li>
              ) : null}
            </ul>
          ) : null}

          {!cancelada ? (
            <Button className="h-10 w-full" onClick={() => void salvar()} disabled={salvando || !temMudanca || !diaValido(dia, hoje)}>
              <Save className="size-4" aria-hidden />
              {salvando ? 'Salvando…' : !temMudanca ? 'Nada mudou' : resumo.baixa > 0 ? 'Salvar e dar baixa' : 'Salvar'}
            </Button>
          ) : null}
        </section>

        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <History className="size-4 text-muted-foreground" aria-hidden /> Histórico desta transferência
          </h2>
          <p className="text-xs text-muted-foreground">
            Nada se apaga: cada correção é um lançamento novo no estoque, com quem fez. Também aparece na ficha de cada item.
          </p>
          {historico == null || historico.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              {historico == null ? 'Carregando o histórico…' : 'Nenhum lançamento encontrado.'}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card text-xs">
              {historico.map((e) => {
                const item = porId.get(e.itemId)
                const lancado = e.observacao?.match(/lançado (\d{2}\/\d{2} \d{2}:\d{2})/)?.[1]
                return (
                  <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{item?.name ?? 'Item'}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {TEXTO_EVENTO[e.tipo]} {formatQtd(Math.abs(e.qtd))} {item?.unit ?? ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {lancado ? `dia ${diaBr(diaLocal(e.quando))}, lançado ${lancado}` : quandoCurto(e.quando)}
                      {e.autor ? ` · ${e.autor}` : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <VincularCodigoDialog
        codigo={codigo}
        itens={ativos}
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
