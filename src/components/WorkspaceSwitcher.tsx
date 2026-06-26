import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Loader2, Pill } from 'lucide-react'
import { toast } from 'sonner'

import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { setActiveTenant, type PoloOption } from '@/services/tenant'
import { cn } from '@/lib/utils'

/** Rótulo curto e ícone por tipo de polo (clínica vs vendas/Tricopill). */
function poloMeta(polo: PoloOption): { label: string; Icon: typeof Building2 } {
  if (polo.poloType === 'sales') return { label: polo.brand.app_name || 'Tricopill', Icon: Pill }
  return { label: polo.brand.app_name || 'Clínica', Icon: Building2 }
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
      className="flex items-center gap-1 rounded-2xl border border-sidebar-border/60 bg-sidebar-accent/20 p-1"
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
              'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-[11px] font-black uppercase tracking-wide transition-all',
              isActive
                ? 'bg-sidebar text-sidebar-foreground shadow-sm ring-1 ring-sidebar-border/70'
                : 'text-sidebar-foreground/45 hover:text-sidebar-foreground/80',
              busy && 'cursor-wait',
            )}
          >
            {isLoadingThis ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            ) : (
              <Icon className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
