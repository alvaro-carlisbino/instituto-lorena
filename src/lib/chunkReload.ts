/**
 * Recuperação de chunk que sumiu depois de um deploy.
 *
 * As telas entram por `lazy()`, então o navegador só busca o .js da tela na hora em que
 * você clica nela. Se um deploy aconteceu no meio da sessão, o `index.html` que está
 * aberto aponta para hashes que não existem mais no servidor: o import falha e a tela
 * fica branca. Foi o que aconteceu com `FinAccountsPage-g8oQneiy.js`.
 *
 * O certo nesse caso é recarregar — a página nova traz os hashes novos. Recarregamos no
 * máximo UMA vez por minuto, guardado em sessionStorage: se o chunk continuar faltando
 * por algum problema real de servidor, o app para de recarregar sozinho e deixa o erro
 * aparecer, em vez de entrar em laço infinito de refresh.
 */

const CHAVE = 'crm-chunk-reload-em'
const JANELA_MS = 60_000

function jaTentouRecentemente(agora: number): boolean {
  try {
    const bruto = window.sessionStorage.getItem(CHAVE)
    if (!bruto) return false
    const quando = Number(bruto)
    return Number.isFinite(quando) && agora - quando < JANELA_MS
  } catch {
    // sessionStorage bloqueado (aba anônima com restrição): sem guarda confiável,
    // é melhor não recarregar do que arriscar o laço.
    return true
  }
}

function marcarTentativa(agora: number) {
  try {
    window.sessionStorage.setItem(CHAVE, String(agora))
  } catch {
    /* idem */
  }
}

function ehErroDeChunk(motivo: unknown): boolean {
  const msg =
    motivo instanceof Error ? motivo.message : typeof motivo === 'string' ? motivo : ''
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    // Safari e Firefox usam texto próprio para o mesmo caso.
    msg.includes('Expected a JavaScript-or-Wasm module script')
  )
}

function recarregar(motivo: string) {
  const agora = Date.now()
  if (jaTentouRecentemente(agora)) {
    console.error(`[chunk] ${motivo} — já recarreguei há pouco, não vou insistir.`)
    return
  }
  marcarTentativa(agora)
  console.warn(`[chunk] ${motivo} — recarregando para pegar a versão nova.`)
  window.location.reload()
}

export function instalarRecuperacaoDeChunk() {
  // Evento do próprio Vite para falha de modulepreload.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    recarregar('preload de chunk falhou')
  })

  // O import dinâmico do React.lazy rejeita fora de qualquer try/catch nosso.
  window.addEventListener('unhandledrejection', (event) => {
    if (!ehErroDeChunk(event.reason)) return
    event.preventDefault()
    recarregar('import dinâmico falhou')
  })
}
