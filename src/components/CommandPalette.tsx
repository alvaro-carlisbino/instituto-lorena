import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import {
  BarChart3,
  FlaskConical,
  History,
  KanbanSquare,
  LayoutDashboard,
  LayoutGrid,
  Radio,
  RefreshCw,
  Settings,
  Shield,
  SlidersHorizontal,
  Table2,
  Tv,
  Users,
} from 'lucide-react'

import { useCrm } from '@/context/CrmContext'
import { cn } from '@/lib/utils'

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const crm = useCrm()
  const canSync = crm.currentPermission.canRouteLeads || crm.currentPermission.canManageUsers
  const showBoards = crm.currentPermission.canEditBoards
  const showAdmin = crm.currentPermission.canManageUsers
  const showDashboardConfig = crm.currentPermission.canRouteLeads
  const showTv = crm.currentPermission.canViewTvPanel

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

  const go = (path: string) => {
    navigate(path)
    setOpen(false)
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Menu rápido"
      overlayClassName="fixed inset-0 z-50 bg-black/40 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
      contentClassName={cn(
        'fixed left-[50%] top-[12%] z-50 max-h-[min(70vh,32rem)] w-[min(100%-2rem,32rem)] -translate-x-1/2',
        'overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg',
        'data-[ending-style]:opacity-0 data-[starting-style]:opacity-0'
      )}
      className="[&_[cmdk-group-heading]]:select-none [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      <Command.Input
        placeholder="Buscar página ou ação…"
        className="flex h-11 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-1">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum resultado.</Command.Empty>

        <Command.Group heading="Operação">
          <Command.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
            onSelect={() => go('/dashboard')}
          >
            <LayoutDashboard className="size-4 shrink-0 opacity-70" />
            Dashboard
          </Command.Item>
          <Command.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
            onSelect={() => go('/kanban')}
          >
            <KanbanSquare className="size-4 shrink-0 opacity-70" />
            Kanban
          </Command.Item>
          <Command.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
            onSelect={() => go('/historico')}
          >
            <History className="size-4 shrink-0 opacity-70" />
            Histórico
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Dados e canais">
          <Command.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
            onSelect={() => go('/canais')}
          >
            <Radio className="size-4 shrink-0 opacity-70" />
            Canais
          </Command.Item>
          <Command.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
            onSelect={() => go('/metricas')}
          >
            <BarChart3 className="size-4 shrink-0 opacity-70" />
            Métricas
          </Command.Item>
          {showBoards ? (
            <Command.Item
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              onSelect={() => go('/boards')}
            >
              <LayoutGrid className="size-4 shrink-0 opacity-70" />
              Boards
            </Command.Item>
          ) : null}
          {showBoards ? (
            <Command.Item
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              onSelect={() => go('/visoes')}
            >
              <Table2 className="size-4 shrink-0 opacity-70" />
              Visões de dados
            </Command.Item>
          ) : null}
        </Command.Group>

        <Command.Group heading="Configuração">
          {showDashboardConfig ? (
            <Command.Item
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              onSelect={() => go('/dashboard-config')}
            >
              <SlidersHorizontal className="size-4 shrink-0 opacity-70" />
              Ajustar dashboard
            </Command.Item>
          ) : null}
          <Command.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
            onSelect={() => go('/configuracoes')}
          >
            <Settings className="size-4 shrink-0 opacity-70" />
            Configurações
          </Command.Item>
        </Command.Group>

        {showAdmin ? (
          <Command.Group heading="Administração">
            <Command.Item
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              onSelect={() => go('/usuarios')}
            >
              <Users className="size-4 shrink-0 opacity-70" />
              Usuários
            </Command.Item>
            <Command.Item
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              onSelect={() => go('/auditoria')}
            >
              <Shield className="size-4 shrink-0 opacity-70" />
              Auditoria
            </Command.Item>
            <Command.Item
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              onSelect={() => go('/admin-lab')}
            >
              <FlaskConical className="size-4 shrink-0 opacity-70" />
              Admin Lab
            </Command.Item>
          </Command.Group>
        ) : null}

        {showTv ? (
          <Command.Group heading="TV">
            <Command.Item
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              onSelect={() => go('/tv-config')}
            >
              <Tv className="size-4 shrink-0 opacity-70" />
              Configuração da TV
            </Command.Item>
            <Command.Item
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              onSelect={() => go('/tv')}
            >
              <Tv className="size-4 shrink-0 opacity-70" />
              Tela TV
            </Command.Item>
          </Command.Group>
        ) : null}

        <Command.Group heading="Ações">
          <Command.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
            disabled={crm.isLoading || !canSync}
            onSelect={() => {
              if (!crm.isLoading && canSync) void crm.syncFromSupabase()
              setOpen(false)
            }}
          >
            <RefreshCw className={cn('size-4 shrink-0 opacity-70', crm.isLoading && 'animate-spin')} />
            Sincronizar dados
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
