import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type PageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 border-b border-border bg-background/95 pb-4 pt-2 md:flex-row md:items-start md:justify-between md:gap-4',
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground md:text-2xl">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
