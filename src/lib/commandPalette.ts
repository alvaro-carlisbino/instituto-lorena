/**
 * A paleta de comandos (⌘K) guarda o próprio estado de aberto/fechado. Este evento
 * deixa qualquer botão da interface abri-la sem que ela precise virar contexto global
 * — o atalho de teclado existia, mas ninguém descobre um atalho sem botão.
 */
const COMMAND_PALETTE_EVENT = 'crm:open-command-palette'

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT))
}

export function onOpenCommandPalette(handler: () => void) {
  window.addEventListener(COMMAND_PALETTE_EVENT, handler)
  return () => window.removeEventListener(COMMAND_PALETTE_EVENT, handler)
}
