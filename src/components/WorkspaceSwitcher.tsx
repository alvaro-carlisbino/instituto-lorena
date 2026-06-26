import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Loader2, Pill } from 'lucide-react'
import { toast } from 'sonner'

import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { setActiveTenant, type PoloOption } from '@/services/tenant'
import { cn } from '@/lib/utils'

/** Rótulo CURTO e ícone por tipo de polo (nome de marca completo é longo demais
 *  p/ um toggle compacto). Clínica vs Tricopill (vendas). */
function poloMeta(polo: PoloOption): { label: string; Icon: typeof Building2 } {
  if (polo.poloType === 'sales') return { label: 'Tricopill', Icon: Pill }
  return { label: 'Clínica', Icon: Building2 }
}

/**
 * Switcher de workspace — separa visualmente as visões Clínica ⟷ Tricopill no mesmo
 * login. Toggle segmentado (não dropdown): fica sempre óbvio em qual negócio você está.
 * Troca in-place (sem recarregar o app inteiro): persiste o polo ativo, recarrega
 * branding/abas e re-puxa os dados. Em qualquer falha, cai num reload confiável.
 * Só aparece quando o usuário pertence a 2+ polos.
 */
export function WorkspaceSwitcher() {
  const { tenant, availableTenants, reload } = useTenant()
  const crm = useCrm()
  const navigate = useNavigate()
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)

  if (availableTenants.length < 2) return null

  const busy = switchingTo !== null

  const handleSwitch = async (id: string) => {
    if (busy || id === tenant.id) return
    setSwitchingTo(id)
    try {
      await setActiveTenant(id) // persiste polo ativo -> current_tenant_id() passa a escopar nele
      await reload() // poloType + branding + abas da sidebar
      await crm.syncFromSupabase() // dados sob o novo contexto
      navigate('/dashboard') // tela válida nos dois polos
    } catch (e) {
      // Rede de segurança: estado parcial é pior que um reload — recarrega limpo.
      toast.error(e instanceof Error ? e.message : 'Falha ao trocar de workspace')
      window.location.assign('/')
      return
    } finally {
      setSwitchingTo(null)
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Trocar workspace"
      className="flex w-full items-center gap-1 rounded-xl border border-sidebar-border/50 bg-sidebar-accent/20 p-1"
    >
      {availableTenants.map((polo) => {
        const isActive = polo.id === tenant.id
        const { label, Icon } = poloMeta(polo)
        const isLoadingThis = switchingTo === polo.id
        return (
          <button
            key={polo.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={busy}
            onClick={() => void handleSwitch(polo.id)}
            title={polo.brand.app_name || polo.name}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold tracking-wide transition-all',
              isActive
                ? 'bg-sidebar text-sidebar-foreground shadow-sm ring-1 ring-sidebar-border/60'
                : 'text-sidebar-foreground/45 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/75',
              busy && 'cursor-wait',
            )}
          >
            {isLoadingThis ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            ) : (
              <Icon className={cn('size-3.5 shrink-0', isActive ? 'opacity-100' : 'opacity-70')} />
            )}
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
