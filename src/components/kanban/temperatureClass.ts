import { cn } from '@/lib/utils'

export function temperaturePillClass(temperature: 'hot' | 'warm' | 'cold') {
  return cn(
    'rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase',
    temperature === 'hot' &&
      'border border-destructive/25 bg-destructive/15 text-destructive dark:bg-destructive/25 dark:text-destructive',
    temperature === 'warm' && 'border border-primary/20 bg-accent text-accent-foreground',
    temperature === 'cold' && 'border border-border bg-muted text-muted-foreground'
  )
}
