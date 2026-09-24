import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowDownUp, ArrowLeftRight, MapPin, Trash2, Undo2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { ExportarMenu } from '@/components/page/ExportarMenu'
import { Badge } from '@/components/ui/badge'
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
import { SearchField } from '@/components/ui/search-field'
import { SearchPicker } from '@/components/ui/search-picker'
import { Textarea } from '@/components/ui/textarea'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { formatQtd, produtosParaBusca, semCodigoBipado } from '@/components/kits/kitUi'
import { useTenant } from '@/context/TenantContext'
import { beep } from '@/lib/beep'
import { normalizarBusca } from '@/lib/busca'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { exportarExcel, exportarPdf } from '@/lib/exportar'
import { cn } from '@/lib/utils'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import {
  type StockTransfer,
  type StockWarehouse,
  cancelarTransferencia,
  createTransfer,
  listTransfers,
  listWarehouseBalances,
  listWarehouses,
} from '@/services/estoqueArmazens'

type Linha = { itemId: string; qty: number }

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Motivo de cancelamento precisa dizer alguma coisa: "ok" ou "..." não explica nada depois. */
const letras = (v: string) => v.replace(/[^\p{L}]/gu, '').length

/**
 * Levar material de um setor para outro (Principal → Centro Cirúrgico, SPA, Consultório,
 * Higienização). Era um select com os 1.500 itens do estoque em cada linha: ninguém acha
 * "luva 7,5" rolando uma lista. Agora é digitar ou bipar, como no resto do estoque.
 */
