/**
 * ALTURA FIXA das linhas da lista de leads — e não por capricho de layout: é o número
 * que a virtualização usa para saber onde cada linha começa e qual o tamanho do
 * espaçador. Mudar o padding ou o tamanho de fonte das linhas em LeadListRows.tsx
 * exige acertar estes valores no mesmo commit, senão a rolagem desalinha.
 *
 * Fixar é seguro porque toda célula corta em uma linha (truncate/line-clamp).
 */
export const LEAD_TABLE_ROW_HEIGHT = 36
export const LEAD_CARD_HEIGHT = 76

export function temperatureBadgeClass(t: string): string {
  const x = t.toLowerCase()
  if (x === 'hot' || x === 'quente') {
    return 'border-rose-200/80 bg-rose-50/90 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-100'
  }
  if (x === 'warm' || x === 'morno') {
    return 'border-amber-200/80 bg-amber-50/90 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/50 dark:text-amber-100'
  }
  if (x === 'cold' || x === 'frio') {
    return 'border-slate-200/80 bg-slate-50/90 text-slate-800 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200'
  }
  return 'border-border bg-muted/50 text-foreground'
}
