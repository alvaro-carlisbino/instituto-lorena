import type { ReactNode } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type StatCardProps = {
  label: string
  value: ReactNode
  /** Texto pequeno abaixo do número (ex.: "12 vendas"). */
  hint?: ReactNode
  /** Conteúdo entre número e hint (ex.: badge de variação %). */
  delta?: ReactNode
  /** Ícone opcional antes do rótulo. */
  icon?: ReactNode
  /** Classe extra no número (ex.: 'text-emerald-700' ou 'text-lg' p/ valores longos). */
  valueClassName?: string
}

/** Card de indicador (KPI) padrão do CRM — rótulo + número + dica opcional. */
export function StatCard({ label, value, hint, delta, icon, valueClassName }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={cn('text-2xl font-semibold tabular-nums text-foreground', valueClassName)}>{value}</p>
        {delta ? <div className="mt-0.5">{delta}</div> : null}
        {hint ? <p className="mt-0.5 text-[0.7rem] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}
