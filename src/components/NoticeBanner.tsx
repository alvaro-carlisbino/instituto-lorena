import type { NoticeVariant } from '@/lib/noticeVariant'
import { cn } from '@/lib/utils'

const styles: Record<NoticeVariant, string> = {
  default: 'border-border bg-muted/50 text-foreground',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-foreground',
  warning: 'border-amber-500/35 bg-amber-500/10 text-foreground',
}

type Props = {
  message: string
  variant?: NoticeVariant
  className?: string
}

export function NoticeBanner({ message, variant = 'default', className }: Props) {
  if (!message.trim()) return null
  return (
    <div
      role="status"
      className={cn('rounded-lg border px-3 py-2.5 text-sm leading-relaxed', styles[variant], className)}
    >
      {message}
    </div>
  )
}
