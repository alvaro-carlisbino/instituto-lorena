import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils'

/** Abas de navegação secundária no topo de uma página (une telas relacionadas num só item de menu). */
export function SubTabs({ tabs }: { tabs: Array<{ to: string; label: string }> }) {
  return (
    <nav aria-label="Seções da página" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) =>
            cn(
              '-mb-px whitespace-nowrap rounded-t-md border-b-2 px-3.5 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
