import { useMemo, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronRight, Search, Star, X } from 'lucide-react'

import { InboxMenu } from '@/components/InboxMenu'
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher'
import { Badge } from '@/components/ui/badge'
import { BRAND_FAVICON_URL } from '@/config/brandAssets'
import { APP_ENV_BADGE, APP_NAME, APP_TAGLINE } from '@/config/branding'
import {
  destinationForPath,
  groupedDestinations,
  isDestinationActive,
  searchDestinations,
  visibleDestinations,
  type NavDestination,
  type NavGroupId,
} from '@/config/navigation'
import { useNavContext } from '@/hooks/useNavContext'
import { useNavGroupPrefs } from '@/hooks/useNavGroupPrefs'
import { useNavPrefs } from '@/hooks/useNavPrefs'
import { useTenant } from '@/context/TenantContext'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/**
 * Item de navegação. A estrela aparece no hover (e sempre no que já é favorito),
 * então fixar uma tela é um clique de onde você já está — sem tela de configuração.
 */
function NavItem({
  destination,
  isFavorite,
  onToggleFavorite,
}: {
  destination: NavDestination
  isFavorite: boolean
  onToggleFavorite: (id: string) => void
}) {
  const location = useLocation()
  const { path, label, icon: NavIcon } = destination
  const isActive = isDestinationActive(destination, location.pathname)

  return (
    <SidebarMenuItem className="group/menu-item relative">
      <SidebarMenuButton
        isActive={isActive}
        render={<NavLink to={path} />}
        tooltip={label}
        className={cn(
          'h-8 rounded-md px-2.5 pr-8 text-[13px] transition-colors duration-150',
          isActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'font-normal text-sidebar-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground',
        )}
      >
        <NavIcon className={cn('size-4 shrink-0', isActive ? 'opacity-100' : 'opacity-70')} aria-hidden />
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        showOnHover={!isFavorite}
        aria-label={isFavorite ? `Desafixar ${label}` : `Fixar ${label} nos favoritos`}
        title={isFavorite ? 'Desafixar' : 'Fixar nos favoritos'}
        onClick={() => onToggleFavorite(destination.id)}
      >
        <Star className={cn('size-3.5', isFavorite ? 'fill-current text-primary' : 'opacity-60')} aria-hidden />
      </SidebarMenuAction>
    </SidebarMenuItem>
  )
}

