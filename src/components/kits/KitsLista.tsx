import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Ban, ChevronDown, ClipboardCheck, MoreHorizontal, PackageCheck, PackagePlus, Pencil, Printer, ShieldAlert, Trash2, Undo2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchField } from '@/components/ui/search-field'
import { CabecalhoGrupo } from '@/components/kits/CabecalhoGrupo'
import { STATUS_KIT, agruparMatMed, formatBRL, formatQtd } from '@/components/kits/kitUi'
import { podeVoltar } from '@/lib/kitMontagem'
import { cn } from '@/lib/utils'
import type { StockItem } from '@/services/estoqueCompras'
import { type KitCost, type KitStatus, type StockKit, cancelKit, excluirKit, imprimirContaDoKit, imprimirFolhaDoKit } from '@/services/estoqueKits'

type Filtro = 'abertos' | KitStatus | 'todos'

const dataCurta = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''

export function KitsLista({
  kits,
  busca,
  onBusca,
  buscando,
  items,
  kitCosts,
  lastCosts,
  loading,
  onRegistrarUso,
  onEditar,
  onOutroKit,
  onMudou,
}: {
  kits: StockKit[]
  /** Busca por paciente, kit, procedimento ou item (quem filtra é a página). */
  busca: string
  onBusca: (v: string) => void
  buscando: boolean
  items: StockItem[]
  kitCosts: Map<string, KitCost>
  lastCosts: Map<string, number>
  loading: boolean
  onRegistrarUso: (kit: StockKit) => void
  onEditar: (kit: StockKit) => void
  /** Montar mais um kit para o mesmo paciente (TC e Nanofat são dois kits). */
  onOutroKit: (kit: StockKit) => void
  onMudou: () => void
}) {
  const abertos = kits.filter((k) => k.status === 'montado').length
  const [filtro, setFiltro] = useState<Filtro>(abertos > 0 ? 'abertos' : 'todos')
  const [aberto, setAberto] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<StockKit | null>(null)
  const [excluindo, setExcluindo] = useState<StockKit | null>(null)

  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])

  const contagem: Record<Filtro, number> = {
    abertos,
    montado: abertos,
    consumido: kits.filter((k) => k.status === 'consumido').length,
    cancelado: kits.filter((k) => k.status === 'cancelado').length,
    todos: kits.length,
  }
  const visiveis = kits.filter((k) => (filtro === 'todos' ? true : filtro === 'abertos' ? k.status === 'montado' : k.status === filtro))

  const cancelar = async (kit: StockKit) => {
    setCancelando(null)
    try {
      const { restored } = await cancelKit(kit)
      toast.success(restored > 0 ? `Kit cancelado. ${restored} ${restored === 1 ? 'lançamento devolvido' : 'lançamentos devolvidos'} ao estoque.` : 'Kit cancelado.')
      onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cancelar')
    }
  }

  const excluir = async (kit: StockKit) => {
    setExcluindo(null)
    try {
      await excluirKit(kit.id)
      toast.success('Kit excluído.')
      onMudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao excluir')
    }
  }

  const [imprimindo, setImprimindo] = useState<string | null>(null)
  const imprimir = async (kit: StockKit, qual: 'conta' | 'folha') => {
    setImprimindo(kit.id)
    try {
      if (qual === 'folha') await imprimirFolhaDoKit(kit, porId)
      else await imprimirContaDoKit(kit, porId, lastCosts)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao imprimir')
    } finally {
      setImprimindo(null)
    }
  }

  const foraAgora = (kit: StockKit) => kit.items.reduce((s, l) => s + podeVoltar(l), 0)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <SearchField
        value={busca}
        onChange={(v) => {
          // Quem busca um paciente quer achar o kit, esteja ele aberto ou já usado.
          if (v.trim() && !busca.trim() && filtro === 'abertos') setFiltro('todos')
          onBusca(v)
        }}
        label="Buscar paciente, kit, procedimento ou item"
        resultados={busca.trim().length >= 2 ? visiveis.length : undefined}
      />
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(
          [
            ['abertos', 'Aguardando uso'],
            ['consumido', 'Usados'],
            ['cancelado', 'Cancelados'],
            ['todos', 'Todos'],
          ] as Array<[Filtro, string]>
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium',
              filtro === f ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:bg-muted',
            )}
          >
            {label} <span className="tabular-nums opacity-70">{contagem[f]}</span>
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title={
            loading || buscando
              ? 'Carregando…'
              : busca.trim()
                ? `Nenhum kit com "${busca.trim()}"${filtro !== 'todos' ? ' neste filtro' : ''}`
                : filtro === 'abertos'
                  ? 'Nenhum kit aguardando uso'
                  : 'Nenhum kit aqui'
          }
          description={
            busca.trim()
              ? filtro !== 'todos'
                ? 'Toque em Todos para procurar em todos os kits.'
                : 'A busca olha o nome do paciente, do kit, o procedimento e os itens.'
              : 'Kits montados aparecem aqui até alguém registrar o uso depois da cirurgia.'
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {visiveis.map((kit) => {
            const status = STATUS_KIT[kit.status]
            const temControlado = kit.items.some((l) => porId.get(l.itemId)?.controlled)
            const devolvido = kit.items.reduce((s, l) => s + l.returnedQty, 0)
            // Custo da baixa (stock_kit_costs cobre montado e usado): o mesmo número da conta impressa.
            const custoReal = kit.status !== 'cancelado' ? kitCosts.get(kit.id) : undefined
            const estimado = kit.items.reduce((s, l) => s + Math.round((l.qty - l.returnedQty) * (lastCosts.get(l.itemId) ?? 0)), 0)
            const cobrado = kit.items.reduce((s, l) => s + Math.max(0, l.chargeCents), 0)
            const expandido = aberto === kit.id
            // Kit usado não "pede" devolução (o que foi usado conta como fora e não volta), mas o
            // caminho para corrigir fica à vista: escondido no menu, a equipe achou que tinha sumido.
            const podeCorrigir = kit.status === 'consumido'
            return (
              <li key={kit.id} className="rounded-xl border border-border bg-card">
                <div className="flex items-start gap-3 p-3 sm:p-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold">{kit.patientName || 'Paciente não informado'}</span>
                      <Badge variant="secondary" className={status.className}>
                        {status.label}
                      </Badge>
                      {temControlado ? (
                        <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                          <ShieldAlert className="mr-0.5 size-3" aria-hidden /> controlado
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[kit.name, kit.procedureLabel, dataCurta(kit.scheduledFor ?? kit.createdAt)].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-xs tabular-nums">
                      {kit.items.length} itens
                      {devolvido > 0 ? <span className="text-emerald-700 dark:text-emerald-300"> · {formatQtd(devolvido)} voltaram</span> : null}
                      {custoReal ? (
                        <span>
                          {' '}· materiais {formatBRL(custoReal.totalCostCents)}
                          {custoReal.fullyCosted ? '' : ' (parcial)'}
                        </span>
                      ) : kit.status === 'montado' && estimado > 0 ? (
                        <span className="text-muted-foreground"> · materiais ≈ {formatBRL(estimado)}</span>
                      ) : null}
                      {cobrado > 0 ? <span> · cobrado {formatBRL(cobrado)}</span> : null}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'shrink-0')}
                      aria-label={`Mais ações do kit de ${kit.patientName ?? kit.name}`}
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48">
                      {kit.status !== 'cancelado' ? (
                        <DropdownMenuItem onClick={() => onEditar(kit)}>
                          <Pencil className="size-4" aria-hidden /> Editar kit e cobranças
                        </DropdownMenuItem>
                      ) : null}
                      {kit.patientName ? (
                        <DropdownMenuItem onClick={() => onOutroKit(kit)}>
                          <PackagePlus className="size-4" aria-hidden /> Outro kit para este paciente
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onClick={() => void imprimir(kit, 'folha')} disabled={imprimindo === kit.id}>
                        <ClipboardCheck className="size-4" aria-hidden /> Folha para ticar (PDF)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void imprimir(kit, 'conta')} disabled={imprimindo === kit.id}>
                        <Printer className="size-4" aria-hidden /> Conta do paciente (PDF)
                      </DropdownMenuItem>
                      {podeCorrigir ? (
                        <DropdownMenuItem onClick={() => onRegistrarUso(kit)}>
                          <Undo2 className="size-4" aria-hidden /> Corrigir uso e devolução
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuSeparator />
                      {kit.status !== 'cancelado' ? (
                        <DropdownMenuItem variant="destructive" onClick={() => setCancelando(kit)}>
                          <Ban className="size-4" aria-hidden /> Cancelar kit
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem variant="destructive" onClick={() => setExcluindo(kit)}>
                        <Trash2 className="size-4" aria-hidden /> Excluir kit
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 sm:px-4">
                  {kit.status === 'montado' ? (
                    <>
                      <Button size="sm" className="h-8" onClick={() => onRegistrarUso(kit)}>
                        <PackageCheck className="size-4" aria-hidden /> Registrar uso
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => void imprimir(kit, 'folha')} disabled={imprimindo === kit.id}>
                        <ClipboardCheck className="size-4" aria-hidden /> Folha para ticar
                      </Button>
                    </>
                  ) : podeCorrigir ? (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => onRegistrarUso(kit)}>
                      <Undo2 className="size-4" aria-hidden /> Corrigir uso e devolução
                    </Button>
                  ) : null}
                  {kit.status !== 'cancelado' ? (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => onEditar(kit)}>
                      <Pencil className="size-4" aria-hidden /> Editar
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" className="ml-auto h-8 text-muted-foreground" onClick={() => setAberto(expandido ? null : kit.id)}>
                    {expandido ? 'Esconder itens' : 'Ver itens'}
                    <ChevronDown className={cn('size-4 transition-transform', expandido && 'rotate-180')} aria-hidden />
                  </Button>
                </div>

                {expandido ? (
                  <div className="border-t border-border text-sm">
                    {agruparMatMed(kit.items, (l) => l.label || porId.get(l.itemId)?.name, (l) => porId.get(l.itemId)?.category).map((g) => (
                      <div key={g.grupo}>
                        <CabecalhoGrupo grupo={g.grupo} rotulo={g.rotulo} total={g.linhas.length} className="first:border-t-0" />
                        <ul className="divide-y divide-border">
                          {g.linhas.map((l) => {
                            const item = porId.get(l.itemId)
                            return (
                              <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 sm:px-4">
                                <span className="min-w-0">
                                  <span className="block leading-snug">{l.label || item?.name || '?'}</span>
                                  {l.isExtra || l.consumoSetor || l.chargeCents > 0 ? (
                                    <span className="block text-xs text-muted-foreground">
                                      {[l.isExtra ? 'avulso' : null, l.consumoSetor ? 'consumo do setor' : null, l.chargeCents > 0 ? formatBRL(l.chargeCents) : null].filter(Boolean).join(' · ')}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="shrink-0 text-right text-xs tabular-nums">
                                  <span className="font-medium">{formatQtd(l.qty - l.returnedQty)}</span>
                                  <span className="text-muted-foreground"> usado</span>
                                  {l.returnedQty > 0 ? (
                                    <span className="block text-emerald-700 dark:text-emerald-300">{formatQtd(l.returnedQty)} voltou</span>
                                  ) : null}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={cancelando != null}
        onOpenChange={(open) => !open && setCancelando(null)}
        title="Cancelar este kit?"
        description={
          cancelando?.status === 'consumido'
            ? `O kit já foi registrado como usado. Tudo que ainda consta como fora (${formatQtd(cancelando ? foraAgora(cancelando) : 0)} unidades) volta ao estoque e o custo sai do paciente. Use quando o kit foi lançado errado.`
            : 'Todo o material do kit volta ao estoque, lote a lote. Controlados entram de volta no livro.'
        }
        confirmLabel="Cancelar kit"
        cancelLabel="Voltar"
        onConfirm={() => cancelando && void cancelar(cancelando)}
      />

      <ConfirmDialog
        open={excluindo != null}
        onOpenChange={(open) => !open && setExcluindo(null)}
        title="Excluir este kit?"
        description={
          excluindo?.status === 'cancelado'
            ? 'O kit já foi cancelado e o material já voltou. Ele some da lista.'
            : 'Tudo que ainda está fora volta ao estoque e o kit some da lista e da conta do paciente.'
        }
        confirmLabel="Excluir kit"
        cancelLabel="Voltar"
        onConfirm={() => excluindo && void excluir(excluindo)}
      />
    </div>
  )
}
