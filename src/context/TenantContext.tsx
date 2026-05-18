import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import {
  applyTenantBrandToCssVars,
  DEFAULT_TENANT,
  fetchCurrentTenant,
  fetchIsSuperAdmin,
  type Tenant,
} from '@/services/tenant'

type TenantContextValue = {
  tenant: Tenant
  isSuperAdmin: boolean
  loading: boolean
  reload: () => Promise<void>
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<Tenant>(DEFAULT_TENANT)
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)

  const load = useMemo(
    () =>
      async () => {
        if (!isSupabaseConfigured || !supabase) {
          setTenant(DEFAULT_TENANT)
          setIsSuperAdmin(false)
          applyTenantBrandToCssVars(DEFAULT_TENANT.brand)
          return
        }
        setLoading(true)
        try {
          const [t, sa] = await Promise.all([fetchCurrentTenant(), fetchIsSuperAdmin()])
          setTenant(t)
          setIsSuperAdmin(sa)
          applyTenantBrandToCssVars(t.brand)
        } finally {
          setLoading(false)
        }
      },
    [],
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
    () => ({ tenant, isSuperAdmin, loading, reload: load }),
    [tenant, isSuperAdmin, loading, load],
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
