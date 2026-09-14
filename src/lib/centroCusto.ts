import type { CostCenter } from '@/services/financeiro'

/** Grupo dos centros que saem da conta e não são gasto: transferência entre contas, aplicação. */
export const GRUPO_FORA_DO_TOTAL = 'Não é gasto'

/** Centro que tira o dinheiro do total de gastos. */
export function centroForaDoTotal(centros: CostCenter[], nome: string | null | undefined): boolean {
  if (!nome) return false
  return centros.find((c) => c.name === nome)?.grupo === GRUPO_FORA_DO_TOTAL
}
