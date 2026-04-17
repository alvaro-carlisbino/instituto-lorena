import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

type Props = {
  children: ReactNode
}

export function RouteTransition({ children }: Props) {
  const location = useLocation()
  const [phase, setPhase] = useState<'entering' | 'visible'>('visible')

  useEffect(() => {
    setPhase('entering')
    const timer = window.setTimeout(() => {
      setPhase('visible')
    }, 150)
    return () => window.clearTimeout(timer)
  }, [location.pathname])

  return <div className={`route-stage ${phase}`}>{children}</div>
}
