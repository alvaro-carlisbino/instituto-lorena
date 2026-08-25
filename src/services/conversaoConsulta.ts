import { supabase } from '@/lib/supabaseClient'

/**
 * Conversão da consulta em venda, nos dois cenários que a gerência acompanha
 * (pedido da Luana em 25/08/2026).
 *
 *   • cenarioMes      — das consultas GERADAS no mês, quantas fecharam venda ainda no mês.
 *                       É a safra: casa com a meta e com o fechamento.
 *   • cenarioFollowup — tudo o que FECHOU dentro do mês, de qualquer safra de consulta.
 *                       "Hoje, 25/08, vendeu um TC de uma consulta de 02/03" entra aqui.
 *                       É o caixa do mês, e a diferença para o primeiro é o follow-up.
 *
 * O segundo cenário já foi o contrário disso (a safra do mês contando o que fecharia
 * DEPOIS). Num mês em curso isso era sempre idêntico ao primeiro, e o painel mostrava
 * 7,0% e 7,0% — dois cards para a mesma informação.
 *
 * Denominador é PACIENTE, não agendamento — quem passa duas vezes no mês decide uma vez.
 * E é COMPARTILHADO com o outro tipo de venda: a mesma consulta pode virar cirurgia ou
 * protocolo, por isso `outro_kind` vem junto.
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
  /**
   * Que régua o denominador está usando. `tc` = só consulta de transplante, que é o que a
   * gerência mede; `todas` = qualquer consulta, o fallback enquanto a agenda não diz o tipo.
   * A grade da Shosp não devolve o serviço (só o endpoint por paciente), então o CRM preenche
   * isso aos poucos — e a RPC vira sozinha para `tc` quando a cobertura passa de 80%.
   */
  denominador: {
    tipo_usado: 'tc' | 'todas'
    cobertura_pct: number
    consultas_com_tipo: number
    consultas_no_mes: number
    pacientes_tc: number
  }
  cenario_mes: CenarioConversao
  cenario_followup: CenarioConversao
  /**
   * Vendas do mês que NÃO puderam ser ligadas a nenhuma consulta da agenda (sem prontuário na
   * venda nem no lead). Ficam fora da taxa de propósito: entrar no numerador sem existir no
   * denominador era o que fazia o card dividir duas populações diferentes.
   */
  /** Do que fechou no mês, quanto veio de consulta de mês anterior. É o follow-up do mês. */
  de_safra_anterior: { vendas: number; receita_cents: number }
  sem_vinculo: { vendas: number; receita_cents: number }
  /** O denominador é compartilhado: quantos daqueles mesmos pacientes fecharam o OUTRO tipo. */
  outro_kind: { kind: string; pacientes: number }
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
 * Quanto do que fechou no mês veio de consulta de OUTRO mês.
 *
 * Antes esta função subtraía os dois cenários, o que fazia sentido quando o segundo era a
 * mesma safra vista mais tarde. Agora o dado vem pronto da RPC: são as vendas do mês cuja
 * consulta é anterior ao mês. É o tamanho do follow-up dentro da janela que a gerência olha.
 */
export function ganhoDoFollowUp(c: ConversaoConsulta | null): {
  vendas: number
  receitaCents: number
  pontos: number | null
} {
  if (!c?.de_safra_anterior) return { vendas: 0, receitaCents: 0, pontos: null }
  return {
    vendas: c.de_safra_anterior.vendas,
    receitaCents: c.de_safra_anterior.receita_cents,
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

/**
 * A conta só fecha quando dá para dizer de QUEM veio a venda.
 *
 * O prontuário da venda é campo digitado à mão e costuma vir vazio (agosto/2026: 7 das 11
 * cirurgias), por isso a RPC tenta também o prontuário do lead. O que sobra sem vínculo não
 * entra na taxa — e precisa aparecer na tela, senão o card esconde venda em vez de medir.
 */
export function vendasForaDaConta(c: ConversaoConsulta | null): { vendas: number; receitaCents: number } {
  if (!c?.sem_vinculo) return { vendas: 0, receitaCents: 0 }
  return { vendas: c.sem_vinculo.vendas, receitaCents: c.sem_vinculo.receita_cents }
}

/**
 * O denominador ainda é "toda consulta" só porque falta o tipo na agenda?
 *
 * Devolve a cobertura quando a resposta é sim — é o que a tela precisa dizer para o número não
 * ser lido como conversão de transplante quando ainda é conversão de tudo.
 */
export function faltaTipoDeConsulta(c: ConversaoConsulta | null): number | null {
  if (!c?.denominador) return null
  if (c.denominador.tipo_usado === 'tc') return null
  return c.denominador.cobertura_pct
}
