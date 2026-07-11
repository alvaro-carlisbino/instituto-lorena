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
  Tv,
  Users,
  UserSearch,
  SquareCheck,
  Star,
  MessagesSquare,
  ArrowLeftRight,
  Calendar,
  PackageOpen,
  Store,
  Wallet,
  CreditCard,
  Ticket,
  Unplug,
  Repeat,
  Send,
  LineChart,
  FileSpreadsheet,
  Gauge,
  Target,
  Stethoscope,
  NotebookPen,
  ClipboardList,
  CalendarClock,
  Warehouse,
  PackageCheck,
  ClipboardCheck,
  ListChecks,
  FileBarChart2,
  Fingerprint,
  ClipboardPen,
  AlarmClock,
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
  const { tenant } = useTenant()

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

        {/* Início — porta de entrada */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
            Início
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <NavItem to="/dashboard" label="Painel" icon={TrendingUp} />
              <NavItem to="/assistente" label="Assistente IA" icon={Bot} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Leads — operação comercial (comum aos dois polos) */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
            Leads
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <NavItem to="/kanban" label="Funil de leads" icon={LayoutGrid} />
              {showLeadsHub ? <NavItem to="/leads" label="Todos os leads" icon={List} /> : null}
              {showLeadsHub && isClinicPolo ? <NavItem to="/chat" label="Chat comercial" icon={MessagesSquare} /> : null}
              <NavItem to="/historico" label="Histórico" icon={History} />
              {showLeadsHub ? <NavItem to="/tarefas" label="Tarefas" icon={SquareCheck} /> : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Clínica — telas por-paciente (só polo clínica) */}
        {isClinicPolo && showLeadsHub ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              Clínica
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <NavItem to="/agenda" label="Agenda" icon={Calendar} />
                <NavItem to="/perfil" label="Ficha do paciente" icon={UserSearch} />
                <NavItem to="/notas-clinicas" label="Notas clínicas" icon={NotebookPen} />
                <NavItem to="/prontuario" label="Prontuário" icon={Stethoscope} />
                <NavItem to="/protocolos" label="Protocolos" icon={ListChecks} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {/* Vendas — operação do e-commerce (só polo vendas) */}
        {isSalesPolo && showLeadsHub ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              Vendas
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <NavItem to="/tricopill-bi" label="Visão de vendas" icon={ChartColumn} />
                <NavItem to="/tricopill" label="Chat de vendas" icon={MessagesSquare} />
                <NavItem to="/tricopill-pedidos" label="Pedidos" icon={PackageOpen} />
                <NavItem to="/tricopill-assinaturas" label="Assinaturas" icon={Repeat} />
                <NavItem to="/frente-loja" label="Frente de loja" icon={Store} />
                <NavItem to="/tricopill-reengajamento" label="Reengajamento" icon={Send} />
                <NavItem to="/tricopill-loja" label="Analytics do site" icon={LineChart} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {/* Financeiro — a "casa do dinheiro", agora existe nos DOIS polos */}
        {showLeadsHub ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              Financeiro
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {isSalesPolo ? <NavItem to="/tricopill-financeiro" label="Recebimentos" icon={Wallet} /> : null}
                <NavItem to="/links-pagamento" label="Links de pagamento" icon={CreditCard} />
                {isSalesPolo ? <NavItem to="/cupons" label="Cupons" icon={Ticket} /> : null}
                {showBoards ? <NavItem to="/contas-a-pagar" label="Contas a pagar" icon={CalendarClock} /> : null}
                {isSalesPolo ? <NavItem to="/tricopill-relatorios" label="Relatórios de vendas" icon={FileSpreadsheet} /> : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {/* Estoque e compras */}
        {showBoards ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              Estoque e compras
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <NavItem to="/estoque" label="Estoque" icon={Warehouse} />
                <NavItem to="/compras" label="Ordens de compra" icon={ClipboardList} />
                <NavItem to="/inventario" label="Inventário" icon={ClipboardCheck} />
                {isClinicPolo ? <NavItem to="/kits" label="Kits cirúrgicos" icon={PackageCheck} /> : null}
                <NavItem to="/estoque-relatorios" label="Relatórios de estoque" icon={FileBarChart2} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {/* Relatórios — números de verdade (comum aos dois polos) */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
            Relatórios
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {isClinicPolo ? <NavItem to="/analytics" label="Análise do funil" icon={Gauge} /> : null}
              {showLeadsHub ? <NavItem to="/feedback" label="Feedback e NPS" icon={Star} /> : null}
              <NavItem to="/metricas" label="Metas" icon={Target} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Equipe (RH) — só polo clínica */}
        {isClinicPolo ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              Equipe (RH)
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <NavItem to="/ponto" label="Meu ponto" icon={Fingerprint} />
                <NavItem to="/rh-formularios" label="Formulários RH" icon={ClipboardPen} />
                {showAdmin ? <NavItem to="/ponto-gestao" label="Gestão de ponto" icon={AlarmClock} /> : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {/* Configuração — setup + integrações (Configurações sempre disponível) */}
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
            Configuração
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <NavItem to="/configuracoes" label="Configurações" icon={Settings} />
              {showBoards ? <NavItem to="/boards" label="Configurar funis" icon={Boxes} /> : null}
              {showDashboardConfig ? <NavItem to="/canais" label="Canais" icon={Radio} /> : null}
              {showAdmin ? <NavItem to="/admin-whatsapp" label="Roteamento WhatsApp" icon={ArrowLeftRight} /> : null}
              {showAdmin ? <NavItem to="/integracoes" label="Integrações" icon={Unplug} /> : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {showTv ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              TV
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <NavItem to="/tv" label="Tela TV" icon={Monitor} />
                <NavItem to="/tv-config" label="Config. TV" icon={Tv} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}

        {showAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 py-3 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
              Administração
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <NavItem to="/usuarios" label="Usuários" icon={Users} />
                <NavItem to="/auditoria" label="Auditoria" icon={Shield} />
                <NavItem to="/admin-operacao" label="Operação Admin" icon={SlidersHorizontal} />
                <NavItem to="/admin-lab" label="Ferramentas de dev" icon={FlaskConical} />
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
