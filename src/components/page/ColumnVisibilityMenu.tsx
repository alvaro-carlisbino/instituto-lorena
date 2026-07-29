import { Columns3 } from 'lucide-react'

import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ColumnVisibilityMenuProps<T extends string> = {
  columns: readonly T[]
  visible: T[]
  labelFor: (column: T) => string
  onToggle: (column: T) => void
}

/**
 * Escolha de colunas num menu.
 *
 * Eram oito botões-pílula sempre visíveis ocupando duas linhas do bloco de filtros —
 * ajuste que se faz uma vez e depois só atrapalha. Vira menu; o padrão continua o mesmo.
 */
export function ColumnVisibilityMenu<T extends string>({
  columns,
  visible,
  labelFor,
  onToggle,
}: ColumnVisibilityMenuProps<T>) {
  const hidden = columns.length - visible.length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9 shrink-0')}
        aria-label="Escolher colunas visíveis"
      >
        <Columns3 className="size-4" aria-hidden />
        <span className="hidden sm:inline">Colunas</span>
        {hidden > 0 ? <span className="text-xs text-muted-foreground tabular-nums">−{hidden}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="grid gap-0.5 p-1">
          {columns.map((column) => {
            const checked = visible.includes(column)
            return (
              <Label
                key={column}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-accent hover:text-accent-foreground"
              >
                <Checkbox
                  checked={checked}
                  // Manter ao menos uma coluna: uma tabela sem colunas não tem volta pela própria tabela.
                  disabled={checked && visible.length === 1}
                  onCheckedChange={() => onToggle(column)}
                />
                <span className="truncate">{labelFor(column)}</span>
              </Label>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
