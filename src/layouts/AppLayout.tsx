import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { MobileNav } from '@/components/MobileNav'
import { PageHeader } from '@/components/page/PageHeader'
import { TopControls } from '@/components/TopControls'
import { SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
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
    // Fundo sólido. Havia dois gradientes radiais coral/azul fixos atrás de tudo: não
    // informam nada e são o tipo de enfeite que faz ferramenta de trabalho parecer template.
    <SidebarInset className="flex w-full min-w-0 flex-1 min-h-0 flex-col overflow-hidden bg-background">
      {/* Uma faixa só: navegação, título, ações da tela e utilitários. Eram duas faixas
          somando 105px, o que em telas de dado (leads, pedidos) empurrava a tabela
          inteira para fora da primeira dobra. */}
      <header
        role="banner"
        className={cn(
          'sticky top-0 z-20 shrink-0 border-b border-border bg-background transition-shadow duration-200',
          scrolled && 'shadow-sm',
        )}
      >
        <div className="mx-auto flex w-full max-w-[min(100%,1800px)] min-w-0 items-center gap-2 px-3 py-2 sm:px-6 lg:px-8">
          <SidebarTrigger className="-ml-1 shrink-0" />
          <PageHeader title={title} titleId={titleId} description={subtitle} actions={actions} />
          <div className="mx-1 hidden h-5 w-px shrink-0 bg-border/70 sm:block" aria-hidden />
          <TopControls />
        </div>
      </header>

      <main
        ref={mainRef}
        id="main-content"
        aria-labelledby={titleId}
        className={cn(
          'mx-auto w-full max-w-[min(100%,1800px)] min-w-0 relative flex flex-col min-h-0 flex-1',
          fullHeight
            ? 'overflow-hidden'
            : 'overflow-y-auto overflow-x-hidden space-y-4 px-3 py-4 sm:space-y-5 sm:px-6 sm:py-5 lg:px-8 [&>*]:shrink-0',
          mainClassName,
        )}
      >
        {children}
      </main>

      <MobileNav />
    </SidebarInset>
  )
}
