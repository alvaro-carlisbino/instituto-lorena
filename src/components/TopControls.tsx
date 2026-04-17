import { ChevronDown, LogOut, RefreshCw, Wrench } from 'lucide-react'

import { useCrm } from '@/context/CrmContext'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarTrigger } from '@/components/ui/sidebar'

export function TopControls() {
  const crm = useCrm()
  const email = crm.session?.user.email ?? 'Sem sessão'

  const canSync = crm.currentPermission.canRouteLeads || crm.currentPermission.canManageUsers

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <SidebarTrigger className="-ml-1" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="outline" size="sm" className="max-w-[min(100%,14rem)] gap-1 truncate md:max-w-xs">
              <span className="truncate">{email}</span>
              <ChevronDown className="size-3.5 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Perfil</span>
                <span className="text-sm font-medium capitalize">{crm.currentPermission.role}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={crm.isLoading || !crm.session}
              onClick={() => void crm.runSignOut()}
            >
              <LogOut className="size-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="secondary"
          size="sm"
          disabled={crm.isLoading || !canSync}
          onClick={() => void crm.syncFromSupabase()}
        >
          <RefreshCw className={`size-3.5 ${crm.isLoading ? 'animate-spin' : ''}`} />
          {crm.isLoading ? 'Sincronizando…' : 'Sincronizar'}
        </Button>

        <Collapsible className="w-full min-w-0 sm:w-auto sm:max-w-md">
          <CollapsibleTrigger>
            <Button variant="ghost" size="sm" className="w-full justify-between gap-2 md:w-auto">
              <span className="inline-flex items-center gap-1.5">
                <Wrench className="size-3.5" />
                Ferramentas
              </span>
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 w-full max-w-full rounded-lg border border-border bg-muted/40 p-3 text-sm shadow-sm">
            <div className="grid gap-2 text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Modo de dados:</span> {crm.dataMode}
              </p>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-3.5 rounded border-input"
                  checked={crm.useRolePreview}
                  onChange={(event) => crm.setUseRolePreview(event.target.checked)}
                />
                Preview de perfil
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">Atuar como:</span>
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
                  value={crm.actingRole}
                  onChange={(event) => crm.setActingRole(event.target.value as 'admin' | 'gestor' | 'sdr')}
                  disabled={!crm.useRolePreview}
                >
                  <option value="admin">admin</option>
                  <option value="gestor">gestor</option>
                  <option value="sdr">sdr</option>
                </select>
              </div>
              <p>
                <span className="font-medium text-foreground">Efetivo:</span> {crm.effectiveRole}
              </p>
              {crm.syncNotice ? <p className="text-foreground">{crm.syncNotice}</p> : null}
              {crm.authNotice ? <p className="text-foreground">{crm.authNotice}</p> : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
}
