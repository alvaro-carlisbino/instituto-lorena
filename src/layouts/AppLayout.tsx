import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
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
  mainClassName?: string
  fullHeight?: boolean
}

export function AppLayout({ title, subtitle, actions, children, mainClassName, fullHeight }: Props) {
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const titleId = useId()

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [location.pathname])

  useEffect(() => {
    const main = mainRef.current
    if (!main || fullHeight) {
      setScrolled(false)
      return
    }
    const handleScroll = () => setScrolled(main.scrollTop > 0)
    handleScroll()
    main.addEventListener('scroll', handleScroll, { passive: true })
    return () => main.removeEventListener('scroll', handleScroll)
  }, [fullHeight, location.pathname])

  return (
    <SidebarInset className={cn(
      "flex w-full min-w-0 flex-1 min-h-0 flex-col overflow-hidden bg-transparent transition-all duration-300 ease-in-out",
    )}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_10%,oklch(0.95_0.03_50/.6),transparent_28%),radial-gradient(circle_at_88%_4%,oklch(0.93_0.03_250/.5),transparent_22%)]" />
      <header
        role="banner"
        className={cn(
        'sticky top-0 z-20 shrink-0 border-b border-border/70 bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75 transition-shadow duration-200',
        scrolled && 'shadow-sm',
      )}
      >
        <div className="mx-auto flex w-full max-w-[min(100%,1800px)] min-w-0 items-start gap-2 px-4 py-2 sm:items-center sm:px-6 lg:px-8">
          <TopControls />
        </div>
        <div className="mx-auto w-full max-w-[min(100%,1800px)] min-w-0 px-4 sm:px-6 lg:px-8">
          <PageHeader title={title} titleId={titleId} description={subtitle} actions={actions} className="border-0 pb-4" />
        </div>
      </header>

      <main
        ref={mainRef}
        id="main-content"
        aria-labelledby={titleId}
        className={cn(
          "mx-auto w-full max-w-[min(100%,1800px)] min-w-0 relative flex flex-col min-h-0 flex-1",
          fullHeight
            ? "overflow-hidden"
            : "overflow-y-auto overflow-x-hidden space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-6 lg:px-8 [&>*]:shrink-0",
          mainClassName
        )}
      >
        {children}
      </main>
    </SidebarInset>
  )
}
