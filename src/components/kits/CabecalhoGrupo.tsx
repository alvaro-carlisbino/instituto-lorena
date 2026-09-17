import type { GrupoMatMed } from '@/components/kits/kitUi'
import { cn } from '@/lib/utils'

/** Faixa "MAT · Material 42" que separa a lista de itens do kit em material e medicação. */
export function CabecalhoGrupo({ grupo, rotulo, total, className }: { grupo: GrupoMatMed; rotulo: string; total: number; className?: string }) {
  return (
    <h3 className={cn('flex items-center gap-2 border-y border-border bg-muted/60 px-3 py-1.5 text-xs font-semibold sm:px-4', className)}>
      <span
        className={cn(
          'rounded px-1.5 py-px text-[10px] font-bold tracking-wide',
          grupo === 'MED' ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200' : 'bg-foreground/10 text-foreground',
        )}
      >
        {grupo}
      </span>
      {rotulo}
      <span className="font-normal text-muted-foreground tabular-nums">{total}</span>
    </h3>
  )
}
