import { ChevronDown, LogOut, Moon, RefreshCw, Sun, Wrench } from 'lucide-react'

import { NoticeBanner } from '@/components/NoticeBanner'
import { noticeVariantFromMessage } from '@/lib/noticeVariant'
import { useCrm } from '@/context/CrmContext'
import { useTheme } from '@/hooks/useTheme'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useState, useRef, useEffect, useId } from 'react'
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
  const { theme, toggleTheme } = useTheme()
  const email = crm.session?.user.email ?? 'Não conectado'

  const canSync = crm.currentPermission.canRouteLeads || crm.currentPermission.canManageUsers

  const [isToolsOpen, setIsToolsOpen] = useState(false)
  const toolsRef = useRef<HTMLDivElement>(null)
  const previewCheckboxId = useId()
  const actingRoleSelectId = useId()

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
    <div className="flex w-full min-w-0 flex-row flex-wrap items-center gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <SidebarTrigger className="-ml-1" />
      </div>

      <div className="flex min-w-0 flex-1 flex-row flex-wrap items-center justify-end gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'max-w-[min(100%,14rem)] gap-1 truncate rounded-xl border-border/70 bg-background/80 md:max-w-xs',
            )}
          >
            <span className="truncate">{email}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
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
          variant="ghost"
          size="icon-sm"
          className="rounded-xl"
          aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
          title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          className="rounded-xl"
          disabled={crm.isLoading || !canSync}
          aria-label={crm.isLoading ? 'Atualizando' : 'Atualizar'}
          onClick={() => void crm.syncFromSupabase()}
        >
          <RefreshCw className={`size-3.5 ${crm.isLoading ? 'animate-spin' : ''}`} aria-hidden />
          <span className="hidden min-[400px]:inline">{crm.isLoading ? 'Atualizando…' : 'Atualizar'}</span>
        </Button>

        {(crm.currentPermission.canManageUsers || import.meta.env.DEV) && (
          <div className="relative w-auto md:max-w-md" ref={toolsRef}>
            <Button
              variant="ghost"
              size="sm"
              className="w-auto justify-between gap-2 rounded-xl border border-transparent bg-background/60"
              aria-expanded={isToolsOpen}
              aria-haspopup="dialog"
              aria-label="Ferramentas"
              onClick={() => setIsToolsOpen(!isToolsOpen)}
            >
              <span className="inline-flex items-center gap-1.5">
                <Wrench className="size-3.5" aria-hidden />
                <span className="hidden min-[400px]:inline">Ferramentas</span>
              </span>
              <ChevronDown className={`size-3.5 opacity-60 transition-transform ${isToolsOpen ? 'rotate-180' : ''}`} aria-hidden />
            </Button>
            
            {isToolsOpen && (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-full min-w-0 max-w-[min(100vw-2rem,24rem)] rounded-2xl border border-border/80 bg-popover/95 p-4 text-sm shadow-xl backdrop-blur supports-[backdrop-filter]:bg-popover/90 sm:min-w-[300px] sm:max-w-none sm:w-[360px]">
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
                  <Label
                    htmlFor={previewCheckboxId}
                    className="flex cursor-pointer items-center justify-between gap-3 text-xs font-normal sm:text-sm"
                  >
                    <span className="text-foreground/90">Simular perfil</span>
                    <Checkbox
                      id={previewCheckboxId}
                      checked={crm.useRolePreview}
                      onCheckedChange={(checked) => crm.setUseRolePreview(checked)}
                    />
                  </Label>
                  <div className="flex flex-col gap-2 min-[400px]:flex-row min-[400px]:items-center min-[400px]:justify-between">
                    <Label
                      htmlFor={actingRoleSelectId}
                      className="text-xs font-normal text-foreground/90 min-[400px]:text-sm"
                    >
                      Ver como
                    </Label>
                    <Select
                      value={crm.actingRole}
                      onValueChange={(value) => value && crm.setActingRole(value as 'admin' | 'gestor' | 'sdr')}
                      disabled={!crm.useRolePreview}
                    >
                      <SelectTrigger
                        id={actingRoleSelectId}
                        className="w-full min-[400px]:w-auto text-xs font-medium"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administrador</SelectItem>
                        <SelectItem value="gestor">Gestor</SelectItem>
                        <SelectItem value="sdr">Atendente</SelectItem>
                      </SelectContent>
                    </Select>
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
