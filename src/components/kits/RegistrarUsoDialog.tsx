import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { RotateCcw, ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SearchField } from '@/components/ui/search-field'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { formatQtd, ordenarPorNome } from '@/components/kits/kitUi'
import { beep } from '@/lib/beep'
import { combinaBusca } from '@/lib/busca'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { aplicarBipeDevolucao, podeVoltar } from '@/lib/kitMontagem'
import { cn } from '@/lib/utils'
import type { StockItem } from '@/services/estoqueCompras'
import { type StockKit, devolverSobraKit } from '@/services/estoqueKits'

/**
 * Fechar o kit depois da cirurgia: o que voltou na bandeja volta ao estoque, o resto fica como
 * usado no paciente. Bipar o que voltou é o caminho rápido; o − e + resolve o que não tem código.
 * No kit montado isto é o "Registrar uso". No kit já usado serve para a sobra que apareceu depois.
 */
export function RegistrarUsoDialog({
  kit,
  items,
  onClose,
  onFeito,
  onItemAtualizado,
}: {
  kit: StockKit | null
  items: StockItem[]
  onClose: () => void
  onFeito: () => void
  onItemAtualizado: (item: StockItem) => void
}) {
  // Remonta por kit (key no pai): as devoluções começam zeradas a cada abertura.
  const [devolucoes, setDevolucoes] = useState<Record<string, number>>({})
  const devRef = useRef(devolucoes)
  const [soDevolvidos, setSoDevolvidos] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [ultima, setUltima] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [pesquisa, setPesquisa] = useState('')
  const termo = useDeferredValue(pesquisa)

  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const fechando = kit?.status === 'montado'
  const linhas = useMemo(() => (kit?.items ?? []).filter((l) => (fechando ? true : podeVoltar(l) > 0)), [kit, fechando])
  const itensDoKit = useMemo(() => {
    const ids = new Set(kit?.items.map((l) => l.itemId) ?? [])
    return items.filter((i) => ids.has(i.id))
  }, [items, kit])

  const setDev = (next: Record<string, number>) => {
    devRef.current = next
    setDevolucoes(next)
  }

  const totalVolta = Object.values(devolucoes).reduce((s, n) => s + n, 0)
  const linhasComVolta = Object.values(devolucoes).filter((n) => n > 0).length

  const aplicar = (item: StockItem) => {
    if (!kit) return
    const r = aplicarBipeDevolucao(kit.items, devRef.current, item.id)
    if (r.resultado === 'fora_do_kit') {
      beep(false)
      setUltima(`${item.name} não saiu neste kit`)
      toast.warning(`${item.name} não faz parte deste kit.`)
      return
    }
    if (r.resultado === 'esgotado') {
      beep(false)
      setUltima(`${item.name}: já voltou tudo que saiu`)
      return
    }
    setDev(r.devolucoes)
    beep(true)
    const linha = kit.items.find((l) => l.id === r.linhaId)
    setUltima(`${item.name}: volta ${formatQtd(r.devolucoes[r.linhaId ?? ''] ?? 0)} de ${formatQtd(linha ? podeVoltar(linha) : 0)}`)
  }

  const onCode = (code: string) => {
    const item = acharItemPorCodigo(itensDoKit, code) ?? acharItemPorCodigo(items, code)
    if (!item) {
      beep(false)
      setCodigo(code)
      return
    }
    aplicar(item)
  }

  const confirmar = async () => {
    if (!kit) return
    setSalvando(true)
    try {
      const r = await devolverSobraKit(
        kit.id,
        Object.entries(devolucoes).map(([kitItemId, qty]) => ({ kitItemId, qty })),
        true,
      )
      toast.success(
        r.unidades > 0
          ? `${formatQtd(r.unidades)} ${r.unidades === 1 ? 'unidade voltou' : 'unidades voltaram'} ao estoque${r.controlados > 0 ? ', com registro no livro de controlados' : ''}.`
          : 'Uso registrado: tudo do kit foi usado.',
      )
      onFeito()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar')
    } finally {
      setSalvando(false)
    }
  }

  const visiveis = ordenarPorNome(
    linhas.filter((l) => {
      if (soDevolvidos && (devolucoes[l.id] ?? 0) <= 0) return false
      const item = porId.get(l.itemId)
      return combinaBusca(termo, l.label, item?.name, item?.sku, item?.barcode)
    }),
    (l) => l.label || porId.get(l.itemId)?.name,
  )

  return (
    <Dialog open={kit != null} onOpenChange={(open) => !open && !salvando && onClose()}>
      <DialogContent className="flex max-h-[min(100dvh-1rem,52rem)] flex-col gap-0 p-0 sm:max-w-2xl max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:rounded-none">
        <DialogHeader className="border-b border-border p-4 pr-12">
          <DialogTitle>{fechando ? 'Registrar uso do kit' : 'Devolver sobra ao estoque'}</DialogTitle>
          <DialogDescription>
            {[kit?.patientName, kit?.name].filter(Boolean).join(' · ')}. Bipe ou marque o que voltou; o resto conta como usado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 border-b border-border p-3 sm:p-4">
          <ScanBar onCode={onCode} ultimaLeitura={ultima} placeholder="Bipe cada item que voltou" />
          <SearchField
            value={pesquisa}
            onChange={setPesquisa}
            label={`Buscar entre os ${linhas.length} itens do kit`}
            resultados={visiveis.length}
          />
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground" aria-live="polite">
              {ultima ?? `${linhas.length} ${linhas.length === 1 ? 'item pode voltar' : 'itens podem voltar'}`}
            </span>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={() => setSoDevolvidos((v) => !v)}
                className={cn(
                  'rounded-full border px-2.5 py-1 font-medium',
                  soDevolvidos ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground',
                )}
              >
                Só o que volta ({linhasComVolta})
              </button>
              {totalVolta > 0 ? (
                <button
                  type="button"
                  onClick={() => setDev({})}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-muted-foreground"
                >
                  <RotateCcw className="size-3" aria-hidden /> Zerar
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {visiveis.map((l) => {
            const item = porId.get(l.itemId)
            const max = podeVoltar(l)
            const volta = devolucoes[l.id] ?? 0
            const usado = l.qty - l.returnedQty - volta
            return (
              <li key={l.id} className={cn('flex items-center gap-3 px-3 py-2.5 sm:px-4', volta > 0 && 'bg-emerald-500/5')}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-sm font-medium leading-snug">
                    {l.label || item?.name || 'Item'}
                    {item?.controlled ? <ShieldAlert className="size-3.5 shrink-0 text-amber-500" aria-label="controlado" /> : null}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    saiu {formatQtd(l.qty)}
                    {l.returnedQty > 0 ? ` · já voltou ${formatQtd(l.returnedQty)}` : ''} ·{' '}
                    <span className={cn(volta > 0 && 'font-medium text-foreground')}>usado {formatQtd(Math.max(0, usado))}</span>
                  </p>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">voltou</span>
                  <QtyStepper
                    value={volta}
                    max={max}
                    label={`devolução de ${item?.name ?? 'item'}`}
                    onChange={(n) => setDev({ ...devRef.current, [l.id]: n })}
                  />
                </div>
              </li>
            )
          })}
          {visiveis.length === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">
              {termo
                ? `Nenhum item com "${termo}" neste kit.`
                : soDevolvidos
                  ? 'Nada marcado para voltar ainda.'
                  : 'Tudo que saiu neste kit já voltou.'}
            </li>
          ) : null}
        </ul>

        <DialogFooter className="flex-row items-center gap-3 border-t border-border p-3 sm:p-4">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {totalVolta > 0
              ? `Voltam ${formatQtd(totalVolta)} ${totalVolta === 1 ? 'unidade' : 'unidades'} de ${linhasComVolta} ${linhasComVolta === 1 ? 'item' : 'itens'}`
              : fechando
                ? 'Nada volta: o kit inteiro foi usado'
                : 'Marque o que voltou'}
          </p>
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            Fechar
          </Button>
          <Button onClick={() => void confirmar()} disabled={salvando || (!fechando && totalVolta === 0)}>
            {salvando ? 'Salvando…' : fechando ? 'Registrar uso' : 'Devolver ao estoque'}
          </Button>
        </DialogFooter>

        {/* Dentro do popup: fora dele, clicar no dialog aninhado contaria como clique fora e fecharia este. */}
        <VincularCodigoDialog
          codigo={codigo}
          itens={itensDoKit}
          titulo="Código não cadastrado neste kit"
          onClose={() => setCodigo(null)}
          onVinculado={(item) => {
            setCodigo(null)
            onItemAtualizado(item)
            aplicar(item)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
