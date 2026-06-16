import { useState } from 'react'
import { Building2, ChevronDown, Check, Pill } from 'lucide-react'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTenant } from '@/context/TenantContext'
import { cn } from '@/lib/utils'

/**
 * Seletor de Polo — alterna a unidade de negócio ativa (Instituto Lorena ⟷ Tricopill)
 * no mesmo login. Só aparece quando o usuário pertence a 2+ polos. Trocar o polo
 * recarrega o app sob o novo contexto (RLS/branding/navegação seguem).
 */
export function PoloSwitcher() {
  const { tenant, availableTenants, switchTenant, switching } = useTenant()
  const [open, setOpen] = useState(false)

  if (availableTenants.length < 2) return null

  const activeName = tenant.brand.app_name || tenant.name

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={switching}
        className={cn(
          'flex w-full items-center gap-2 rounded-xl border border-sidebar-border/60 bg-sidebar-accent/30 px-3 py-2 text-left transition-colors hover:bg-sidebar-accent/60 disabled:opacity-60',
        )}
      >
        {tenant.poloType === 'sales' ? (
          <Pill className="size-4 shrink-0 text-sidebar-foreground/80" />
        ) : (
          <Building2 className="size-4 shrink-0 text-sidebar-foreground/80" />
        )}
        <div className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-[11px] font-black uppercase tracking-wide text-sidebar-foreground">
            {activeName}
          </span>
          <span className="truncate text-[9px] font-bold uppercase tracking-widest text-sidebar-foreground/50">
            {tenant.poloType === 'sales' ? 'Polo · Vendas' : 'Polo · Clínica'}
          </span>
        </div>
        <ChevronDown className="size-3.5 shrink-0 text-sidebar-foreground/50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Trocar de polo
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableTenants.map((polo) => {
          const isActive = polo.id === tenant.id
          return (
            <DropdownMenuItem
              key={polo.id}
              disabled={switching}
              onClick={() => {
                if (isActive) return
                void switchTenant(polo.id).catch((e) =>
                  toast.error(e instanceof Error ? e.message : 'Falha ao trocar de polo'),
                )
              }}
              className="gap-2"
            >
              {polo.poloType === 'sales' ? (
                <Pill className="size-4 shrink-0" />
              ) : (
                <Building2 className="size-4 shrink-0" />
              )}
              <div className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-xs font-semibold">{polo.brand.app_name || polo.name}</span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {polo.poloType === 'sales' ? 'Vendas' : 'Clínica'}
                </span>
              </div>
              {isActive ? <Check className="size-4 shrink-0 text-primary" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
