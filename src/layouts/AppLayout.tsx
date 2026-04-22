import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { PageHeader } from '@/components/page/PageHeader'
import { TopControls } from '@/components/TopControls'
import { SidebarInset } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

type Props = {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}

export function AppLayout({ title, subtitle, actions, children }: Props) {
  const location = useLocation()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 0)
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <SidebarInset className="min-w-0 bg-transparent flex min-h-svh flex-1 flex-col transition-all duration-300 ease-in-out">
      <div className={cn(
        'sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 transition-shadow duration-200',
        scrolled && 'shadow-sm',
      )}>
        <div className="mx-auto flex w-full max-w-7xl min-w-0 items-start gap-2 px-4 py-2 sm:items-center">
          <TopControls />
        </div>
        <div className="mx-auto w-full max-w-7xl min-w-0 px-4">
          <PageHeader title={title} description={subtitle} actions={actions} className="border-0 pb-4" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl min-w-0 flex-1 space-y-8 px-4 py-8 relative">
        {children}
      </div>
    </SidebarInset>
  )
}
