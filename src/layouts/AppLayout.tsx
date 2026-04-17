import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3,
  FlaskConical,
  History,
  KanbanSquare,
  LayoutDashboard,
  LayoutGrid,
  Monitor,
  Radio,
  Settings,
  Shield,
  SlidersHorizontal,
  Tv,
  Users,
} from 'lucide-react'

import { PageHeader } from '@/components/page/PageHeader'
import { TopControls } from '@/components/TopControls'
import { useCrm } from '@/context/CrmContext'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

type Props = {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof LayoutDashboard }) {
  const location = useLocation()
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        render={<NavLink to={to} />}
        tooltip={label}
      >
        <Icon className="size-4 shrink-0" />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppLayout({ title, subtitle, actions, children }: Props) {
  const crm = useCrm()

  const showDashboardConfig = crm.currentPermission.canRouteLeads
  const showBoards = crm.currentPermission.canEditBoards
  const showAdmin = crm.currentPermission.canManageUsers
  const showTv = crm.currentPermission.canViewTvPanel

  return (
    <SidebarProvider>
      <TooltipProvider delay={200}>
        <Sidebar collapsible="offcanvas" variant="sidebar">
          <SidebarHeader className="border-b border-sidebar-border">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" render={<Link to="/dashboard" />}>
                  <div className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
                    IL
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">Instituto Lorena</span>
                    <span className="truncate text-xs text-sidebar-foreground/70">CRM comercial</span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Operação</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <NavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} />
                  <NavItem to="/kanban" label="Kanban" icon={KanbanSquare} />
                  <NavItem to="/historico" label="Histórico" icon={History} />
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Dados e canais</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <NavItem to="/canais" label="Canais" icon={Radio} />
                  <NavItem to="/metricas" label="Métricas" icon={BarChart3} />
                  {showBoards ? <NavItem to="/boards" label="Boards" icon={LayoutGrid} /> : null}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {(showDashboardConfig || showAdmin) && (
              <SidebarGroup>
                <SidebarGroupLabel>Configuração</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {showDashboardConfig ? (
                      <NavItem to="/dashboard-config" label="Dashboard" icon={SlidersHorizontal} />
                    ) : null}
                    <NavItem to="/configuracoes" label="Configurações" icon={Settings} />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            {showAdmin ? (
              <SidebarGroup>
                <SidebarGroupLabel>Administração</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <NavItem to="/usuarios" label="Usuários" icon={Users} />
                    <NavItem to="/auditoria" label="Auditoria" icon={Shield} />
                    <NavItem to="/admin-lab" label="Admin Lab" icon={FlaskConical} />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null}

            {showTv ? (
              <SidebarGroup>
                <SidebarGroupLabel>TV</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <NavItem to="/tv-config" label="Config. TV" icon={Tv} />
                    <NavItem to="/tv" label="Tela TV" icon={Monitor} />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null}

            {!showDashboardConfig && !showAdmin ? (
              <SidebarGroup>
                <SidebarGroupLabel>Geral</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <NavItem to="/configuracoes" label="Configurações" icon={Settings} />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null}
          </SidebarContent>

          <SidebarSeparator />
          <SidebarFooter className="text-xs text-sidebar-foreground/60">Versão interna · uso operacional</SidebarFooter>
          <SidebarRail />
        </Sidebar>
      </TooltipProvider>

      <SidebarInset className="min-w-0">
        <div className="flex min-h-svh min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="mx-auto flex w-full max-w-7xl min-w-0 items-start gap-2 px-4 py-2 sm:items-center">
              <TopControls />
            </div>
            <div className="mx-auto w-full max-w-7xl min-w-0 px-4">
              <PageHeader title={title} description={subtitle} actions={actions} className="border-0 pb-4" />
            </div>
          </div>

          <div className="mx-auto w-full max-w-7xl min-w-0 flex-1 space-y-6 px-4 py-6">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
