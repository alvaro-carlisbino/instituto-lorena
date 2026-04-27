import type { ComponentProps } from 'react'

import { SelectTrigger } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type LabeledSelectTriggerProps = { children: string } & ComponentProps<typeof SelectTrigger>

export function LabeledSelectTrigger({ children: label, className, size = 'default', ...rest }: LabeledSelectTriggerProps) {
  return (
    <SelectTrigger className={cn('min-w-0', className)} size={size} {...rest}>
      <span data-slot="select-value" className="line-clamp-1 min-w-0 flex-1 text-left text-sm font-medium">
        {label}
      </span>
    </SelectTrigger>
  )
}