function NavList({
  items,
  isFavorite,
  onToggleFavorite,
}: {
  items: NavDestination[]
  isFavorite: (id: string) => boolean
  onToggleFavorite: (id: string) => void
}) {
  return (
    <SidebarMenu className="gap-0.5">
      {items.map((destination) => (
        <NavItem
          key={destination.id}
          destination={destination}
          isFavorite={isFavorite(destination.id)}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </SidebarMenu>
  )
}

export function AppSidebar() {
  const { tenant } = useTenant()
  const location = useLocation()
  const navContext = useNavContext()
  const { state, isMobile } = useSidebar()
  const [query, setQuery] = useState('')
  // No celular a barra vira drawer e sempre abre por extenso; "ícone" só existe no desktop.
  const isIconMode = state === 'collapsed' && !isMobile

  // No mobile, o primitivo Sidebar renderiza um drawer (Sheet) sozinho — NÃO retornar null
  // aqui, senão o celular fica sem navegação (o hamburger no header abre este drawer).

  const displayName = tenant.brand.app_name || APP_NAME
  const logoUrl = tenant.brand.logo_url || BRAND_FAVICON_URL

  const available = useMemo(() => visibleDestinations(navContext), [navContext])
  const groups = useMemo(() => groupedDestinations(navContext), [navContext])
  const { favorites, recents, isFavorite, toggleFavorite } = useNavPrefs(available)

  const results = useMemo(() => searchDestinations(query, navContext), [query, navContext])
  const isSearching = query.trim().length > 0

  // Só o grupo da tela atual nasce aberto: 11 grupos abertos de uma vez é a razão
  // de a lista ter ~50 linhas e exigir rolagem para chegar em Configuração.
  const activeGroup = destinationForPath(location.pathname)?.group

  // Aberto/fechado é CONTROLADO, não `defaultOpen`: com defaultOpen o valor mudava a cada
  // navegação (o grupo ativo muda) e o base-ui avisava que um Collapsible não controlado
  // teve o padrão alterado depois de montado.
  //
  // O que o usuário abre ou fecha PERSISTE (localStorage). Antes era descartado a cada
  // troca de tela: quem passa o dia entre Leads e Agenda reabria "Clínica" em toda ida e
  // volta, um clique de imposto por navegação. O grupo da tela atual continua sempre
  // aberto — é onde você está —, então a tela nova nunca aparece com a própria seção
  // fechada, que era o motivo original de zerar tudo.
  const { openGroups, setGroupOpen } = useNavGroupPrefs()

  const isGroupOpen = (id: NavGroupId) =>
    id === activeGroup ? true : (openGroups.get(id) ?? id === 'inicio')

  // Atalho só vale se poupar rolagem: um "recente" cujo grupo está ABERTO logo abaixo
  // aparece duas vezes na mesma tela. Era o caso normal, não a exceção — com Início
  // aberto e o grupo da tela atual aberto, Painel, Funil de leads e Chat comercial
  // ocupavam três das seis primeiras linhas repetindo o que estava à vista.
  const atalhosRecentes = recents.filter((destination) => !isGroupOpen(destination.group))

  return (
    <Sidebar collapsible="icon" variant="sidebar" className="border-r border-sidebar-border/50">
      <SidebarHeader className="px-3 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex w-full items-center gap-2">
              <SidebarMenuButton
                size="lg"
                className="min-w-0 flex-1 hover:bg-transparent"
                render={<Link to="/dashboard" />}
              >
                <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary p-1.5 shadow-sm transition-transform ">
                  <img src={logoUrl} alt="" className="size-full object-contain brightness-0 invert" />
                </div>
                <div className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate text-[13px] font-semibold text-sidebar-foreground">{displayName}</span>
                  <span className="truncate text-[10px] text-sidebar-foreground/50">{APP_TAGLINE}</span>
                </div>
              </SidebarMenuButton>
              <div className="group-data-[collapsible=icon]:hidden">
                <InboxMenu />
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-2">
        <div className="px-1 pb-2 group-data-[collapsible=icon]:hidden">
          <WorkspaceSwitcher />
        </div>

        {/* Busca de telas, com ~50 destinos, procurar é mais rápido que percorrer a lista. */}
        <div className="relative px-1 pb-2 group-data-[collapsible=icon]:hidden">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-foreground/50" aria-hidden />
          <SidebarInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar tela…"
            aria-label="Buscar tela"
            className="h-8 rounded-md pl-8 pr-8 text-[13px]"
          />
          {isSearching ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-sidebar-foreground/50 hover:text-sidebar-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        {isSearching ? (
          <SidebarGroup className="py-1">
            <SidebarGroupLabel className="px-2.5 py-2 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
              {results.length > 0 ? `${results.length} resultado${results.length > 1 ? 's' : ''}` : 'Nada encontrado'}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              {results.length > 0 ? (
                <NavList items={results} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} />
              ) : (
                <p className="px-2.5 py-2 text-xs text-sidebar-foreground/60">
                  Nenhuma tela com “{query}”.
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            {favorites.length > 0 ? (
              <SidebarGroup className="py-1">
                <SidebarGroupLabel className="px-2.5 py-2 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
                  Favoritos
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <NavList items={favorites} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} />
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null}

            {atalhosRecentes.length > 0 ? (
              <SidebarGroup className="py-1">
                <SidebarGroupLabel className="px-2.5 py-2 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
                  Recentes
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <NavList items={atalhosRecentes} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} />
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null}

            {favorites.length > 0 || atalhosRecentes.length > 0 ? (
              <SidebarSeparator className="mx-2 my-1 opacity-60 group-data-[collapsible=icon]:hidden" />
            ) : null}

            {groups.map((group) =>
              // Recolhida em ícones não há rótulo de grupo para clicar, então lá a lista
              // é sempre plana — senão a barra estreita ficaria vazia e sem saída.
              isIconMode ? (
                <SidebarGroup key={group.id} className="py-0.5">
                  <SidebarGroupContent>
                    <NavList items={group.items} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} />
                  </SidebarGroupContent>
                </SidebarGroup>
              ) : (
                <Collapsible
                  key={group.id}
                  open={isGroupOpen(group.id)}
                  onOpenChange={(open) => setGroupOpen(group.id, open)}
                  className="group/collapsible"
                >
                  <SidebarGroup className="py-0.5">
                    <CollapsibleTrigger
                      className={cn(
                        'flex w-full items-center gap-1 rounded-md px-2.5 py-2 text-[10px] font-medium uppercase tracking-wider',
                        'text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground',
                      )}
                    >
                      <ChevronRight
                        className="size-3 shrink-0 transition-transform duration-150 group-data-[panel-open]/collapsible:rotate-90"
                        aria-hidden
                      />
                      <span>{group.label}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarGroupContent>
                        <NavList items={group.items} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} />
                      </SidebarGroupContent>
                    </CollapsibleContent>
                  </SidebarGroup>
                </Collapsible>
              ),
            )}
          </>
        )}
      </SidebarContent>

      <SidebarSeparator className="mx-3 opacity-50" />
      <SidebarFooter className="px-3 py-3">
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
          <Badge
            variant="outline"
            className="h-4 w-fit border-primary/30 bg-primary/5 px-1.5 text-[9px] font-bold uppercase tracking-widest text-primary"
          >
            {APP_ENV_BADGE}
          </Badge>
          <span className="text-[10px] text-sidebar-foreground/40">Gestão da Clínica · 2026</span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
