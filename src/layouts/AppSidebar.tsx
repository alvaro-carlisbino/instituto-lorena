import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  type LucideIcon,
  ChartColumn,
  TrendingUp,
  Boxes,
  History,
  FlaskConical,
  Settings,
  Monitor,
  Radio,
  Bot,
  Shield,
  List,
  SlidersHorizontal,
  LayoutGrid,
  Table2,
  Tv,
  Users,
  SquareCheck,
  MessagesSquare,
  ArrowLeftRight,
  Calendar,
  Building2,
  PackageOpen,
  Pill,
  Wallet,
  CreditCard,
  Ticket,
  Unplug,
  Repeat,
  FileSpreadsheet,
  Gauge,
  Stethoscope,
  Layers,
} from 'lucide-react'

import { InboxMenu } from '@/components/InboxMenu'
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher'
import { Badge } from '@/components/ui/badge'
import { BRAND_FAVICON_URL } from '@/config/brandAssets'
import { APP_ENV_BADGE, APP_NAME, APP_TAGLINE } from '@/config/branding'
import { useTenant } from '@/context/TenantContext'
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

function NavItem({ to, label, icon: NavIcon }: { to: string; label: string; icon: LucideIcon }) {
  const location = useLocation()
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        render={<NavLink to={to} />}
        tooltip={label}
        className={cn(
          "h-9 rounded-lg px-3 text-[13px] transition-colors duration-150",
          isActive
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "font-normal text-sidebar-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground"
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
  const { tenant, isSuperAdmin } = useTenant()

  // No mobile, o primitivo Sidebar renderiza um drawer (Sheet) sozinho — NÃO retornar null
  // aqui, senão o celular fica sem navegação (o hamburger no header abre este drawer).

  // Fallback para o constant APP_NAME garante UX continua intacta enquanto a
  // Fase 0 migration não estiver aplicada ou enquanto o tenant ainda carrega.
  const displayName = tenant.brand.app_name || APP_NAME
  const logoUrl = tenant.brand.logo_url || BRAND_FAVICON_URL

  const showDashboardConfig = crm.currentPermission.canRouteLeads
  const showLeadsHub = crm.currentPermission.canRouteLeads
  const showBoards = crm.currentPermission.canEditBoards
  const showAdmin = crm.currentPermission.canManageUsers
  const showTv = crm.currentPermission.canViewTvPanel

  // Navegação por polo: a clínica tem Agenda/Prontuário; o polo de vendas (Tricopill) não.
  const isSalesPolo = tenant.poloType === 'sales'
  const isClinicPolo = !isSalesPolo

  return (
    <Sidebar collapsible="icon" variant="sidebar" className="border-r border-sidebar-border/50">
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
                  <img src={logoUrl} alt="" className="size-full object-contain brightness-0 invert" />
                </div>
                <div className="grid min-w-0 flex-1 text-left leading-tight ml-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-black uppercase tracking-tight text-sidebar-foreground">{displayName}</span>
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
        <div className="px-1 pb-3 group-data-[collapsible=icon]:hidden">
          <WorkspaceSwitcher />
        </div>
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
            Principal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <NavItem to="/dashboard" label="Painel" icon={TrendingUp} />
              <NavItem to="/kanban" label="Funil de leads" icon={LayoutGrid} />
              {showLeadsHub ? <NavItem to="/leads" label="Todos os leads" icon={List} /> : null}
              {showLeadsHub ? <NavItem to="/chat" label="Chat comercial" icon={MessagesSquare} /> : null}
              {showLeadsHub && isClinicPolo ? <NavItem to="/agenda" label="Agenda" icon={Calendar} /> : null}
              {showLeadsHub ? <NavItem to="/tarefas" label="Tarefas e NPS" icon={SquareCheck} /> : null}
              {showLeadsHub && isClinicPolo ? <NavItem to="/links-pagamento" label="Links de pagamento" icon={CreditCard} /> : null}
              <NavItem to="/historico" label="Histórico" icon={History} />
              <NavItem to="/assistente" label="Assistente IA" icon={Bot} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {showLeadsHub && isSalesPolo ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              Vendas
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <NavItem to="/tricopill" label="Visão Tricopill" icon={Pill} />
                <NavItem to="/tricopill-pedidos" label="Pedidos" icon={PackageOpen} />
                <NavItem to="/tricopill-assinaturas" label="Assinaturas" icon={Repeat} />
                <NavItem to="/cupons" label="Cupons" icon={Ticket} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {showLeadsHub && isSalesPolo ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              Financeiro
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <NavItem to="/tricopill-financeiro" label="Recebimentos" icon={Wallet} />
                <NavItem to="/tricopill-relatorios" label="Relatórios" icon={FileSpreadsheet} />
                <NavItem to="/links-pagamento" label="Links de pagamento" icon={CreditCard} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        <SidebarGroup>
          <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
            Análise
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {isSalesPolo ? <NavItem to="/tricopill-bi" label="BI de vendas" icon={ChartColumn} /> : null}
              <NavItem to="/metricas" label="Métricas" icon={Gauge} />
              {isClinicPolo ? <NavItem to="/prontuario" label="Prontuário" icon={Stethoscope} /> : null}
              <NavItem to="/planos" label="Planos" icon={Layers} />
              <NavItem to="/canais" label="Canais" icon={Radio} />
              {showBoards ? <NavItem to="/boards" label="Funis" icon={Boxes} /> : null}
              {showBoards ? <NavItem to="/visoes" label="Visões" icon={Table2} /> : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {(showDashboardConfig || showAdmin) && (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              Configuração
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {showDashboardConfig ? (
                  <NavItem to="/dashboard-config" label="Painel (widgets)" icon={SlidersHorizontal} />
                ) : null}
                {showAdmin ? <NavItem to="/integracoes" label="Integrações" icon={Unplug} /> : null}
                <NavItem to="/configuracoes" label="Configurações" icon={Settings} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              Administração
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <NavItem to="/usuarios" label="Usuários" icon={Users} />
                <NavItem to="/admin-whatsapp" label="Roteamento WhatsApp" icon={ArrowLeftRight} />
                <NavItem to="/auditoria" label="Auditoria" icon={Shield} />
                <NavItem to="/admin-operacao" label="Operação Admin" icon={Settings} />
                <NavItem to="/admin-lab" label="Ferramentas" icon={FlaskConical} />
                {isSuperAdmin ? <NavItem to="/admin-clinicas" label="Clínicas" icon={Building2} /> : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {showTv ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              TV
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <NavItem to="/tv-config" label="Config. TV" icon={Tv} />
                <NavItem to="/tv" label="Tela TV" icon={Monitor} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {!showDashboardConfig && !showAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
              Geral
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <NavItem to="/configuracoes" label="Configurações" icon={Settings} />
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
    </Sidebar>
  )
}
