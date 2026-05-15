import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'

type Props = {
  children: ReactNode
}

export function RouteTransition({ children }: Props) {
  const location = useLocation()

  return (
    <div
      key={location.pathname}
      className={cn(
        'flex min-h-0 flex-1 flex-col animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-both motion-reduce:animate-none',
      )}
    >
      {children}
    </div>
  )
}
