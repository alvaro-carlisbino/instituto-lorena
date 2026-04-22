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
  Table2,
  Tv,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { BRAND_FAVICON_URL } from '@/config/brandAssets'
import { APP_ENV_BADGE, APP_NAME, APP_TAGLINE } from '@/config/branding'
import { useCrm } from '@/context/CrmContext'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof LayoutDashboard }) {
  const location = useLocation()
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        render={<NavLink to={to} />}
        tooltip={label}
        className="transition-colors data-[active=true]:bg-sidebar-accent/90"
      >
        <Icon className="size-4 shrink-0" />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const crm = useCrm()

  const showDashboardConfig = crm.currentPermission.canRouteLeads
  const showBoards = crm.currentPermission.canEditBoards
  const showAdmin = crm.currentPermission.canManageUsers
  const showTv = crm.currentPermission.canViewTvPanel

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/dashboard" />}>
              <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sidebar-primary/10 p-1 shadow-sm ring-1 ring-sidebar-border/60">
                <img src={BRAND_FAVICON_URL} alt="" className="size-full object-contain" />
              </div>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold">{APP_NAME}</span>
                  <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-semibold uppercase">
                    {APP_ENV_BADGE}
                  </Badge>
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">{APP_TAGLINE}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pt-1">
          <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/55">
            Operação
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} />
              <NavItem to="/kanban" label="Kanban" icon={KanbanSquare} />
              <NavItem to="/historico" label="Histórico" icon={History} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/55">
            Dados e canais
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem to="/canais" label="Canais" icon={Radio} />
              <NavItem to="/metricas" label="Métricas" icon={BarChart3} />
              {showBoards ? <NavItem to="/boards" label="Boards" icon={LayoutGrid} /> : null}
              {showBoards ? <NavItem to="/visoes" label="Visões" icon={Table2} /> : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {(showDashboardConfig || showAdmin) && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/55">
              Configuração
            </SidebarGroupLabel>
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
            <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/55">
              Administração
            </SidebarGroupLabel>
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
            <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/55">
              TV
            </SidebarGroupLabel>
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
            <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/55">
              Geral
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <NavItem to="/configuracoes" label="Configurações" icon={Settings} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="px-2 pb-4 text-[10px] leading-relaxed text-sidebar-foreground/55 group-data-[collapsible=icon]:hidden">
        {APP_ENV_BADGE} · CRM Clínico
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
