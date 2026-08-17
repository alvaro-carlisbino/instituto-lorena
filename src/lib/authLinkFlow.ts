/**
 * O link de convite: quem entra por ele define a própria senha.
 *
 * Até 14/08/2026 o CRM só tinha login com e-mail e senha. Não havia "esqueci
 * minha senha" nem tela de primeiro acesso, então usuário novo dependia de
 * alguém digitar uma senha por ele em /usuarios e mandar por WhatsApp — senha em
 * texto, em conversa, e sem ninguém para trocar depois.
 *
 * O Supabase devolve o convite no HASH da URL (#access_token=…&type=invite). O
 * supabase-js consome e limpa esse hash assim que o cliente é criado, então a
 * leitura acontece aqui, na importação do módulo, ANTES de qualquer outra coisa
 * — e o que foi lido fica no sessionStorage, que sobrevive ao redirect e morre
 * quando ela fecha a aba.
 */

const CHAVE = 'crm:definir-senha'

/** Convite e recuperação chegam pelo mesmo caminho e terminam na mesma tela. */
const TIPOS_QUE_PEDEM_SENHA = new Set(['invite', 'recovery', 'signup'])

/**
 * Separada do `window` para poder ser testada: a suíte roda em node, sem DOM.
 * Aceita com ou sem o '#' da frente.
 */
export function tipoDoHash(hash: string): string | null {
  const limpo = hash.startsWith('#') ? hash.slice(1) : hash
  if (!limpo) return null
  const params = new URLSearchParams(limpo)
  // Sem access_token o link não autentica ninguém: é hash de rota, não de convite.
  if (!params.get('access_token')) return null
  const tipo = params.get('type')
  return tipo && TIPOS_QUE_PEDEM_SENHA.has(tipo) ? tipo : null
}

// Roda uma vez, na importação. main.tsx importa este módulo antes do App.
const tipoNaEntrada = typeof window === 'undefined' ? null : tipoDoHash(window.location.hash)
if (tipoNaEntrada && typeof sessionStorage !== 'undefined') {
  sessionStorage.setItem(CHAVE, tipoNaEntrada)
}

export function precisaDefinirSenha(): boolean {
  if (typeof sessionStorage === 'undefined') return false
  return sessionStorage.getItem(CHAVE) != null
}

/** Como ela chegou: muda só o texto da tela, não o que acontece. */
export function origemDoAcesso(): 'convite' | 'recuperacao' {
  if (typeof sessionStorage === 'undefined') return 'convite'
  return sessionStorage.getItem(CHAVE) === 'recovery' ? 'recuperacao' : 'convite'
}

export function concluirDefinicaoDeSenha(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(CHAVE)
}
