import { cn } from '@/lib/utils'

export function temperaturePillClass(temperature: 'hot' | 'warm' | 'cold') {
  return cn(
    'rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase',
    temperature === 'hot' && 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
    temperature === 'warm' && 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100',
    temperature === 'cold' && 'bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100'
  )
}
