import { ChevronDown, LogOut, RefreshCw, Wrench } from 'lucide-react'

import { NoticeBanner } from '@/components/NoticeBanner'
import { noticeVariantFromMessage } from '@/lib/noticeVariant'
import { useCrm } from '@/context/CrmContext'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useState, useRef, useEffect } from 'react'
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

  const [isToolsOpen, setIsToolsOpen] = useState(false)
  const toolsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) {
        setIsToolsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <SidebarTrigger className="-ml-1" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'max-w-[min(100%,14rem)] gap-1 truncate md:max-w-xs',
            )}
          >
            <span className="truncate">{email}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
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

        <div className="relative w-full sm:w-auto md:max-w-md" ref={toolsRef}>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full justify-between gap-2 md:w-auto"
            onClick={() => setIsToolsOpen(!isToolsOpen)}
          >
            <span className="inline-flex items-center gap-1.5">
              <Wrench className="size-3.5" />
              Ferramentas
            </span>
            <ChevronDown className={`size-3.5 opacity-60 transition-transform ${isToolsOpen ? 'rotate-180' : ''}`} />
          </Button>
          
          {isToolsOpen && (
            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-full min-w-[300px] sm:w-[360px] rounded-none border-2 border-border bg-background p-4 text-sm shadow-brutal ring-1 ring-border">
              <div className="grid gap-3 text-muted-foreground">
                <div className="flex items-center justify-between border-b-2 border-border pb-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-foreground">Ajustes Operacionais</span>
                </div>
                <p className="flex items-center justify-between text-xs font-mono uppercase">
                  <span className="font-bold text-foreground">Modo de dados:</span>
                  <span className="bg-muted px-2 py-0.5 text-foreground">{crm.dataMode}</span>
                </p>
                <label className="flex cursor-pointer items-center justify-between text-xs font-bold uppercase">
                  <span>Preview de perfil</span>
                  <input
                    type="checkbox"
                    className="size-4 rounded-none border-2 border-input"
                    checked={crm.useRolePreview}
                    onChange={(event) => crm.setUseRolePreview(event.target.checked)}
                  />
                </label>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase text-foreground">Atuar como:</span>
                  <select
                    className="h-8 rounded-none border-2 border-input bg-background px-2 text-xs font-bold uppercase text-foreground focus-visible:ring-0"
                    value={crm.actingRole}
                    onChange={(event) => crm.setActingRole(event.target.value as 'admin' | 'gestor' | 'sdr')}
                    disabled={!crm.useRolePreview}
                  >
                    <option value="admin">admin</option>
                    <option value="gestor">gestor</option>
                    <option value="sdr">sdr</option>
                  </select>
                </div>
                <p className="flex items-center justify-between pt-2 border-t-2 border-border border-dashed text-xs font-mono uppercase">
                  <span className="font-bold text-foreground">Efetivo:</span>
                  <span className="bg-primary text-primary-foreground px-2 py-0.5">{crm.effectiveRole}</span>
                </p>
                {crm.syncNotice ? (
                  <NoticeBanner message={crm.syncNotice} variant={noticeVariantFromMessage(crm.syncNotice)} />
                ) : null}
                {crm.authNotice ? (
                  <NoticeBanner message={crm.authNotice} variant={noticeVariantFromMessage(crm.authNotice)} />
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
