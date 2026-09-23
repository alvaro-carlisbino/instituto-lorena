import type { CostCenter } from '@/services/financeiro'

/** Grupo dos centros que saem da conta e não são gasto: transferência entre contas, aplicação. */
export const GRUPO_FORA_DO_TOTAL = 'Não é gasto'

/** Centro que tira o dinheiro do total de gastos. */
export function centroForaDoTotal(centros: CostCenter[], nome: string | null | undefined): boolean {
  if (!nome) return false
  return centros.find((c) => c.name === nome)?.grupo === GRUPO_FORA_DO_TOTAL
}

/**
 * Compra do cartão da empresa que ainda não se sabe se foi da clínica ou pessoal (Mercado Livre).
 * Fica no grupo "Não é gasto", mas é pergunta e não resposta: a tela cobra em âmbar.
 */
export const CENTRO_A_CONFIRMAR = 'Pessoal ou empresa?'
