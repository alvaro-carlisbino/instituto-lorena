/**
 * Polo TRAVADO pelo endereço de acesso.
 *
 * A separação entre clínica e Tricopill não é mais só uma aba na barra lateral: cada polo
 * tem o seu endereço, e nele o outro negócio não existe. Some o seletor de workspace, a
 * busca ⌘K para de varrer o outro lado e um login do polo errado é barrado na porta.
 *
 * Um banco só, uma base de código só. O que muda por deploy é UMA variável.
 *
 * Como configurar (Vercel, um projeto por polo apontando para este mesmo repo):
 *   VITE_POLO_FIXO=instituto-lorena   → CRM da clínica
 *   VITE_POLO_FIXO=tricopill          → CRM do Tricopill
 *
 * Sem a variável, nada muda: o app volta a ser o de sempre, com o seletor de polo para
 * quem tem acesso aos dois. É de propósito — assim publicar este código não tranca
 * ninguém antes de o segundo endereço existir.
 */

/** Fallback por domínio, para quando a variável não foi configurada no deploy. */
function poloPeloHost(): string | null {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname.toLowerCase()
  // `localhost` e as URLs de preview da Vercel ficam de fora de propósito: em
  // desenvolvimento você precisa dos dois lados sem manter dois servidores de pé.
  if (host.includes('tricopill')) return 'tricopill'
  return null
}

/**
 * Polo deste endereço, ou `null` quando o app não está travado em nenhum.
 * Nunca devolve string vazia — quem chama só precisa testar `if (poloFixo)`.
 */
export function poloFixoDoDeploy(): string | null {
  const env = (import.meta.env.VITE_POLO_FIXO as string | undefined)?.trim()
  if (env) return env
  return poloPeloHost()
}

/** `true` quando este endereço serve um polo só. */
export function appTravadoEmUmPolo(): boolean {
  return poloFixoDoDeploy() !== null
}
