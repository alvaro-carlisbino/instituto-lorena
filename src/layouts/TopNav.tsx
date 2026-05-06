import { NavLink, useLocation } from 'react-router-dom'
import {
  type Icon,
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

import { useCrm } from '@/context/CrmContext'
import { cn } from '@/lib/utils'

type NavItemProps = {
  to: string
  label: string
  icon: Icon
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
      <NavIcon className="size-4 shrink-0" weight="bold" />
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
          <TopNavItem to="/dashboard" label="Painel" icon={ChartLineUp} />
          <TopNavItem to="/kanban" label="Quadro" icon={SquaresFour} />
          {showLeadsHub && <TopNavItem to="/leads" label="Leads" icon={ListBullets} />}
          {showLeadsHub && <TopNavItem to="/chat" label="Chat" icon={ChatsCircle} />}
          <TopNavItem to="/historico" label="Histórico" icon={ClockCounterClockwise} />
          {showLeadsHub && <TopNavItem to="/tarefas" label="Tarefas" icon={CheckSquare} />}
          {showLeadsHub && <TopNavItem to="/agenda" label="Agenda" icon={Calendar} />}
          <TopNavItem to="/assistente" label="IA" icon={Robot} />
          <TopNavItem to="/canais" label="Canais" icon={Radio} />
          <TopNavItem to="/metricas" label="Métricas" icon={ChartBar} />
          {showBoards && <TopNavItem to="/boards" label="Funis" icon={CirclesThreePlus} />}
          {showBoards && <TopNavItem to="/visoes" label="Visões" icon={Table} />}
          {showAdmin && <TopNavItem to="/admin-whatsapp" label="WhatsApp" icon={ArrowsLeftRight} />}
          {showDashboardConfig && <TopNavItem to="/dashboard-config" label="Widgets" icon={SlidersHorizontal} />}
          <TopNavItem to="/configuracoes" label="Config" icon={Gear} />
          {showAdmin && <TopNavItem to="/usuarios" label="Usuários" icon={Users} />}
          {showAdmin && <TopNavItem to="/auditoria" label="Auditoria" icon={Shield} />}
          {showAdmin && <TopNavItem to="/admin-operacao" label="Operação" icon={Gear} />}
          {showAdmin && <TopNavItem to="/admin-lab" label="Ferramentas" icon={Flask} />}
          {showTv && <TopNavItem to="/tv-config" label="Config TV" icon={Television} />}
          {showTv && <TopNavItem to="/tv" label="Tela TV" icon={Monitor} />}
        </nav>
      </div>
    </div>
  )
}
