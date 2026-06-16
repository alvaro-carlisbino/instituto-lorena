import { NavLink, useLocation } from 'react-router-dom'
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
} from 'lucide-react'

import { useCrm } from '@/context/CrmContext'
import { cn } from '@/lib/utils'

type NavItemProps = {
  to: string
  label: string
  icon: LucideIcon
}

function TopNavItem({ to, label, icon: NavIcon }: NavItemProps) {
  const location = useLocation()
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`)

  return (
    <NavLink
      to={to}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold whitespace-nowrap transition-all duration-200",
        isActive
          ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
          : "text-foreground/60 hover:bg-muted hover:text-foreground",
      )}
    >
      <NavIcon className="size-4 shrink-0" />
      <span>{label}</span>
    </NavLink>
  )
}

export function TopNav() {
  const crm = useCrm()

  const showDashboardConfig = crm.currentPermission.canRouteLeads
  const showLeadsHub = crm.currentPermission.canRouteLeads
  const showBoards = crm.currentPermission.canEditBoards
  const showAdmin = crm.currentPermission.canManageUsers
  const showTv = crm.currentPermission.canViewTvPanel

  return (
    <div className="sticky top-0 z-30 border-b border-border/50 bg-background/95 backdrop-blur-lg">
      <div className="relative overflow-x-auto">
        <nav className="flex items-center gap-1.5 px-3 py-2">
          <TopNavItem to="/dashboard" label="Painel" icon={TrendingUp} />
          <TopNavItem to="/kanban" label="Quadro" icon={LayoutGrid} />
          {showLeadsHub && <TopNavItem to="/leads" label="Leads" icon={List} />}
          {showLeadsHub && <TopNavItem to="/chat" label="Chat" icon={MessagesSquare} />}
          <TopNavItem to="/historico" label="Histórico" icon={History} />
          {showLeadsHub && <TopNavItem to="/tarefas" label="Tarefas" icon={SquareCheck} />}
          {showLeadsHub && <TopNavItem to="/agenda" label="Agenda" icon={Calendar} />}
          <TopNavItem to="/assistente" label="IA" icon={Bot} />
          <TopNavItem to="/canais" label="Canais" icon={Radio} />
          <TopNavItem to="/metricas" label="Métricas" icon={ChartColumn} />
          {showBoards && <TopNavItem to="/boards" label="Funis" icon={Boxes} />}
          {showBoards && <TopNavItem to="/visoes" label="Visões" icon={Table2} />}
          {showAdmin && <TopNavItem to="/admin-whatsapp" label="WhatsApp" icon={ArrowLeftRight} />}
          {showDashboardConfig && <TopNavItem to="/dashboard-config" label="Widgets" icon={SlidersHorizontal} />}
          <TopNavItem to="/configuracoes" label="Config" icon={Settings} />
          {showAdmin && <TopNavItem to="/usuarios" label="Usuários" icon={Users} />}
          {showAdmin && <TopNavItem to="/auditoria" label="Auditoria" icon={Shield} />}
          {showAdmin && <TopNavItem to="/admin-operacao" label="Operação" icon={Settings} />}
          {showAdmin && <TopNavItem to="/admin-lab" label="Ferramentas" icon={FlaskConical} />}
          {showTv && <TopNavItem to="/tv-config" label="Config TV" icon={Tv} />}
          {showTv && <TopNavItem to="/tv" label="Tela TV" icon={Monitor} />}
        </nav>
      </div>
    </div>
  )
}
