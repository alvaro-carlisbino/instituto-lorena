/**
 * O lock do GoTrue e o erro que ele cospe quando é roubado.
 *
 * Toda chamada de auth do supabase-js (`getSession`, `getUser`, refresh de token) entra na
 * fila de um lock exclusivo do navegador chamado `lock:sb-<ref>-auth-token`, compartilhado
 * entre TODAS as abas. Quem espera mais de 5s desiste, ROUBA o lock (`steal: true`) e segue
 * em frente; quem estava segurando recebe de volta:
 *
 *   Lock "lock:sb-fgyfpmnvlkmyxtucbxbu-auth-token" was released because another request stole it
 *
 * Isso não é falha de dado, de rede nem de permissão: a operação de quem roubou o lock
 * passou. É disputa de fila — três `getSession()` do boot, o `getUser()` do perfil e um
 * refresh de token que demorou (aba que dormiu a noite inteira) já bastam.
 *
 * Em 01/09/2026 esse erro subiu de `getMyProfile()` até `profileLoadFailed` e trancou o CRM
 * inteiro em "Não consegui carregar seu perfil", com os dados intactos do outro lado.
 * Repetir a chamada é o conserto: a fila já andou.
 */
export function isAuthLockError(erro: unknown): boolean {
  if (!erro || typeof erro !== 'object') return false
  const o = erro as { isAcquireTimeout?: unknown; name?: unknown; message?: unknown }
  // `isAcquireTimeout` é a marca oficial do auth-js, e a própria documentação dele pede para
  // checar essa propriedade em vez de `instanceof`: o erro pode vir de outra cópia do pacote
  // (o supabase-js embute a sua), e aí `instanceof` mente.
  if (o.isAcquireTimeout === true) return true
  if (o.name === 'NavigatorLockAcquireTimeoutError' || o.name === 'LockAcquireTimeoutError') return true
  const msg = typeof o.message === 'string' ? o.message : ''
  return /another request stole it|was not released within \d+ms/i.test(msg)
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Roda `fn` e repete SÓ quando o erro é disputa de lock do auth. Qualquer outro erro sobe na
 * hora: RLS, API fora, token inválido e sessão expirada precisam chegar na tela.
 */
export async function comRetryDeLock<T>(
  fn: () => Promise<T>,
  opcoes: { tentativas?: number; espera?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const { tentativas = 3, espera = dormir } = opcoes
  let ultimoErro: unknown
  for (let i = 0; i < tentativas; i += 1) {
    try {
      return await fn()
    } catch (erro) {
      if (!isAuthLockError(erro)) throw erro
      ultimoErro = erro
      // Espera curta e crescente: o lock foi roubado por alguém que está no meio de uma
      // chamada de rede, então voltar no mesmo instante só recoloca a briga na fila.
      if (i < tentativas - 1) await espera(120 * (i + 1))
    }
  }
  throw ultimoErro
}
