import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { RotateCcw, ShieldAlert, Undo2 } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { SearchField } from '@/components/ui/search-field'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { formatQtd, ordenarPorNome, semCodigoBipado } from '@/components/kits/kitUi'
import { beep } from '@/lib/beep'
import { combinaBusca } from '@/lib/busca'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import {
  type MarcasDeUso,
  aplicarBipeDevolucao,
  marcaPorUsado,
  marcaPorVoltou,
  podeVoltar,
  registroDeUso,
  usadoNaLinha,
} from '@/lib/kitMontagem'
import { cn } from '@/lib/utils'
import type { StockItem } from '@/services/estoqueCompras'
import { type StockKit, registrarUsoKit } from '@/services/estoqueKits'

/** Marcar o que voltou (bandeja voltou quase vazia) ou o que foi usado (voltou quase cheia). */
type Modo = 'usado' | 'voltou'
const CHAVE_MODO = 'kits:registrar-uso:modo'
function lerModo(): Modo {
  try {
    return window.localStorage.getItem(CHAVE_MODO) === 'voltou' ? 'voltou' : 'usado'
  } catch {
    return 'usado'
  }
}

// Marcar 90 itens e perder tudo num recarregar de página é o que faz a equipe desistir.
const chaveRascunho = (kitId: string) => `kits:registrar-uso:${kitId}`
function lerRascunho(kitId: string): MarcasDeUso {
  try {
    const bruto = window.localStorage.getItem(chaveRascunho(kitId))
    return bruto ? (JSON.parse(bruto) as MarcasDeUso) : {}
  } catch {
    return {}
  }
}

type Linha = StockKit['items'][number]

/**
 * Fechar o kit depois da cirurgia, numa tela própria (era um popup). Dá para marcar do jeito
 * que a enfermeira pensa: "usei 3 gazes" (modo usado) ou "voltaram 7" (modo voltou), e os dois
 * viram o mesmo registro. Bandeja que volta quase inteira: "Tudo voltou" e marca só o que saiu
 * dela. Usou mais do que a bandeja levou (9 Ringer num kit de 6): o modo usado aceita, e a
 * diferença baixa junto no estoque. Bipar continua sendo "voltou 1". No kit já usado vira
 * "Corrigir uso": parte do que foi registrado e muda só o que foi esquecido.
 */
