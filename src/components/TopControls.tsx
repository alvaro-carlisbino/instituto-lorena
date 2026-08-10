import { LogOut, Moon, RefreshCw, Search, Sun, User, Wrench } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { AlertsBell } from '@/components/AlertsBell'
import { NoticeBanner } from '@/components/NoticeBanner'
import { noticeVariantFromMessage } from '@/lib/noticeVariant'
import { useCrm } from '@/context/CrmContext'
import { useTheme } from '@/hooks/useTheme'
import { openCommandPalette } from '@/lib/commandPalette'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const ROLE_LABEL = {
  sdr: 'Atendente',
  gestor: 'Gestor',
  admin: 'Administrador',
} as const

/** Iniciais do e-mail para o botão de perfil (o e-mail inteiro ocupava 14rem do cabeçalho). */
function initialsFromEmail(email: string) {
  const handle = email.split('@')[0] ?? ''
  const parts = handle.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return handle.slice(0, 2).toUpperCase() || '??'
}

/**
 * Utilitários do cabeçalho, em ícones. Antes eram quatro controles largos (e-mail
 * completo, tema, "Atualizar", "Ferramentas") ocupando metade da barra superior; agora
 * cabem à direita e sobra largura para as ações da própria tela.
 *
 * No celular sobram DOIS: o sino e o perfil. Os seis ícones tomavam ~200px dos 375 e a
 * ação da própria tela era cortada no meio — em /leads o botão aparecia como "Exporta"
 * e em /kanban "Painel" ficava por baixo do sino. Buscar, atualizar e tema viram itens
 * do menu de perfil, que no telefone é onde já se procura esse tipo de coisa. Os ajustes
 * operacionais (simular perfil, ver como) ficam só no desktop: é ferramenta de quem está
 * depurando o sistema, não de quem está atendendo na rua.
 */
export function TopControls() {
  const crm = useCrm()
  const { theme, toggleTheme } = useTheme()
  const email = crm.session?.user.email ?? 'Não conectado'
  const isSignedIn = Boolean(crm.session)

  const canSync = crm.currentPermission.canRouteLeads || crm.currentPermission.canManageUsers
  const showTools = crm.currentPermission.canManageUsers || import.meta.env.DEV

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

  const hasNotice = Boolean(crm.syncNotice || crm.authNotice)

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {/* Primeiro controle da barra: quem está esperando resposta vem antes de
          qualquer utilitário, e acompanha a equipe em todas as telas. */}
      <AlertsBell />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden rounded-lg sm:inline-flex"
              aria-label="Buscar tela ou ação"
              onClick={openCommandPalette}
            >
              <Search className="size-4" aria-hidden />
            </Button>
          }
        />
        <TooltipContent>Buscar tela ou ação (⌘K)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden rounded-lg sm:inline-flex"
              disabled={crm.isLoading || !canSync}
              aria-label={crm.isLoading ? 'Atualizando dados' : 'Atualizar dados'}
              onClick={() => void crm.syncFromSupabase()}
            >
              <RefreshCw className={cn('size-4', crm.isLoading && 'animate-spin')} aria-hidden />
            </Button>
          }
        />
        <TooltipContent>{crm.isLoading ? 'Atualizando…' : 'Atualizar dados'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden rounded-lg sm:inline-flex"
              aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
            </Button>
          }
        />
        <TooltipContent>{theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</TooltipContent>
      </Tooltip>

      {showTools ? (
        <div className="relative hidden sm:block" ref={toolsRef}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative rounded-lg"
            aria-expanded={isToolsOpen}
            aria-haspopup="dialog"
            aria-label="Ajustes operacionais"
            onClick={() => setIsToolsOpen(!isToolsOpen)}
          >
            <Wrench className="size-4" aria-hidden />
            {/* Sem o painel aberto os avisos de sincronização ficavam invisíveis. */}
            {hasNotice ? (
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" aria-hidden />
            ) : null}
          </Button>

          {isToolsOpen && (
            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(100vw-2rem,22rem)] rounded-xl border border-border/80 bg-popover/95 p-3.5 text-sm shadow-sm ">
              <div className="grid gap-3 text-muted-foreground">
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                  <span className="text-xs font-semibold text-foreground">Ajustes operacionais</span>
                </div>
                <p className="flex items-center justify-between gap-2 text-xs sm:text-sm">
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
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={actingRoleSelectId} className="text-xs font-normal text-foreground/90 sm:text-sm">
                    Ver como
                  </Label>
                  <Select
                    value={crm.actingRole}
                    onValueChange={(value) => value && crm.setActingRole(value as 'admin' | 'gestor' | 'sdr')}
                    disabled={!crm.useRolePreview}
                  >
                    <SelectTrigger id={actingRoleSelectId} className="w-auto text-xs font-medium">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="gestor">Gestor</SelectItem>
                      <SelectItem value="sdr">Atendente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="flex items-center justify-between gap-2 border-t border-dashed border-border/60 pt-2 text-xs sm:text-sm">
                  <span className="text-foreground/90">Perfil ativo</span>
                  <span className="w-fit rounded-md bg-primary px-2.5 py-0.5 text-primary-foreground">
                    {ROLE_LABEL[crm.effectiveRole]}
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
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          className="relative ml-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={isSignedIn ? `Perfil: ${email}` : 'Perfil (não conectado)'}
        >
          {isSignedIn ? initialsFromEmail(email) : <User className="size-4" aria-hidden />}
          {/* No desktop este ponto vive no botão de ferramentas; no celular ele é a única
              pista de que há aviso de sincronização esperando dentro do menu. */}
          {hasNotice ? (
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-background sm:hidden" aria-hidden />
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-60">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{email}</span>
              <span className="text-xs text-muted-foreground">{ROLE_LABEL[crm.currentPermission.role]}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {/* Só no celular: aqui estão os utilitários que no desktop são ícones soltos.
              Sem isto, esconder os ícones em telas estreitas tiraria o acesso a eles. */}
          <div className="sm:hidden">
            <DropdownMenuItem onClick={openCommandPalette}>
              <Search className="size-4" />
              Buscar tela
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={crm.isLoading || !canSync}
              onClick={() => void crm.syncFromSupabase()}
            >
              <RefreshCw className={cn('size-4', crm.isLoading && 'animate-spin')} />
              {crm.isLoading ? 'Atualizando…' : 'Atualizar dados'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleTheme}>
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
            </DropdownMenuItem>
            {/* Os avisos de sincronização moravam dentro do painel de ferramentas, que no
                celular não existe mais: sem esta cópia, uma falha de sync ficaria muda. */}
            {hasNotice ? (
              <div className="grid gap-1.5 px-2 py-1.5">
                {crm.syncNotice ? (
                  <NoticeBanner message={crm.syncNotice} variant={noticeVariantFromMessage(crm.syncNotice)} />
                ) : null}
                {crm.authNotice ? (
                  <NoticeBanner message={crm.authNotice} variant={noticeVariantFromMessage(crm.authNotice)} />
                ) : null}
              </div>
            ) : null}
            <DropdownMenuSeparator />
          </div>

          <DropdownMenuItem disabled={crm.isLoading || !isSignedIn} onClick={() => void crm.runSignOut()}>
            <LogOut className="size-4" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
