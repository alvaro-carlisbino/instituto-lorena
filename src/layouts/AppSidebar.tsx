import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  type Icon,
  IconContext,
  ChartBar,
  ChartLineUp,
  CirclesThreePlus,
  ClockCounterClockwise,
  Flask,
  Gear,
  Monitor,
  Radio,
  Robot,
  Shield,
  ListBullets,
  SlidersHorizontal,
  SquaresFour,
  Table,
  Television,
  Users,
  CheckSquare,
} from 'phosphor-react'

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

function NavItem({ to, label, icon: NavIcon }: { to: string; label: string; icon: Icon }) {
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
        <NavIcon className="size-[18px] shrink-0 opacity-90" aria-hidden />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const crm = useCrm()

  const showDashboardConfig = crm.currentPermission.canRouteLeads
  const showLeadsHub = crm.currentPermission.canRouteLeads
  const showBoards = crm.currentPermission.canEditBoards
  const showAdmin = crm.currentPermission.canManageUsers
  const showTv = crm.currentPermission.canViewTvPanel

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <IconContext.Provider value={{ size: 18, weight: 'regular', mirrored: false }}>
      <SidebarHeader className="border-b border-sidebar-border/80">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/dashboard" />}>
              <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-sidebar-primary/10 p-1 ring-1 ring-sidebar-border/50">
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
              <NavItem to="/dashboard" label="Painel" icon={ChartLineUp} />
              <NavItem to="/kanban" label="Quadro de leads" icon={SquaresFour} />
              {showLeadsHub ? <NavItem to="/leads" label="Todos os leads" icon={ListBullets} /> : null}
              <NavItem to="/historico" label="Histórico" icon={ClockCounterClockwise} />
              {showLeadsHub ? <NavItem to="/tarefas" label="Tarefas e NPS" icon={CheckSquare} /> : null}
              <NavItem to="/assistente" label="Assistente IA" icon={Robot} />
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
              <NavItem to="/metricas" label="Métricas" icon={ChartBar} />
              {showBoards ? <NavItem to="/boards" label="Funis" icon={CirclesThreePlus} /> : null}
              {showBoards ? <NavItem to="/visoes" label="Visões" icon={Table} /> : null}
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
                  <NavItem to="/dashboard-config" label="Painel" icon={SlidersHorizontal} />
                ) : null}
                <NavItem to="/configuracoes" label="Configurações" icon={Gear} />
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
                <NavItem to="/admin-lab" label="Ferramentas" icon={Flask} />
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
                <NavItem to="/tv-config" label="Config. TV" icon={Television} />
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
                <NavItem to="/configuracoes" label="Configurações" icon={Gear} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="px-2 pb-4 text-[10px] leading-relaxed text-sidebar-foreground/55 group-data-[collapsible=icon]:hidden">
        {APP_ENV_BADGE} · Gestão da Clínica
      </SidebarFooter>
      <SidebarRail />
      </IconContext.Provider>
    </Sidebar>
  )
}
