import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props<T> = {
  title: string
  hint?: string
  /** Faixa de cor no topo. Só o topo: card colorido em seis cores vira festa. */
  accentClass?: string
  items: T[]
  keyOf: (item: T) => string
  renderItem: (item: T) => ReactNode
  emptyLabel?: string
  /**
   * Quantos cards nascem montados. O resto espera o "ver mais".
   *
   * Não é enfeite: a coluna "não convertido" do funil cirúrgico tem 58 pacientes e
   * a etapa "fechado" do quadro de leads tem 863. Montar tudo de uma vez é o que
   * fazia a tela travar ao abrir e o scroll engasgar.
   */
  pageSize?: number
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  /** Aviso curto ao lado da contagem (ex.: quantos estão atrasados). */
  badge?: ReactNode
}

/**
 * Uma coluna de quadro que não cresce para fora da tela.
 *
 * Três regras, e as três vieram de reclamação de uso: a coluna tem ALTURA (a da
 * tela, com rolagem própria, para nenhuma coluna empurrar a de baixo), tem TETO
 * de cards montados, e pode ser FECHADA — porque metade das colunas de um funil
 * é arquivo morto que ninguém abre no dia a dia e que só serve para afastar as
 * colunas vivas umas das outras.
 */
export function BoardColumn<T>({
  title,
  hint,
  accentClass,
  items,
  keyOf,
  renderItem,
  emptyLabel = 'Ninguém aqui.',
  pageSize = 20,
  collapsed = false,
  onCollapsedChange,
  badge,
}: Props<T>) {
  const [visiveis, setVisiveis] = useState(pageSize)
  const [tamanhoAnterior, setTamanhoAnterior] = useState(items.length)

  // Filtrou, buscou ou recarregou: volta ao teto. Senão a coluna guardava um
  // "ver mais" de uma lista que não existe mais. É ajuste no render, e não em
  // efeito, para não pintar a lista antiga antes de encolher.
  if (tamanhoAnterior !== items.length) {
    setTamanhoAnterior(items.length)
    setVisiveis(pageSize)
  }

  if (collapsed) {
    return <ColunaFechada title={title} count={items.length} onOpen={() => onCollapsedChange?.(false)} />
  }

  const mostrados = items.slice(0, visiveis)
  const restam = items.length - mostrados.length

  return (
    <section className="flex h-full w-[286px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className={cn('h-1 w-full shrink-0', accentClass)} />
      <header className="shrink-0 border-b border-border/60 px-3 py-2">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <h3 className="m-0 truncate text-sm font-medium leading-tight">
              {title}
              <span className="ml-1.5 tabular-nums text-muted-foreground">{items.length}</span>
            </h3>
            {hint && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{hint}</p>}
          </div>
          {onCollapsedChange && (
            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0 text-muted-foreground"
              title={`Fechar ${title}`}
              onClick={() => onCollapsedChange(true)}
            >
              <ChevronLeft className="size-4" />
            </Button>
          )}
        </div>
        {badge && <div className="mt-1">{badge}</div>}
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {items.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          <>
            {mostrados.map((item) => (
              <div key={keyOf(item)}>{renderItem(item)}</div>
            ))}
            {restam > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setVisiveis((v) => v + pageSize)}
              >
                Ver mais {Math.min(restam, pageSize)} de {restam}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/**
 * A coluna fechada: uma lombada com o nome de pé e a contagem.
 *
 * Vale para qualquer quadro — o de follow-up e o de leads, onde um funil de dez
 * etapas ocupa três metros de rolagem lateral e metade das etapas é arquivo.
 */
export function ColunaFechada({
  title,
  count,
  onOpen,
}: {
  title: string
  count: number
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Abrir ${title}`}
      className="flex h-full w-11 shrink-0 flex-col items-center gap-2 overflow-hidden rounded-xl border border-border bg-muted/30 py-3 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      <ChevronRight className="size-4 shrink-0" aria-hidden />
      <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
        {count}
      </span>
      <span
        className="min-h-0 overflow-hidden whitespace-nowrap text-xs font-medium"
        style={{ writingMode: 'vertical-rl' }}
      >
        {title}
      </span>
    </button>
  )
}
