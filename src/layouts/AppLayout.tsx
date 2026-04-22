import type { ReactNode } from 'react'
import { PageHeader } from '@/components/page/PageHeader'
import { TopControls } from '@/components/TopControls'
import { SidebarInset } from '@/components/ui/sidebar'

type Props = {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}

export function AppLayout({ title, subtitle, actions, children }: Props) {
  return (
    <SidebarInset className="min-w-0 bg-transparent flex min-h-svh flex-1 flex-col transition-all duration-300 ease-in-out">
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
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
