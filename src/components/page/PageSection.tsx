import { useId, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

type PageSectionProps = {
  title: string
  children: ReactNode
  className?: string
  titleClassName?: string
  description?: string
}

/**
 * Agrupa conteúdo com um título h2, sem o peso de um Card extra. Use quando a secção for só título + lista/form.
 */
export function PageSection({ title, children, className, titleClassName, description }: PageSectionProps) {
  const headingId = useId()
  return (
    <section className={cn('space-y-3', className)} aria-labelledby={headingId}>
      <div>
        <h2 id={headingId} className={cn('m-0 text-sm font-semibold text-foreground', titleClassName)}>
          {title}
        </h2>
        {description ? <p className="mt-1.5 m-0 max-w-2xl text-xs text-muted-foreground leading-snug">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** Aplica a um <Card> para borda fácil, menos "caixote". */
export const pageQuietCardClass = 'border-border/50 bg-card/40 shadow-sm'
