import type { ReactNode } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type BulkActionBarProps = {
  count: number
  onClear: () => void
  children: ReactNode
  /** Singular/plural do que está selecionado ("lead"/"leads"). */
  noun?: [string, string]
  className?: string
}

/**
 * Ações em lote como barra flutuante, visível só quando há seleção.
 *
 * Antes era um cartão fixo de ~300px no meio da página, presente mesmo com zero
 * selecionados — empurrava a lista para fora da tela e o botão vivia desabilitado, o
 * que faz a tela parecer quebrada. Aqui ela aparece ao selecionar e some ao limpar.
 */
export function BulkActionBar({
  count,
  onClear,
  children,
  noun = ['selecionado', 'selecionados'],
  className,
}: BulkActionBarProps) {
  if (count === 0) return null

  return (
    <div
      role="region"
      aria-label="Ações em lote"
      className={cn(
        'sticky bottom-3 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-xl',
        'border border-border bg-popover/95 px-3 py-2 shadow-lg ',
        'supports-[backdrop-filter]:bg-popover/90',
        className,
      )}
    >
      <span className="shrink-0 px-1 text-sm font-medium tabular-nums">
        {count} {count === 1 ? noun[0] : noun[1]}
      </span>
      <div className="h-5 w-px shrink-0 bg-border" aria-hidden />
      {children}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 shrink-0"
        onClick={onClear}
        aria-label="Limpar seleção"
      >
        <X className="size-4" aria-hidden />
        Limpar
      </Button>
    </div>
  )
}
