import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useCrm } from '../context/CrmContext'

type Props = {
  title: string
  subtitle?: string
  children: ReactNode
}

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/dashboard-config', label: 'Dashboard Config' },
  { to: '/boards', label: 'Boards' },
  { to: '/kanban', label: 'Kanban' },
  { to: '/historico', label: 'Historico' },
  { to: '/canais', label: 'Canais' },
  { to: '/metricas', label: 'Metricas' },
  { to: '/usuarios', label: 'Usuarios' },
  { to: '/auditoria', label: 'Auditoria' },
  { to: '/configuracoes', label: 'Configuracoes' },
  { to: '/tv-config', label: 'TV Config' },
  { to: '/tv', label: 'Tela TV' },
]

export function AppLayout({ title, subtitle, children }: Props) {
  const crm = useCrm()

  const visibleItems = navItems.filter((item) => {
    if (item.to === '/dashboard-config') return crm.currentPermission.canRouteLeads
    if (item.to === '/boards') return crm.currentPermission.canEditBoards
    if (item.to === '/usuarios') return crm.currentPermission.canManageUsers
    if (item.to === '/auditoria') return crm.currentPermission.canManageUsers
    if (item.to === '/tv' || item.to === '/tv-config') return crm.currentPermission.canViewTvPanel
    return true
  })

  return (
    <div className="app-shell">
      <aside className="sidebar-nav">
        <Link to="/dashboard" className="brand">
          <span>Instituto Lorena</span>
          <small>CRM Limitless</small>
        </Link>
        <nav>
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="screen-wrap">
        <header className="screen-header">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </header>
        {children}
      </main>
    </div>
  )
}
