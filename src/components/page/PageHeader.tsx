import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type PageHeaderProps = {
  title: string
  /** Uma linha (string) ou conteúdo rico. Preferir título + ajuda (PageHelp) em vez de parágrafos longos. */
  description?: ReactNode
  actions?: ReactNode
  className?: string
  titleId?: string
}

export function PageHeader({ title, description, actions, className, titleId }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2 border-b border-border/70 bg-background/70 pt-2 md:flex-row md:items-start md:justify-between md:gap-4',
        description && description !== '' ? 'pb-3' : 'pb-2.5',
        className
      )}
    >
      <div className={cn('min-w-0', description && description !== '' && 'space-y-1')}>
        <h1 id={titleId} className="font-heading text-xl font-semibold tracking-tight text-foreground md:text-2xl lg:text-[1.6rem]">
          {title}
        </h1>
        {description != null && description !== '' ? (
          <div className="max-w-2xl text-xs leading-snug text-muted-foreground/90 [&_p]:m-0 [&_p+p]:mt-1.5">
            {typeof description === 'string' ? <p className="m-0">{description}</p> : description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5 md:pt-0.5">{actions}</div> : null}
    </div>
  )
}
