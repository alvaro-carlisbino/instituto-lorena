import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import { RefreshCw, Star } from 'lucide-react'

import { NAV_GROUPS, groupedDestinations, visibleDestinations } from '@/config/navigation'
import { useCrm } from '@/context/CrmContext'
import { useNavContext } from '@/hooks/useNavContext'
import { useNavPrefs } from '@/hooks/useNavPrefs'
import { onOpenCommandPalette } from '@/lib/commandPalette'
import { cn } from '@/lib/utils'
import { CRM_ASSISTANT_PATH } from '@/services/crmAiAssistant'

const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground'

/**
 * Paleta de comandos (⌘K).
 *
 * Antes trazia ~20 telas escritas à mão que já não batiam com a barra lateral — oferecia
 * /visoes (escondida) e chamava /tarefas de "Tarefas e NPS" depois da migração do NPS.
 * Agora lê o mesmo registro da navegação, então acha qualquer tela que o usuário
 * enxergue, com os apelidos do dia a dia ("quadro", "pdv", "boleto", "leitor").
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const crm = useCrm()
  const navContext = useNavContext()
  const canSync = crm.currentPermission.canRouteLeads || crm.currentPermission.canManageUsers

  const available = useMemo(() => visibleDestinations(navContext), [navContext])
  const groups = useMemo(() => groupedDestinations(navContext), [navContext])
  const { favorites, isFavorite, toggleFavorite } = useNavPrefs(available)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => onOpenCommandPalette(() => setOpen(true)), [])

  const go = (path: string) => {
    navigate(path)
    setOpen(false)
  }

  // O assistente carrega o lead aberto no momento, então não é um link fixo.
  const goAiAssistant = () => {
    const lead = crm.selectedLeadId
    go(lead ? `${CRM_ASSISTANT_PATH}?leadId=${encodeURIComponent(lead)}&focus=lead` : CRM_ASSISTANT_PATH)
  }

  const groupLabel = (id: string) => NAV_GROUPS.find((g) => g.id === id)?.label ?? id

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Menu rápido"
      overlayClassName="fixed inset-0 z-50 bg-black/40 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
      contentClassName={cn(
        'fixed left-[50%] top-[12%] z-50 max-h-[min(70vh,32rem)] w-[min(100%-2rem,32rem)] -translate-x-1/2',
        'overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg',
        'data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
      )}
      className="[&_[cmdk-group-heading]]:select-none [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      <Command.Input
        placeholder="Buscar tela ou ação…"
        className="flex h-11 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-1">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum resultado.</Command.Empty>

        {favorites.length > 0 ? (
          <Command.Group heading="Favoritos">
            {favorites.map((destination) => {
              const { icon: NavIcon } = destination
              return (
                <Command.Item
                  key={`fav-${destination.id}`}
                  className={ITEM_CLASS}
                  keywords={destination.keywords}
                  onSelect={() => go(destination.path)}
                >
                  <NavIcon className="size-4 shrink-0 opacity-70" />
                  {destination.label}
                </Command.Item>
              )
            })}
          </Command.Group>
        ) : null}

        {groups.map((group) => (
          <Command.Group key={group.id} heading={groupLabel(group.id)}>
            {group.items.map((destination) => {
              const { icon: NavIcon } = destination
              const favorited = isFavorite(destination.id)
              return (
                <Command.Item
                  key={destination.id}
                  className={ITEM_CLASS}
                  keywords={destination.keywords}
                  onSelect={() =>
                    destination.id === 'assistente' ? goAiAssistant() : go(destination.path)
                  }
                >
                  <NavIcon className="size-4 shrink-0 opacity-70" />
                  <span className="flex-1 truncate">{destination.label}</span>
                  {/* Fixar sem sair da paleta: o clique não deve navegar junto. */}
                  <button
                    type="button"
                    aria-label={favorited ? `Desafixar ${destination.label}` : `Fixar ${destination.label}`}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleFavorite(destination.id)
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Star className={cn('size-3.5', favorited && 'fill-current text-primary')} aria-hidden />
                  </button>
                </Command.Item>
              )
            })}
          </Command.Group>
        ))}

        <Command.Group heading="Ações">
          <Command.Item
            className={ITEM_CLASS}
            disabled={crm.isLoading || !canSync}
            keywords={['sincronizar', 'recarregar', 'refresh']}
            onSelect={() => {
              if (!crm.isLoading && canSync) void crm.syncFromSupabase()
              setOpen(false)
            }}
          >
            <RefreshCw className={cn('size-4 shrink-0 opacity-70', crm.isLoading && 'animate-spin')} />
            Atualizar dados
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
