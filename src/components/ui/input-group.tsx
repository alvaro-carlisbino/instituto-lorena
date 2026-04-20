import * as React from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type InputGroupProps = {
  className?: string
  children: React.ReactNode
}

/** Agrupa ícone + campo com borda unificada (padrão busca clínica / toolbar). */
export function InputGroup({ className, children }: InputGroupProps) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        'flex min-w-0 items-stretch overflow-hidden rounded-lg border border-input bg-transparent transition-colors',
        'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        'has-[[data-slot=input][aria-invalid=true]]:border-destructive has-[[data-slot=input][aria-invalid=true]]:ring-destructive/20',
        'dark:bg-input/30 dark:focus-within:ring-ring/50',
        className
      )}
    >
      {children}
    </div>
  )
}

type InputGroupAddonProps = {
  className?: string
  children: React.ReactNode
}

export function InputGroupAddon({ className, children }: InputGroupAddonProps) {
  return (
    <span
      data-slot="input-group-addon"
      className={cn(
        'inline-flex shrink-0 items-center justify-center border-r border-input bg-muted/40 px-2.5 text-muted-foreground',
        '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
    >
      {children}
    </span>
  )
}

type InputGroupInputProps = React.ComponentProps<typeof Input>

export function InputGroupInput({ className, ...props }: InputGroupInputProps) {
  return (
    <Input
      data-slot="input"
      className={cn(
        'min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 dark:bg-transparent',
        className
      )}
      {...props}
    />
  )
}
