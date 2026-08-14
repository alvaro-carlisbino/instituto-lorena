import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { poloFixoDoDeploy } from '@/lib/poloFixo'
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
  /**
   * Polo ao qual ESTE endereço está preso (`VITE_POLO_FIXO`), ou null no app sem trava.
   * Quem tem valor aqui não mostra seletor de workspace nem busca no outro polo.
   */
  poloFixo: string | null
  /**
   * Preenchido quando o login não pertence ao polo deste endereço: a pessoa entrou no
   * CRM errado. A UI mostra a porta certa em vez de uma tela vazia sem explicação.
   */
  poloBloqueado: string | null
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState<Tenant>(DEFAULT_TENANT)
  const [availableTenants, setAvailableTenants] = useState<PoloOption[]>([])
  const [switching, setSwitching] = useState<boolean>(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false)
  const [canViewFinance, setCanViewFinance] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [poloBloqueado, setPoloBloqueado] = useState<string | null>(null)
  const poloFixo = useMemo(() => poloFixoDoDeploy(), [])
  /**
   * Trava anti-loop. Se `set_active_tenant` falhar em silêncio (RPC velha, permissão),
   * sem isto o load se chamaria para sempre tentando alinhar o polo.
   */
  const alinhandoPolo = useRef(false)

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
        const buscar = () =>
          Promise.all([
            fetchCurrentTenant(),
            fetchIsSuperAdmin(),
            fetchCurrentTenantBilling(),
            fetchMyTenants(),
            fetchCanViewFinance(),
          ])
        try {
          let [t, sa, billing, polos, finance] = await buscar()

          // Endereço travado num polo: alinhar o polo ativo do login ao do endereço.
          //
          // O `active_tenant_id` é persistido por PESSOA, não por aba. Sem este alinhamento,
          // quem tivesse deixado o polo ativo no outro negócio abriria o CRM da clínica e
          // veria o Tricopill. É isto que faz a trava valer para quem tem os dois acessos.
          if (poloFixo && t.id !== poloFixo && !alinhandoPolo.current) {
            if (polos.some((p) => p.id === poloFixo)) {
              alinhandoPolo.current = true
              try {
                await setActiveTenant(poloFixo)
                ;[t, sa, billing, polos, finance] = await buscar()
              } catch (e) {
                console.warn('[polo] falha ao alinhar com o endereço:', e instanceof Error ? e.message : String(e))
              } finally {
                alinhandoPolo.current = false
              }
            } else if (polos.length > 0) {
              // Login de um polo no endereço do outro. Não há o que trocar: esta pessoa
              // não tem acesso a este CRM. Melhor dizer isso do que servir tela vazia.
              setPoloBloqueado(poloFixo)
              setTenant({ ...t, billing })
              setIsSuperAdmin(sa)
              setCanViewFinance(false)
              setAvailableTenants([])
              return
            }
            // `polos` vazio é IGNORÂNCIA, não negativa: sessão ainda subindo, RPC que
            // falhou, 401 transitório. Barrar aqui trancaria gente legítima para fora do
            // CRM inteiro por causa de um soluço de rede. Falhar aberto aqui é seguro:
            // quem manda no dado é a RLS, e o polo ativo continua sendo o do banco.
          }

          setPoloBloqueado(null)
          setTenant({ ...t, billing })
          setIsSuperAdmin(sa)
          setCanViewFinance(finance)
          // Com endereço travado o seletor de workspace some, mas a lista continua
          // alimentando os rótulos de polo em /leads e no Kanban.
          setAvailableTenants(polos)
          applyTenantBrandToCssVars(t.brand)
        } finally {
          if (!silencioso) setLoading(false)
        }
      },
    [poloFixo],
  )

  // Troca de polo: persiste o polo ativo (RLS passa a filtrar por ele) e recarrega
  // a aplicação para refazer todos os fetches sob o novo contexto + branding + nav.
  const switchTenant = useMemo(
    () =>
      async (tenantId: string) => {
        if (!isSupabaseConfigured || !supabase) return
        if (tenantId === tenant.id) return
        // Endereço travado não troca de polo, nem por caminho indireto (⌘K abrindo alguém
        // do outro negócio). Quem precisa do outro lado abre o endereço do outro lado.
        if (poloFixo) throw new Error('Este CRM atende um negócio só. Abra o endereço do outro polo.')
        setSwitching(true)
        try {
          await setActiveTenant(tenantId)
          window.location.assign('/')
        } catch (e) {
          setSwitching(false)
          throw e
        }
      },
    [tenant.id, poloFixo],
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
    () => ({
      tenant,
      availableTenants,
      switchTenant,
      switching,
      isSuperAdmin,
      canViewFinance,
      loading,
      reload: load,
      poloFixo,
      poloBloqueado,
    }),
    [
      tenant,
      availableTenants,
      switchTenant,
      switching,
      isSuperAdmin,
      canViewFinance,
      loading,
      load,
      poloFixo,
      poloBloqueado,
    ],
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