export function RegistrarUso({
  kit,
  items,
  voltarPara,
  onFeito,
  onItemAtualizado,
}: {
  kit: StockKit
  items: StockItem[]
  /** Endereço do "Cancelar". */
  voltarPara: string
  onFeito: () => void
  onItemAtualizado: (item: StockItem) => void
}) {
  const [marcas, setMarcas] = useState<MarcasDeUso>(() => lerRascunho(kit.id))
  const marcasRef = useRef(marcas)
  const [modo, setModoState] = useState<Modo>(lerModo)
  const [soAlterados, setSoAlterados] = useState(false)
  const [pesquisa, setPesquisa] = useState('')
  const termo = useDeferredValue(pesquisa)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [ultima, setUltima] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    try {
      if (Object.keys(marcas).length > 0) window.localStorage.setItem(chaveRascunho(kit.id), JSON.stringify(marcas))
      else window.localStorage.removeItem(chaveRascunho(kit.id))
    } catch {
      /* sem armazenamento: segue sem rascunho */
    }
  }, [marcas, kit.id])

  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const fechando = kit.status === 'montado'
  // No kit já usado só aparece o que ainda está fora: o que já voltou inteiro não tem o que marcar.
  const linhas = useMemo(() => kit.items.filter((l) => (fechando ? true : podeVoltar(l) > 0)), [kit, fechando])
  const itensDoKit = useMemo(() => {
    const ids = new Set(kit.items.map((l) => l.itemId))
    return items.filter((i) => ids.has(i.id))
  }, [items, kit])

  const nomeDaLinha = (l: Linha) => l.label || porId.get(l.itemId)?.name || 'Item'

  const setMarcasJa = (next: MarcasDeUso) => {
    marcasRef.current = next
    setMarcas(next)
  }
  const marcar = (l: Linha, marca: number) => setMarcasJa({ ...marcasRef.current, [l.id]: marca })

  const setModo = (m: Modo) => {
    setModoState(m)
    try {
      window.localStorage.setItem(CHAVE_MODO, m)
    } catch {
      /* sem armazenamento: vale só nesta abertura */
    }
  }

  const registro = registroDeUso(linhas, marcas)
  const alterados = registro.itens.length

  const visiveis = ordenarPorNome(
    linhas.filter((l) => {
      if (soAlterados && (marcas[l.id] ?? 0) === 0) return false
      const item = porId.get(l.itemId)
      return combinaBusca(termo, l.label, item?.name, item?.sku, item?.barcode)
    }),
    nomeDaLinha,
  )

  const resumoDaLinha = (l: Linha) => {
    const marca = marcasRef.current[l.id] ?? 0
    return `${nomeDaLinha(l)}: usado ${formatQtd(usadoNaLinha(l, marca))}, voltou ${formatQtd(Math.max(0, marca))}`
  }

  const aplicarBipe = (item: StockItem) => {
    const r = aplicarBipeDevolucao(linhas, marcasRef.current, item.id)
    if (r.resultado === 'fora_do_kit') {
      beep(false)
      setUltima(`${item.name} não saiu neste kit`)
      toast.warning(`${item.name} não faz parte deste kit. Para incluir, use Editar kit.`)
      return
    }
    if (r.resultado === 'esgotado') {
      beep(false)
      setUltima(`${item.name}: já voltou tudo que saiu`)
      return
    }
    setMarcasJa(r.devolucoes)
    beep(true)
    const linha = linhas.find((l) => l.id === r.linhaId)
    if (linha) setUltima(resumoDaLinha(linha))
  }

  const onCode = (code: string) => {
    // Leitor disparado com o cursor na busca digita o código lá: tira, senão a lista some.
    setPesquisa((p) => semCodigoBipado(p, code))
    const item = acharItemPorCodigo(itensDoKit, code) ?? acharItemPorCodigo(items, code)
    if (!item) {
      beep(false)
      setCodigo(code)
      return
    }
    aplicarBipe(item)
  }

  // Enter na busca com um item só na lista: +1 no que se está marcando. "ringer", Enter, Enter.
  const onEnterBusca = () => {
    if (visiveis.length !== 1) return
    const l = visiveis[0]
    const marca = marcasRef.current[l.id] ?? 0
    const nova = modo === 'usado' ? marcaPorUsado(l, usadoNaLinha(l, marca) + 1) : marcaPorVoltou(l, marca + 1)
    if (nova === marca) {
      beep(false)
      setUltima(`${nomeDaLinha(l)}: já voltou tudo que saiu`)
      return
    }
    marcar(l, nova)
    beep(true)
    setUltima(resumoDaLinha(l))
  }

  // Aplica só no que está na tela: com busca ou filtro ativo, mexe só no que a pessoa vê.
  const tudoVoltou = () => {
    const next = { ...marcasRef.current }
    for (const l of visiveis) next[l.id] = podeVoltar(l)
    setMarcasJa(next)
    setUltima(null)
  }

  const confirmar = async () => {
    setSalvando(true)
    try {
      const r = await registrarUsoKit(kit.id, registro.itens, true)
      const partes = [
        r.unidades > 0 ? `${formatQtd(r.unidades)} ${r.unidades === 1 ? 'unidade voltou' : 'unidades voltaram'} ao estoque` : null,
        r.aMais > 0 ? `${formatQtd(r.aMais)} a mais ${r.aMais === 1 ? 'saiu' : 'saíram'} do estoque` : null,
      ].filter(Boolean)
      toast.success(
        partes.length > 0
          ? `${partes.join(' e ')}${r.controlados > 0 ? ', com registro no livro de controlados' : ''}.`
          : 'Uso registrado: tudo do kit foi usado.',
      )
      try {
        window.localStorage.removeItem(chaveRascunho(kit.id))
      } catch {
        /* sem armazenamento */
      }
      onFeito()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar')
    } finally {
      setSalvando(false)
    }
  }

  const filtrado = termo.length > 0 || soAlterados

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <section className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Marcar o que</span>
          <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Como marcar">
            {(
              [
                ['usado', 'foi usado'],
                ['voltou', 'voltou'],
              ] as Array<[Modo, string]>
            ).map(([m, rotulo]) => (
              <button
                key={m}
                type="button"
                aria-pressed={modo === m}
                onClick={() => setModo(m)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  modo === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {modo === 'usado'
            ? 'Bandeja voltou quase cheia? Toque em "Tudo voltou" e marque só o que foi usado. Pode passar do que saiu: a diferença baixa no estoque.'
            : 'Marque quanto voltou de cada item. O resto conta como usado.'}
        </p>
        <ScanBar onCode={onCode} ultimaLeitura={ultima} placeholder="Bipe cada item que voltou" />
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="sticky top-0 z-10 space-y-2 rounded-t-xl border-b border-border bg-card p-3 sm:p-4">
          <SearchField
            value={pesquisa}
            onChange={setPesquisa}
            onEnter={onEnterBusca}
            label={`Buscar entre os ${linhas.length} itens do kit`}
            resultados={visiveis.length}
          />
          <p className="truncate text-xs text-muted-foreground" aria-live="polite">
            {termo && visiveis.length === 1
              ? `Enter marca +1 ${modo === 'usado' ? 'usado' : 'voltou'} em ${nomeDaLinha(visiveis[0])}`
              : (ultima ?? `${linhas.length} ${linhas.length === 1 ? 'item' : 'itens'} no kit, em ordem alfabética`)}
          </p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setSoAlterados((v) => !v)}
              aria-pressed={soAlterados}
              className={cn(
                'rounded-full border px-2.5 py-1 font-medium',
                soAlterados ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground',
              )}
            >
              Marcados ({alterados})
            </button>
            <button
              type="button"
              onClick={tudoVoltou}
              disabled={visiveis.length === 0}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 font-medium text-foreground disabled:opacity-50"
            >
              <Undo2 className="size-3" aria-hidden />
              Tudo voltou{filtrado ? ` (${visiveis.length})` : ''}
            </button>
            {alterados > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setMarcasJa({})
                  setUltima(null)
                }}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-muted-foreground"
                aria-label="Zerar marcações"
              >
                <RotateCcw className="size-3" aria-hidden /> Zerar
              </button>
            ) : null}
          </div>
        </div>

        <ul className="divide-y divide-border">
          {visiveis.map((l) => {
            const item = porId.get(l.itemId)
            const fora = podeVoltar(l)
            const marca = marcas[l.id] ?? 0
            const voltou = Math.max(0, marca)
            const usado = usadoNaLinha(l, marca)
            const nome = nomeDaLinha(l)
            return (
              <li
                key={l.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 sm:px-4',
                  marca > 0 && 'bg-emerald-500/5',
                  marca < 0 && 'bg-amber-500/5',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-sm font-medium leading-snug">
                    {nome}
                    {item?.controlled ? <ShieldAlert className="size-3.5 shrink-0 text-amber-500" aria-label="controlado" /> : null}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    saiu {formatQtd(l.qty)}
                    {l.returnedQty > 0 ? ` · já voltou ${formatQtd(l.returnedQty)}` : ''}
                    {modo === 'usado' ? (
                      <span className={cn(voltou > 0 && 'font-medium text-emerald-700 dark:text-emerald-300')}> · volta {formatQtd(voltou)}</span>
                    ) : (
                      <span className={cn(marca !== 0 && 'font-medium text-foreground')}> · usado {formatQtd(usado)}</span>
                    )}
                    {marca < 0 ? (
                      <span className="font-medium text-amber-700 dark:text-amber-300"> · {formatQtd(-marca)} a mais que saiu</span>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {modo === 'usado' ? 'usado' : fechando ? 'voltou' : 'volta mais'}
                  </span>
                  {modo === 'usado' ? (
                    <QtyStepper value={usado} label={`uso de ${nome}`} onChange={(n) => marcar(l, marcaPorUsado(l, n))} />
                  ) : (
                    <QtyStepper value={voltou} max={fora} label={`devolução de ${nome}`} onChange={(n) => marcar(l, marcaPorVoltou(l, n))} />
                  )}
                </div>
              </li>
            )
          })}
          {visiveis.length === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">
              {termo
                ? `Nenhum item com "${termo}" neste kit.`
                : soAlterados
                  ? 'Nada marcado ainda.'
                  : 'Tudo que saiu neste kit já voltou.'}
            </li>
          ) : null}
        </ul>
      </section>

      <div className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-background px-3 py-3 shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.25)] sm:mx-0 sm:rounded-xl sm:border sm:px-4">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {alterados > 0
              ? [
                  registro.voltam > 0 ? `Voltam ${formatQtd(registro.voltam)} ${registro.voltam === 1 ? 'unidade' : 'unidades'}` : null,
                  registro.aMais > 0 ? `saem mais ${formatQtd(registro.aMais)} do estoque` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : fechando
                ? 'Nada volta: o kit inteiro foi usado'
                : 'Uso já registrado. Mude só o que precisa corrigir.'}
          </p>
          <Link to={voltarPara} className={cn(buttonVariants({ variant: 'outline' }), 'h-10 shrink-0', salvando && 'pointer-events-none opacity-50')}>
            Cancelar
          </Link>
          <Button onClick={() => void confirmar()} disabled={salvando || (!fechando && alterados === 0)} className="h-10 shrink-0 px-4">
            {salvando ? 'Salvando…' : fechando ? 'Registrar uso' : 'Salvar correção'}
          </Button>
        </div>
      </div>

      <VincularCodigoDialog
        codigo={codigo}
        itens={itensDoKit}
        titulo="Código não cadastrado neste kit"
        onClose={() => setCodigo(null)}
        onVinculado={(item) => {
          setCodigo(null)
          onItemAtualizado(item)
          aplicarBipe(item)
        }}
      />
    </div>
  )
}
