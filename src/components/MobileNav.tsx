import { useMemo } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'

import { mobilePriorityFor, visibleDestinations } from '@/config/navigation'
import { useNavContext } from '@/hooks/useNavContext'
import { useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/**
 * Barra de navegação inferior do celular.
 *
 * No telefone a única navegação era o hamburger abrindo uma gaveta com ~50 itens: dois
 * toques e uma rolagem para trocar de tela. Aqui ficam os destinos do dia a dia do polo
 * ativo (definidos por `mobilePriority` no registro) e "Mais" abre a gaveta completa.
 * Fica no fluxo do layout, não flutuando, para nunca cobrir o compositor do chat.
 */
export function MobileNav() {
  const location = useLocation()
  const navContext = useNavContext()
  const { setOpenMobile } = useSidebar()

  const items = useMemo(
    () =>
      visibleDestinations(navContext)
        .map((destination) => ({ destination, priority: mobilePriorityFor(destination, navContext) }))
        .filter((entry): entry is { destination: typeof entry.destination; priority: number } => entry.priority != null)
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 4)
        .map((entry) => entry.destination),
    [navContext],
  )

  if (items.length === 0) return null

  return (
    <nav
      aria-label="Navegação principal"
      className="shrink-0 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="flex items-stretch">
        {items.map((destination) => {
          const { path, label, icon: NavIcon } = destination
          const isActive = location.pathname === path || location.pathname.startsWith(`${path}/`)
          return (
            <li key={destination.id} className="flex-1">
              <NavLink
                to={path}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <NavIcon className="size-5 shrink-0" aria-hidden />
                <span className="max-w-full truncate leading-none">{label}</span>
              </NavLink>
            </li>
          )
        })}
        <li className="flex-1">
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            className="flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium text-muted-foreground transition-colors"
          >
            <Menu className="size-5 shrink-0" aria-hidden />
            <span className="leading-none">Mais</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
