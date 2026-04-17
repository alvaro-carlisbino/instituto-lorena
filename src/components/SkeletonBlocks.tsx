import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Props = {
  rows?: number
  /** When true, wraps rows in a bordered card-like container */
  card?: boolean
}

export function SkeletonBlocks({ rows = 4, card = true }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        card && 'rounded-xl border border-border bg-card p-4 shadow-sm'
      )}
    >
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={`sk-${index}`} className="h-4 w-full rounded-md" />
      ))}
    </div>
  )
}
