import { Tray } from 'phosphor-react'
import type { ComponentType } from 'react'

import { cn } from '@/lib/utils'

/** Lucide, Phosphor, etc. — qualquer componente de ícone que aceite `className`. */
type IconLike = ComponentType<{ className?: string }>

interface EmptyStateProps {
  icon?: IconLike
  title: string
  description?: string
  className?: string
}

export function EmptyState({
  icon: Icon = Tray,
  title,
  description,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-12 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-md bg-muted">
        <Icon className="size-6 text-muted-foreground" aria-hidden />
      </div>
      <p className="font-heading text-sm font-medium text-foreground">
        {title}
      </p>
      {description && (
        <p className="max-w-[260px] text-sm text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}
