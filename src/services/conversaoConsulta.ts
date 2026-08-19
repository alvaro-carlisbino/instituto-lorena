import { supabase } from '@/lib/supabaseClient'

/**
 * Conversão da consulta em venda, nos dois cenários.
 *
 *   • cenarioMes      — das consultas do mês, quantas fecharam venda AINDA no mês.
 *                       É o número que casa com o fechamento e com a meta.
 *   • cenarioFollowup — das MESMAS consultas, quantas fecharam em qualquer momento,
 *                       inclusive meses depois. Mede o trabalho de recuperação.
 *
 * A diferença entre os dois é o tamanho do follow-up. Em junho/2026 o protocolo saiu
 * de 35,6% para 47,5%: um terço daquelas vendas não existiria sem alguém ligar de volta.
 *
 * Denominador é PACIENTE, não agendamento — quem passa duas vezes no mês decide uma vez.
 */

export type CenarioConversao = {
  vendas: number
  receita_cents: number
  pct: number | null
}

export type ConversaoConsulta = {
  mes: string
  kind: string
  em_curso: boolean
  ate_dia: string
  agendamentos: number
  pacientes: number
  cenario_mes: CenarioConversao
  cenario_followup: CenarioConversao
  /** Última venda LANÇADA no mês. O lançamento atrasa e a agenda não. */
  ultima_venda_registrada: string | null
  dias_sem_registro: number | null
}

export async function fetchConversaoConsulta(mes: string, kind: string): Promise<ConversaoConsulta | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('crm_conversao_consulta', { p_mes: mes, p_kind: kind })
  if (error) throw new Error(error.message)
  return (data as ConversaoConsulta) ?? null
}

/**
 * Quanto o follow-up acrescentou àquela safra de consultas.
 *
 * Vive fora do componente porque é a leitura que justifica a existência do segundo
 * cenário — e porque "quantas vendas o follow-up trouxe" é pergunta que vai
 * aparecer em relatório, não só na tela.
 */
export function ganhoDoFollowUp(c: ConversaoConsulta | null): {
  vendas: number
  receitaCents: number
  pontos: number | null
} {
  if (!c) return { vendas: 0, receitaCents: 0, pontos: null }
  return {
    vendas: c.cenario_followup.vendas - c.cenario_mes.vendas,
    receitaCents: c.cenario_followup.receita_cents - c.cenario_mes.receita_cents,
    pontos:
      c.cenario_followup.pct != null && c.cenario_mes.pct != null
        ? Number((c.cenario_followup.pct - c.cenario_mes.pct).toFixed(1))
        : null,
  }
}

/**
 * O card pode ser lido, ou o lançamento de venda está atrasado demais?
 *
 * A agenda da Shosp entra sozinha e vai até hoje; a venda é digitada à mão e
 * atrasa. Em 19/08/2026 a última venda lançada era de 11/08 — dividir consulta de
 * 19 dias por venda de 11 dava 6,3% onde a realidade era outra. Dois dias de folga
 * é operação normal; daí para cima o número vira piso, e a tela precisa dizer.
 */
export function atrasoDeLancamento(c: ConversaoConsulta | null): number | null {
  if (!c || !c.em_curso || c.dias_sem_registro == null) return null
  return c.dias_sem_registro > 2 ? c.dias_sem_registro : null
}
