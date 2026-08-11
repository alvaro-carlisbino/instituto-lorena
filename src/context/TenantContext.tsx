import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import {
  applyTenantBrandToCssVars,
  DEFAULT_TENANT,
  fetchCurrentTenant,
  fetchCanViewFinance,
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
  /** Financeiro (extrato, contas, conciliação) só aparece para quem tem a permissão. */
  canViewFinance: boolean
  loading: boolean
  reload: () => Promise<void>
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<Tenant>(DEFAULT_TENANT)
  const [availableTenants, setAvailableTenants] = useState<PoloOption[]>([])
  const [switching, setSwitching] = useState<boolean>(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false)
  const [canViewFinance, setCanViewFinance] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)

  /**
   * `silencioso` = revalidação de fundo, sem ligar `loading`.
   *
   * `loading` desmonta tela: o FinanceOnly faz `if (loading) return null`, e quem estiver
   * preenchendo um formulário perde tudo. Isso acontecia toda vez que a aba voltava do
   * foco — o usuário ia ao Google, voltava, e o que estava mexendo tinha sumido. Ligar
   * `loading` só faz sentido na PRIMEIRA carga, quando de fato não há nada na tela.
   */
  const load = useMemo(
    () =>
      async (silencioso = false) => {
        if (!isSupabaseConfigured || !supabase) {
          setTenant(DEFAULT_TENANT)
          setAvailableTenants([])
          setIsSuperAdmin(false)
          setCanViewFinance(false)
          applyTenantBrandToCssVars(DEFAULT_TENANT.brand)
          return
        }
        if (!silencioso) setLoading(true)
        try {
          const [t, sa, billing, polos, finance] = await Promise.all([
            fetchCurrentTenant(),
            fetchIsSuperAdmin(),
            fetchCurrentTenantBilling(),
            fetchMyTenants(),
            fetchCanViewFinance(),
          ])
          setTenant({ ...t, billing })
          setIsSuperAdmin(sa)
          setCanViewFinance(finance)
          setAvailableTenants(polos)
          applyTenantBrandToCssVars(t.brand)
        } finally {
          if (!silencioso) setLoading(false)
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
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      // TOKEN_REFRESHED dispara toda vez que a aba volta ao foco e o cliente revalida a
      // sessão. Não muda tenant, não muda permissão, não muda nada — e era ele que
      // desmontava a tela inteira e apagava o formulário de quem só foi olhar o Google.
      // USER_UPDATED idem: mexe no perfil do auth, não em quem é o polo.
      if (evento === 'TOKEN_REFRESHED' || evento === 'USER_UPDATED') return
      // Recarga de fundo quando já existe tela montada; só o primeiro load pode piscar.
      void load(evento === 'INITIAL_SESSION' ? false : true)
    })
    return () => {
      sub.subscription.unsubscribe()
    }
  }, [load])

  const value = useMemo<TenantContextValue>(
    () => ({ tenant, availableTenants, switchTenant, switching, isSuperAdmin, canViewFinance, loading, reload: load }),
    [tenant, availableTenants, switchTenant, switching, isSuperAdmin, canViewFinance, loading, load],
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
