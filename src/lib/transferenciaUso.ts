// Transferência com uso (pedido do Álvaro, 24/09/2026): o material vai do Principal para o setor
// ("levou") e o setor dá baixa no que gastou ("usou"), no dia em que usou, que às vezes é ontem.
// Regras puras da tela; quem move o estoque é stock_transferir / stock_transferencia_editar.

export type LinhaLevouUsou = { itemId: string; qty: number; usado: number }

export type SituacaoDaTransferencia = 'cancelada' | 'usada' | 'parte' | 'no_setor'

const EPS = 1e-9

/**
 * Tudo usado, parte usada ou ainda no setor, olhando só as linhas que levaram alguma coisa
 * (linha zerada na edição não conta).
 */
export function situacaoDaTransferencia(t: { cancelledAt: string | null; items: LinhaLevouUsou[] }): SituacaoDaTransferencia {
  if (t.cancelledAt) return 'cancelada'
  const levadas = t.items.filter((i) => i.qty > EPS)
  if (levadas.length === 0) return 'no_setor'
  if (levadas.every((i) => i.usado >= i.qty - EPS)) return 'usada'
  if (levadas.some((i) => i.usado > EPS)) return 'parte'
  return 'no_setor'
}

export const ROTULO_SITUACAO: Record<SituacaoDaTransferencia, string> = {
  cancelada: 'Cancelada',
  usada: 'Tudo usado',
  parte: 'Parte usada',
  no_setor: 'No setor, sem baixa',
}

/** Usado nunca passa do que levou nem fica negativo. */
export function limitarUsado(usado: number, levou: number): number {
  return Math.min(Math.max(0, usado), Math.max(0, levou))
}

/** Só as linhas que mudaram, para o banco não regravar o que ficou igual. */
export function linhasAlteradas(antes: LinhaLevouUsou[], depois: LinhaLevouUsou[]): LinhaLevouUsou[] {
  const porItem = new Map(antes.map((l) => [l.itemId, l] as const))
  return depois.filter((l) => {
    const a = porItem.get(l.itemId)
    if (!a) return l.qty > EPS
    return Math.abs(a.qty - l.qty) > EPS || Math.abs(a.usado - l.usado) > EPS
  })
}

/** YYYY-MM-DD de `dias` antes de `hoje` (também YYYY-MM-DD), sem fuso no meio. */
export function diaAntes(hoje: string, dias: number): string {
  const [a, m, d] = hoje.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d - dias))
  return t.toISOString().slice(0, 10)
}

/** "hoje", "ontem" ou "23/09": como a equipe fala do dia do uso. */
export function rotuloDoDia(dia: string | null, hoje: string): string {
  if (!dia) return ''
  if (dia === hoje) return 'hoje'
  if (dia === diaAntes(hoje, 1)) return 'ontem'
  const [, m, d] = dia.split('-')
  return `${d}/${m}`
}

/** O banco recusa data futura e de mais de 30 dias: a tela avisa antes. */
export const LIMITE_DIAS_ATRAS = 30

export function diaValido(dia: string, hoje: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dia) && dia <= hoje && dia >= diaAntes(hoje, LIMITE_DIAS_ATRAS)
}