export function TransferenciasEstoquePage() {
  const { tenant } = useTenant()
  const [warehouses, setWarehouses] = useState<StockWarehouse[]>([])
  // Inclui inativos: transferência antiga de item consolidado ainda precisa mostrar o nome.
  const [items, setItems] = useState<StockItem[]>([])
  const [transfers, setTransfers] = useState<StockTransfer[]>([])
  const [loading, setLoading] = useState(true)

  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [note, setNote] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [saving, setSaving] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)

  // Saldo do setor de origem. Guarda de qual setor veio para não mostrar o saldo do setor
  // anterior enquanto o novo carrega.
  const [saldoOrigem, setSaldoOrigem] = useState<{ setorId: string; porItem: Map<string, number> } | null>(null)
  const [versaoSaldo, setVersaoSaldo] = useState(0)

  const [cancelando, setCancelando] = useState<StockTransfer | null>(null)
  const [motivo, setMotivo] = useState('')
  const [cancelSalvando, setCancelSalvando] = useState(false)

  const [filtroSetor, setFiltroSetor] = useState('')
  const [buscaHist, setBuscaHist] = useState('')

  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const ativos = useMemo(() => items.filter((i) => i.active), [items])
  const nomeOrigem = warehouses.find((w) => w.id === fromId)?.name ?? 'origem'
  const saldoNaOrigem = (itemId: string) =>
    saldoOrigem != null && saldoOrigem.setorId === fromId ? (saldoOrigem.porItem.get(itemId) ?? 0) : null

  // Na busca, o número ao lado do nome é o saldo no setor de onde vai sair, não o total.
  const busca = useMemo(() => {
    const base = produtosParaBusca(ativos)
    if (!saldoOrigem || saldoOrigem.setorId !== fromId) return base
    const unidade = new Map(ativos.map((i) => [i.id, i.unit] as const))
    return base.map((p) => ({ ...p, meta: `${formatQtd(saldoOrigem.porItem.get(p.id) ?? 0)} ${unidade.get(p.id) ?? 'un'}` }))
  }, [ativos, saldoOrigem, fromId])

  const load = async () => {
    try {
      const [w, it, tr] = await Promise.all([listWarehouses(), listStockItems(true), listTransfers()])
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

  useEffect(() => {
    if (!fromId) return
    let cancelado = false
    listWarehouseBalances(fromId)
      .then((saldos) => {
        if (!cancelado) setSaldoOrigem({ setorId: fromId, porItem: new Map(saldos.map((s) => [s.itemId, s.qty] as const)) })
      })
      .catch((e) => {
        if (!cancelado) toast.error(e instanceof Error ? e.message : 'Falha ao carregar o saldo do setor')
      })
    return () => {
      cancelado = true
    }
  }, [fromId, versaoSaldo])

  const incluir = (item: StockItem) => {
    beep(true)
    setLinhas((prev) => {
      const i = prev.findIndex((l) => l.itemId === item.id)
      if (i >= 0) return prev.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [{ itemId: item.id, qty: 1 }, ...prev]
    })
  }

  const onCode = (code: string) => {
    // Leitor disparado com o cursor na busca do histórico digita o código ali também.
    setBuscaHist((b) => semCodigoBipado(b, code))
    const item = acharItemPorCodigo(ativos, code)
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
      setVersaoSaldo((v) => v + 1)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na transferência')
    } finally {
      setSaving(false)
    }
  }

  const abrirCancelamento = (t: StockTransfer) => {
    setMotivo('')
    setCancelando(t)
  }

  const confirmarCancelamento = async () => {
    if (!cancelando || letras(motivo) < 3) return
    setCancelSalvando(true)
    try {
      await cancelarTransferencia(cancelando.id, motivo)
      toast.success(`Transferência cancelada. Os itens voltaram para ${cancelando.fromName}.`)
      setCancelando(null)
      setVersaoSaldo((v) => v + 1)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cancelar a transferência')
    } finally {
      setCancelSalvando(false)
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
            'min-h-9 rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            valor === w.id ? 'border-primary bg-primary/10 font-medium' : 'border-border bg-card hover:bg-muted',
          )}
        >
          {w.name}
        </button>
      ))}
    </div>
  )

  // Setores que aparecem no histórico, inclusive os já desativados.
  const setoresDoHistorico = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of transfers) {
      m.set(t.fromWarehouseId, t.fromName)
      m.set(t.toWarehouseId, t.toName)
    }
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [transfers])

  const visiveis = useMemo(() => {
    const termo = normalizarBusca(buscaHist)
    return transfers.filter((t) => {
      if (filtroSetor && t.fromWarehouseId !== filtroSetor && t.toWarehouseId !== filtroSetor) return false
      if (!termo) return true
      return t.items.some((i) => normalizarBusca(porId.get(i.itemId)?.name ?? '').includes(termo))
    })
  }, [transfers, filtroSetor, buscaHist, porId])
  const filtrando = filtroSetor !== '' || buscaHist.trim() !== ''

  const situacao = (t: StockTransfer) => (t.cancelledAt ? `Cancelada${t.cancelReason ? `: ${t.cancelReason}` : ''}` : 'Feita')
  const linhasHistorico = visiveis.flatMap((t) =>
    t.items.map((i) => [
      new Date(t.createdAt).toLocaleString('pt-BR'),
      t.fromName,
      t.toName,
      porId.get(i.itemId)?.name ?? '?',
      i.qty,
      t.note ?? '',
      situacao(t),
    ]),
  )

  return (
    <AppLayout
      title="Transferência de estoque"
      subtitle="Leve material entre setores: digite ou bipe o item, ajuste a quantidade e confirme."
      actions={
        <ExportarMenu
          disabled={visiveis.length === 0}
          onExcel={() =>
            exportarExcel('transferencias-estoque', [
              {
                nome: 'Transferências',
                colunas: ['Data', 'De', 'Para', 'Item', 'Quantidade', 'Observação', 'Situação'],
                linhas: linhasHistorico,
              },
            ])
          }
          onPdf={() =>
            exportarPdf({
              titulo: 'Transferências de estoque',
              subtitulo: tenant.name,
              colunas: ['Data', 'De', 'Para', 'Item', 'Qtd', 'Observação', 'Situação'],
              numericas: [4],
              linhas: linhasHistorico,
            })
          }
        />
      }
    >

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <section className="space-y-4 rounded-xl border border-border bg-card p-3 sm:p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Sai de</Label>
              <Link
                to="/estoque-setores"
                className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              >
                <MapPin className="size-3.5" aria-hidden /> Setores
              </Link>
            </div>
            {setores(fromId, setFromId, toId)}
          </div>
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
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
              title={`Buscar item (saldo em ${nomeOrigem})`}
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
                const unidade = item?.unit ?? 'un'
                const noSetor = saldoNaOrigem(l.itemId)
                // Só avisa: o saldo por setor ainda tem lançamento antigo sem setor, e travar aqui
                // impediria levar material que está de fato na prateleira.
                const passa = noSetor != null && l.qty > noSetor + 1e-9
                return (
                  <li key={l.itemId} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        {/* Aba nova: tocar no nome no meio da transferência não pode apagar a lista. */}
                        <Link
                          to={`/estoque/item/${l.itemId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium leading-snug hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                        >
                          {item?.name ?? 'Item'}
                        </Link>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {noSetor == null ? 'conferindo saldo no setor…' : `no setor de origem: ${formatQtd(noSetor)} ${unidade}`}
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
                    </div>
                    {passa ? (
                      <p className="mt-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">
                        O sistema registra {formatQtd(noSetor)} em {nomeOrigem}; confira antes de transferir.
                      </p>
                    ) : null}
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

        <section className="min-w-0 space-y-2">
          <h2 className="text-sm font-semibold">
            Histórico ({filtrando ? `${visiveis.length} de ${transfers.length}` : transfers.length})
          </h2>
          {transfers.length > 0 ? (
            <div className="space-y-2">
              <SearchField value={buscaHist} onChange={setBuscaHist} label="Buscar item no histórico" resultados={visiveis.length} />
              {setoresDoHistorico.length > 1 ? (
                <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filtrar por setor">
                  {[{ id: '', name: 'Todos' }, ...setoresDoHistorico].map((s) => (
                    <button
                      key={s.id || 'todos'}
                      type="button"
                      aria-pressed={filtroSetor === s.id}
                      onClick={() => setFiltroSetor(s.id)}
                      className={cn(
                        'min-h-9 shrink-0 rounded-full border px-3 text-xs font-medium',
                        filtroSetor === s.id ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {visiveis.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title={loading ? 'Carregando…' : filtrando ? 'Nenhuma transferência com esse filtro' : 'Nenhuma transferência'}
              description={filtrando ? 'Troque o setor ou a busca.' : 'As transferências confirmadas aparecem aqui.'}
            />
          ) : (
            <ul className="space-y-2">
              {visiveis.map((t) => (
                <li key={t.id} className={cn('rounded-xl border border-border bg-card p-3 text-sm', t.cancelledAt && 'bg-muted/40')}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className={cn('font-semibold', t.cancelledAt && 'text-muted-foreground line-through')}>
                          {t.fromName} → {t.toName}
                        </p>
                        {t.cancelledAt ? (
                          <Badge variant="destructive">Cancelada</Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {dataHora(t.createdAt)}
                        {t.note ? ` · ${t.note}` : ''}
                      </p>
                    </div>
                    {!t.cancelledAt ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 shrink-0 text-muted-foreground"
                        onClick={() => abrirCancelamento(t)}
                        aria-label={`Cancelar transferência de ${t.fromName} para ${t.toName}`}
                      >
                        <Undo2 className="size-4" aria-hidden /> Cancelar
                      </Button>
                    ) : null}
                  </div>
                  {t.cancelledAt ? (
                    <p className="mt-1.5 rounded-md bg-destructive/5 px-2 py-1 text-xs text-destructive">
                      Cancelada em {dataHora(t.cancelledAt)}
                      {t.cancelReason ? `: ${t.cancelReason}` : ''}
                    </p>
                  ) : null}
                  <ul className="mt-1.5 space-y-0.5 text-xs">
                    {t.items.map((i) => (
                      <li key={i.id} className="flex justify-between gap-2">
                        <Link
                          to={`/estoque/item/${i.itemId}`}
                          className="min-w-0 truncate hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                        >
                          {porId.get(i.itemId)?.name ?? 'Item removido'}
                        </Link>
                        <span className="shrink-0 tabular-nums">
                          {formatQtd(i.qty)} {porId.get(i.itemId)?.unit ?? ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={cancelando != null} onOpenChange={(open) => !open && !cancelSalvando && setCancelando(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar esta transferência?</DialogTitle>
            <DialogDescription>
              {cancelando
                ? `${cancelando.fromName} → ${cancelando.toName}, ${dataHora(cancelando.createdAt)}, ${cancelando.items.length} ${cancelando.items.length === 1 ? 'item' : 'itens'}. Ela continua no histórico como cancelada.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {cancelando ? (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              Os itens voltam para {cancelando.fromName}. Se já foram usados em {cancelando.toName}, o saldo de lá pode ficar negativo.
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="motivo-cancelamento">Motivo</Label>
            <Textarea
              id="motivo-cancelamento"
              autoFocus
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: setor errado, quantidade lançada a mais"
            />
            {motivo.trim() !== '' && letras(motivo) < 3 ? (
              <p className="text-xs text-destructive">Escreva o motivo com pelo menos 3 letras.</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-9" onClick={() => setCancelando(null)} disabled={cancelSalvando}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              className="h-9"
              onClick={() => void confirmarCancelamento()}
              disabled={cancelSalvando || letras(motivo) < 3}
            >
              {cancelSalvando ? 'Cancelando…' : 'Cancelar transferência'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
