import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type PageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
  titleId?: string
}

export function PageHeader({ title, description, actions, className, titleId }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2 border-b border-border/70 bg-background/70 pb-5 pt-2 md:flex-row md:items-start md:justify-between md:gap-4',
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 id={titleId} className="font-heading text-xl font-semibold tracking-tight text-foreground md:text-2xl lg:text-[1.65rem]">{title}</h1>
        {description ? <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
