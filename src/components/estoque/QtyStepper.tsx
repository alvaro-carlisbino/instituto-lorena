import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Quantidade com − e + do tamanho do dedo. O campo de 64px com "Qtd" dentro, ao lado do
 * botão de limpar do seletor, era onde o × encavalava no número (print de 15/09).
 */
export function QtyStepper({
  value,
  onChange,
  min = 0,
  max,
  label,
  className,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  /** Nome do item, para leitor de tela: "Quantidade de Luva 7,5". */
  label: string
  className?: string
}) {
  const [rascunho, setRascunho] = useState<string | null>(null)
  const limitar = (n: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, n))

  return (
    <div className={cn('inline-flex h-9 shrink-0 items-center rounded-lg border border-input bg-background', className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full w-9 rounded-r-none"
        onClick={() => onChange(limitar(value - 1))}
        disabled={value <= min}
        aria-label={`Diminuir ${label}`}
      >
        <Minus className="size-3.5" aria-hidden />
      </Button>
      <input
        value={rascunho ?? String(value)}
        onFocus={(e) => {
          setRascunho(String(value))
          e.currentTarget.select()
        }}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={() => {
          const n = Number((rascunho ?? '').replace(',', '.'))
          if (Number.isFinite(n)) onChange(limitar(n))
          setRascunho(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        inputMode="decimal"
        aria-label={`Quantidade de ${label}`}
        className="h-full w-11 border-x border-input bg-transparent text-center text-sm font-medium tabular-nums outline-none focus:bg-muted/50"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-full w-9 rounded-l-none"
        onClick={() => onChange(limitar(value + 1))}
        disabled={max != null && value >= max}
        aria-label={`Aumentar ${label}`}
      >
        <Plus className="size-3.5" aria-hidden />
      </Button>
    </div>
  )
}
