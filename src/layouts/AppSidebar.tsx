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
  ChatsCircle,
  ArrowsLeftRight,
  Calendar,
} from 'phosphor-react'

import { InboxMenu } from '@/components/InboxMenu'
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
import { cn } from '@/lib/utils'

function NavItem({ to, label, icon: NavIcon }: { to: string; label: string; icon: Icon }) {
  const location = useLocation()
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        render={<NavLink to={to} />}
        tooltip={label}
        className={cn(
          "h-10 rounded-xl px-3 transition-all duration-200 font-bold text-[13px]",
          isActive 
            ? "bg-primary shadow-lg shadow-primary/20 text-primary-foreground font-black" 
            : "hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground"
        )}
      >
        <NavIcon className={cn("size-[18px] shrink-0", isActive ? "opacity-100" : "opacity-70")} aria-hidden />
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
    <Sidebar collapsible="icon" variant="sidebar" className="border-r border-sidebar-border/50">
      <IconContext.Provider value={{ size: 18, weight: 'bold', mirrored: false }}>
      <SidebarHeader className="px-4 py-6">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex w-full items-center gap-3">
              <SidebarMenuButton 
                size="lg" 
                className="min-w-0 flex-1 hover:bg-transparent" 
                render={<Link to="/dashboard" />}
              >
                <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary shadow-xl shadow-primary/20 p-1.5 transition-transform hover:scale-105 active:scale-95">
                  <img src={BRAND_FAVICON_URL} alt="" className="size-full object-contain brightness-0 invert" />
                </div>
                <div className="grid min-w-0 flex-1 text-left leading-tight ml-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-black uppercase tracking-tight text-sidebar-foreground">{APP_NAME}</span>
                  </span>
                  <span className="truncate text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/60">{APP_TAGLINE}</span>
                </div>
              </SidebarMenuButton>
              <div className="group-data-[collapsible=icon]:hidden">
                <InboxMenu />
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-3 gap-0">
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 py-4 text-[10px] font-black uppercase tracking-[0.25em] text-sidebar-foreground/60">
            Operação
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              <NavItem to="/dashboard" label="Painel" icon={ChartLineUp} />
              <NavItem to="/kanban" label="Quadro de leads" icon={SquaresFour} />
              {showLeadsHub ? <NavItem to="/leads" label="Todos os leads" icon={ListBullets} /> : null}
              {showLeadsHub ? <NavItem to="/chat" label="Chat comercial" icon={ChatsCircle} /> : null}
              <NavItem to="/historico" label="Histórico" icon={ClockCounterClockwise} />
              {showLeadsHub ? <NavItem to="/tarefas" label="Tarefas e NPS" icon={CheckSquare} /> : null}
              {showLeadsHub ? <NavItem to="/agenda" label="Agenda" icon={Calendar} /> : null}
              <NavItem to="/assistente" label="Assistente IA" icon={Robot} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="px-3 py-4 text-[10px] font-black uppercase tracking-[0.25em] text-sidebar-foreground/60">
            Dados e canais
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              <NavItem to="/canais" label="Canais" icon={Radio} />
              <NavItem to="/metricas" label="Métricas" icon={ChartBar} />
              {showBoards ? <NavItem to="/boards" label="Funis" icon={CirclesThreePlus} /> : null}
              {showBoards ? <NavItem to="/visoes" label="Visões" icon={Table} /> : null}
              {showAdmin ? <NavItem to="/admin-whatsapp" label="Roteamento WhatsApp" icon={ArrowsLeftRight} /> : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {(showDashboardConfig || showAdmin) && (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-4 text-[10px] font-black uppercase tracking-[0.25em] text-sidebar-foreground/60">
              Configuração
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
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
            <SidebarGroupLabel className="px-3 py-4 text-[10px] font-black uppercase tracking-[0.25em] text-sidebar-foreground/60">
              Administração
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                <NavItem to="/usuarios" label="Usuários" icon={Users} />
                <NavItem to="/auditoria" label="Auditoria" icon={Shield} />
                <NavItem to="/admin-operacao" label="Operação Admin" icon={Gear} />
                <NavItem to="/admin-lab" label="Ferramentas" icon={Flask} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {showTv ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-4 text-[10px] font-black uppercase tracking-[0.25em] text-sidebar-foreground/60">
              TV
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                <NavItem to="/tv-config" label="Config. TV" icon={Television} />
                <NavItem to="/tv" label="Tela TV" icon={Monitor} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {!showDashboardConfig && !showAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-4 text-[10px] font-black uppercase tracking-[0.25em] text-sidebar-foreground/40">
              Geral
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                <NavItem to="/configuracoes" label="Configurações" icon={Gear} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarSeparator className="mx-6 opacity-50" />
      <SidebarFooter className="px-6 py-8">
        <div className="flex flex-col gap-1 group-data-[collapsible=icon]:hidden">
          <Badge variant="outline" className="w-fit h-5 px-1.5 text-[9px] font-black uppercase tracking-widest border-primary/30 text-primary bg-primary/5">
            {APP_ENV_BADGE}
          </Badge>
          <span className="text-[9px] font-bold uppercase tracking-widest text-sidebar-foreground/40 mt-1">
            Gestão da Clínica · 2026
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
      </IconContext.Provider>
    </Sidebar>
  )
}
