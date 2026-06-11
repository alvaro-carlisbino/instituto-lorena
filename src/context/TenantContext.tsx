import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import {
  applyTenantBrandToCssVars,
  DEFAULT_TENANT,
  fetchCurrentTenant,
  fetchCurrentTenantBilling,
  fetchIsSuperAdmin,
  fetchMyTenants,
  setActiveTenant,
  type PoloOption,
  type Tenant,
} from '@/services/tenant'

type TenantContextValue = {
  tenant: Tenant
  /** Polos que o login atual pode acessar (≥2 => mostra o seletor de polo). */
  availableTenants: PoloOption[]
  /** Troca o polo ativo e recarrega o app sob o novo contexto (RLS segue). */
  switchTenant: (tenantId: string) => Promise<void>
  switching: boolean
  isSuperAdmin: boolean
  loading: boolean
  reload: () => Promise<void>
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<Tenant>(DEFAULT_TENANT)
  const [availableTenants, setAvailableTenants] = useState<PoloOption[]>([])
  const [switching, setSwitching] = useState<boolean>(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)

  const load = useMemo(
    () =>
      async () => {
        if (!isSupabaseConfigured || !supabase) {
          setTenant(DEFAULT_TENANT)
          setAvailableTenants([])
          setIsSuperAdmin(false)
          applyTenantBrandToCssVars(DEFAULT_TENANT.brand)
          return
        }
        setLoading(true)
        try {
          const [t, sa, billing, polos] = await Promise.all([
            fetchCurrentTenant(),
            fetchIsSuperAdmin(),
            fetchCurrentTenantBilling(),
            fetchMyTenants(),
          ])
          setTenant({ ...t, billing })
          setIsSuperAdmin(sa)
          setAvailableTenants(polos)
          applyTenantBrandToCssVars(t.brand)
        } finally {
          setLoading(false)
        }
      },
    [],
  )

  // Troca de polo: persiste o polo ativo (RLS passa a filtrar por ele) e recarrega
  // a aplicação para refazer todos os fetches sob o novo contexto + branding + nav.
  const switchTenant = useMemo(
    () =>
      async (tenantId: string) => {
        if (!isSupabaseConfigured || !supabase) return
        if (tenantId === tenant.id) return
        setSwitching(true)
        try {
          await setActiveTenant(tenantId)
          window.location.assign('/')
        } catch (e) {
          setSwitching(false)
          throw e
        }
      },
    [tenant.id],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Reagir a login/logout — quando a sessão muda, o tenant pode mudar (ou ficar vazio).
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void load()
    })
    return () => {
      sub.subscription.unsubscribe()
    }
  }, [load])

  const value = useMemo<TenantContextValue>(
    () => ({ tenant, availableTenants, switchTenant, switching, isSuperAdmin, loading, reload: load }),
    [tenant, availableTenants, switchTenant, switching, isSuperAdmin, loading, load],
  )

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext)
  if (!ctx) {
    throw new Error('useTenant must be used inside <TenantProvider>')
  }
  return ctx
}
