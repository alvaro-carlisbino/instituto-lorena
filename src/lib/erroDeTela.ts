import { supabase } from '@/lib/supabaseClient'

/**
 * Registro de erro de TELA (17/set/2026). Sem isto, erro de render vira tela branca sem rastro:
 * foi o caso da Aline Muniz, cujo navegador carregou tudo e parou. Grava em
 * `app_client_errors` (migration 20260917120000). Nunca lança: registrar o erro não pode
 * virar um segundo erro.
 */

const TETO_POR_SESSAO = 8
let enviados = 0
const vistos = new Set<string>()

export async function registrarErroDeTela(
  tipo: 'render' | 'window' | 'promise',
  erro: unknown,
  pilhaComponente?: string | null,
): Promise<void> {
  try {
    if (!supabase || enviados >= TETO_POR_SESSAO) return
    const e = erro instanceof Error ? erro : new Error(String(erro))
    const assinatura = `${tipo}|${e.message}|${window.location.pathname}`
    if (vistos.has(assinatura)) return
    vistos.add(assinatura)
    enviados += 1
    const { data } = await supabase.auth.getSession()
    const sessao = data.session
    if (!sessao) return
    await supabase.from('app_client_errors').insert({
      auth_user_id: sessao.user.id,
      email: sessao.user.email ?? null,
      tipo,
      rota: `${window.location.pathname}${window.location.search}`.slice(0, 500),
      mensagem: e.message.slice(0, 2000),
      pilha: (e.stack ?? '').slice(0, 8000),
      pilha_componente: (pilhaComponente ?? '').slice(0, 8000) || null,
      versao: String(import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA ?? import.meta.env.MODE ?? ''),
      user_agent: navigator.userAgent.slice(0, 300),
    })
  } catch {
    // sem rede, sem sessão, tabela ausente: o erro original já está na tela
  }
}

let instalado = false

/** Exceção que escapa fora do React (evento, timer, promessa) também fica registrada. */
export function instalarRegistroDeErros(): void {
  if (instalado || typeof window === 'undefined') return
  instalado = true
  window.addEventListener('error', (ev) => {
    void registrarErroDeTela('window', ev.error ?? ev.message)
  })
  window.addEventListener('unhandledrejection', (ev) => {
    void registrarErroDeTela('promise', ev.reason)
  })
}
