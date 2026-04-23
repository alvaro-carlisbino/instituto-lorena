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
  const email = crm.session?.user.email ?? 'Não conectado'

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
                <span className="text-sm font-medium">{crm.currentPermission.role === 'sdr' ? 'Atendente' : crm.currentPermission.role === 'gestor' ? 'Gestor' : 'Administrador'}</span>
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
          {crm.isLoading ? 'Atualizando…' : 'Atualizar'}
        </Button>

        {(crm.currentPermission.canManageUsers || import.meta.env.DEV) && (
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
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-full min-w-0 max-w-[min(100vw-2rem,24rem)] sm:min-w-[300px] sm:max-w-none sm:w-[360px] rounded-xl border border-border/80 bg-popover/95 p-4 text-sm shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/90">
                <div className="grid gap-3 text-muted-foreground">
                  <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <span className="text-xs font-semibold text-foreground">Ajustes operacionais</span>
                  </div>
                  <p className="flex flex-col gap-1 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between text-xs sm:text-sm">
                    <span className="text-foreground/90">Origem dos dados</span>
                    <span className="w-fit rounded-md bg-muted px-2.5 py-0.5 font-medium text-foreground">
                      {crm.dataMode === 'supabase' ? 'Tempo real' : 'Demonstração'}
                    </span>
                  </p>
                  <label className="flex cursor-pointer items-center justify-between gap-3 text-xs sm:text-sm">
                    <span className="text-foreground/90">Simular perfil</span>
                    <input
                      type="checkbox"
                      className="size-4 rounded border border-input"
                      checked={crm.useRolePreview}
                      onChange={(event) => crm.setUseRolePreview(event.target.checked)}
                    />
                  </label>
                  <div className="flex flex-col gap-2 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between">
                    <span className="text-xs text-foreground/90 min-[400px]:text-sm">Ver como</span>
                    <select
                      className="h-9 w-full min-w-0 min-[400px]:h-8 min-[400px]:w-auto rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground"
                      value={crm.actingRole}
                      onChange={(event) => crm.setActingRole(event.target.value as 'admin' | 'gestor' | 'sdr')}
                      disabled={!crm.useRolePreview}
                    >
                      <option value="admin">Administrador</option>
                      <option value="gestor">Gestor</option>
                      <option value="sdr">Atendente</option>
                    </select>
                  </div>
                  <p className="flex flex-col gap-1 border-t border-dashed border-border/60 pt-2 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between text-xs sm:text-sm">
                    <span className="text-foreground/90">Perfil ativo</span>
                    <span className="w-fit rounded-md bg-primary px-2.5 py-0.5 text-primary-foreground">
                      {crm.effectiveRole === 'sdr' ? 'Atendente' : crm.effectiveRole === 'gestor' ? 'Gestor' : 'Administrador'}
                    </span>
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
        )}
      </div>
    </div>
  )
}
