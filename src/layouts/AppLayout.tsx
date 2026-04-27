import { useEffect, useId, useState, type ReactNode } from 'react'
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
  const titleId = useId()

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
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_10%,oklch(0.95_0.03_50/.6),transparent_28%),radial-gradient(circle_at_88%_4%,oklch(0.93_0.03_250/.5),transparent_22%)]" />
      <header
        role="banner"
        className={cn(
        'sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 transition-shadow duration-200',
        scrolled && 'shadow-sm',
      )}
      >
        <div className="mx-auto flex w-full max-w-7xl min-w-0 items-start gap-2 px-4 py-2 sm:items-center">
          <TopControls />
        </div>
        <div className="mx-auto w-full max-w-7xl min-w-0 px-4">
          <PageHeader title={title} titleId={titleId} description={subtitle} actions={actions} className="border-0 pb-4" />
        </div>
      </header>

      <main id="main-content" aria-labelledby={titleId} className="mx-auto w-full max-w-7xl min-w-0 flex-1 space-y-8 px-4 py-6 sm:py-8 relative">
        {children}
      </main>
    </SidebarInset>
  )
}
