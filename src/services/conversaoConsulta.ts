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
   * Que régua o denominador está usando. Em cirurgia é sempre `tc` (só consulta de transplante):
   * a Central de Vendas só fala de cirurgia, e medir a clínica inteira ali foi o que a gerência
   * mandou consertar em 26/08. `todas` sobrou para protocolo, que é vendido nos dois tipos de
   * consulta.
   *
   * `cobertura_pct` deixou de ser gatilho e virou selo de confiança: a grade da Shosp não devolve
   * o serviço (só a busca por paciente), então enquanto o CRM não termina de preencher, o
   * denominador de TC está incompleto e a taxa sai por cima.
   *
   * `entraram_por_venda` são os pacientes que entraram no denominador por terem FECHADO cirurgia
   * sem consulta de transplante identificada (a consulta clínica que virou cirurgia, ou a que
   * ainda está sem tipo). Sobem a taxa por construção, então vão declarados.
   */
  denominador: {
    tipo_usado: 'tc' | 'todas'
    cobertura_pct: number
    consultas_com_tipo: number
    consultas_no_mes: number
    consultas_tc: number
    pacientes_tc: number
    entraram_por_venda: number
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
  /**
   * A mesma conta com a régua oposta. Em cirurgia é a clínica inteira: fica na tela embaixo do
   * número de TC para a gerência ver as duas leituras sem trocar de filtro, e para ninguém
   * confundir 47,6% de transplante com 10,5% de tudo.
   */
  outra_regua: {
    tipo_usado: 'tc' | 'todas'
    pacientes: number
    cenario_mes: CenarioConversao
    cenario_followup: CenarioConversao
  }
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
 * O denominador de transplante está incompleto por falta de tipo na agenda?
 *
 * A régua de TC deixou de esperar a cobertura chegar a 60% (em 26/08 estava em 55,8% e subindo
 * devagar; o card ficaria mais um mês medindo a clínica inteira). O preço de virar antes é este:
 * consulta de transplante que ainda não tem tipo fica FORA do denominador, e taxa com denominador
 * pequeno demais sai por cima.
 *
 * Devolve o que falta preencher quando é o caso, para a tela dizer que o número é TETO, e null
 * quando a agenda já respondeu tudo.
 */
export function denominadorIncompleto(
  c: ConversaoConsulta | null,
): { coberturaPct: number; consultasSemTipo: number } | null {
  if (!c?.denominador || c.denominador.tipo_usado !== 'tc') return null
  const semTipo = c.denominador.consultas_no_mes - c.denominador.consultas_com_tipo
  if (semTipo <= 0) return null
  return { coberturaPct: c.denominador.cobertura_pct, consultasSemTipo: semTipo }
}

/**
 * A taxa de TC projetada sobre as consultas que a agenda não classifica.
 *
 * Em 26/08/2026 o backfill de tipo bateu no teto: das 56 consultas de agosto sem serviço, 53
 * foram consultadas paciente por paciente na mesma hora e a Shosp devolveu a agenda SEM o campo
 * `servico`. Não é fila atrasada, é dado que não existe do outro lado. O prestador também não
 * salva: a Dra. Lorena aparece com 44,7% e 72,7% de TC conforme a grafia do nome na agenda.
 *
 * Ficar só com o número medido seria vender 47,6% de conversão de transplante quando o
 * denominador conhecido é menos da metade do real. Esta função aplica às consultas sem tipo a
 * mesma proporção de transplante das que TÊM tipo e devolve o outro extremo da faixa. Não é
 * previsão, é o piso da leitura: se as consultas escondidas se parecerem com as conhecidas, é
 * nele que a taxa cai.
 */
export function taxaProjetada(
  c: ConversaoConsulta | null,
): { pacientes: number; pctSafra: number; pctCaixa: number } | null {
  const d = c?.denominador
  if (!c || !d || d.tipo_usado !== 'tc') return null
  const semTipo = d.consultas_no_mes - d.consultas_com_tipo
  if (semTipo <= 0 || d.consultas_com_tipo <= 0 || c.agendamentos <= 0 || c.pacientes <= 0) return null

  const proporcaoTc = d.consultas_tc / d.consultas_com_tipo
  // De consulta para paciente: quem passa duas vezes no mês decide uma vez, e o denominador conta
  // paciente. A régua atual já dá essa razão medida.
  const pacientesPorConsulta = c.pacientes / c.agendamentos
  const escondidos = semTipo * proporcaoTc * pacientesPorConsulta
  const projetado = c.pacientes + escondidos
  if (projetado <= 0) return null

  const arredonda = (n: number) => Number(n.toFixed(1))
  return {
    pacientes: Math.round(projetado),
    pctSafra: arredonda((100 * c.cenario_mes.vendas) / projetado),
    pctCaixa: arredonda((100 * c.cenario_followup.vendas) / projetado),
  }
}

/**
 * Pacientes que entraram no denominador por terem fechado cirurgia sem consulta de transplante
 * identificada. Agosto/2026 tem um caso real: R$ 49.500 fechados sobre "CONSULTA CLÍNICA
 * FEMININA".
 *
 * A decisão (Álvaro, 26/08) foi não esconder venda de cirurgia num painel de cirurgia. Como só
 * entra quem CONVERTEU, cada um destes sobe a taxa por construção, e é por isso que a tela conta
 * quantos são em vez de embutir calado.
 */
export function entraramPorVenda(c: ConversaoConsulta | null): number {
  return c?.denominador?.entraram_por_venda ?? 0
}
