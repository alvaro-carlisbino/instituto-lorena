/**
 * Dia de calendário no fuso do NEGÓCIO (America/Sao_Paulo).
 *
 * O padrão espalhado pelo sistema era `new Date().toISOString().slice(0, 10)`, que devolve o
 * dia em UTC. Entre 21h e meia-noite de Brasília o UTC já virou, então:
 *   - um pagamento lançado às 22h era gravado com a data de AMANHÃ;
 *   - "hoje" nas listas de contas a pagar e a receber apontava para o dia seguinte;
 *   - o nome do CSV exportado saía com a data errada;
 *   - gráficos por dia jogavam o evento da noite no dia seguinte.
 *
 * Também substitui as correções manuais de fuso que existiam soltas (`- 3 * 3_600_000` e
 * `getTimezoneOffset()`): elas funcionam hoje porque o Brasil não tem mais horário de verão,
 * mas quebram se voltar, e nada garante que o navegador do usuário esteja em BRT (a equipe
 * pode abrir de outro fuso, e o relatório continua sendo da clínica em Maringá).
 *
 * `toLocaleDateString('en-CA')` formata como YYYY-MM-DD e respeita o fuso pedido.
 */

export const FUSO_NEGOCIO = 'America/Sao_Paulo'

/** YYYY-MM-DD de uma data qualquer, no fuso do negócio. */
export function diaLocal(valor: Date | string | number): string {
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { timeZone: FUSO_NEGOCIO })
}

/** YYYY-MM-DD de hoje, no fuso do negócio. */
export function hojeLocal(): string {
  return diaLocal(new Date())
}

/** YYYY-MM-DD daqui a N dias (N negativo anda para trás), no fuso do negócio. */
export function diaLocalComOffset(dias: number): string {
  return diaLocal(new Date(Date.now() + dias * 86_400_000))
}
