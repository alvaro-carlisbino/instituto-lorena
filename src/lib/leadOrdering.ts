/**
 * Onde um card encaixa entre os dois vizinhos do quadro, sem renumerar a coluna.
 *
 * O quadro guarda a ordem em `leads.position` (integer). Renumerar a etapa inteira a cada
 * movimentação custava uma escrita por card: em 27/ago/2026 uma coluna de 939 leads gerou
 * ~96 mil PATCHes numa hora e levou o banco a statement timeout. Posicionando pelos vizinhos,
 * a movimentação normal grava só o card que se moveu.
 *
 * Buraco na numeração é inofensivo — todo consumidor apenas ordena por `position`, nenhum
 * depende de ela ser contígua nem positiva.
 */
export type Positioned = { position: number }

/**
 * Devolve o número para o card que entra entre `before` e `after`, ou `null` quando não sobra
 * inteiro entre os dois (vizinhos consecutivos ou com posição repetida). No `null`, o chamador
 * renumera a etapa de destino com folga.
 */
export const slotBetween = (
  before: Positioned | undefined,
  after: Positioned | undefined,
): number | null => {
  if (before && after) {
    return after.position - before.position >= 2
      ? Math.floor((before.position + after.position) / 2)
      : null
  }
  if (before) return before.position + 1
  if (after) return after.position - 1
  return 1
}
