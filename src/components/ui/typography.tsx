import * as React from "react"

import { cn } from "@/lib/utils"

// Escala tipográfica semântica do redesign. Títulos usam a fonte de heading (token
// --font-heading) e a base usa text-foreground/muted. Evita text-sm/lg arbitrário nas telas.

function PageTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      data-slot="page-title"
      className={cn("font-heading text-2xl font-semibold tracking-tight text-foreground", className)}
      {...props}
    />
  )
}

function SectionTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="section-title"
      className={cn("font-heading text-lg font-semibold tracking-tight text-foreground", className)}
      {...props}
    />
  )
}

function SubsectionTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="subsection-title"
      className={cn("font-heading text-base font-medium text-foreground", className)}
      {...props}
    />
  )
}

function Text({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="text" className={cn("text-sm leading-relaxed text-foreground", className)} {...props} />
}

function Muted({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="muted" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

function Caption({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span data-slot="caption" className={cn("text-xs tracking-wide text-muted-foreground", className)} {...props} />
  )
}

export { PageTitle, SectionTitle, SubsectionTitle, Text, Muted, Caption }
