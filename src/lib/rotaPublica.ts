import { poloFixoDoDeploy } from './poloFixo'

/**
 * A landing /consulta e o resto do CRM são dois mundos.
 *
 * Quem chega pelo anúncio não tem login: não pode pagar o boot do painel (auth +
 * retrato do CRM) para ler uma página de vendas. Esta função decide, antes de montar
 * qualquer coisa, qual dos dois vai para a tela.
 *
 * O polo do endereço manda: no deploy do Tricopill a landing da clínica não existe.
 */
export function ehLandingDaClinica(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.pathname.includes('/consulta') && poloFixoDoDeploy() !== 'tricopill'
}
