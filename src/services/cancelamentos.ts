import { supabase } from '@/lib/supabaseClient'

/**
 * Cancelamentos do mês na Central de Vendas: consulta, protocolo e cirurgia juntos
 * (pedido do Fabricio, 14/09/2026).
 *
 * As duas fontes contam por datas diferentes, e a tela precisa dizer isso:
 *   • venda cancelada entra pelo dia em que CANCELOU (`cancelada_em`), não pelo mês
 *     em que fechou;
 *   • consulta entra pela data da CONSULTA, porque a Shosp não guarda quando o
 *     horário foi desmarcado.
 *
 * Troca de horário no mesmo dia vem só contada (`trocas_de_horario`): na Shosp ela
 * também aparece como "Desmarcado", e somar isso seria inventar cancelamento.
 */

export type ConsultaDesmarcada = {
  codigo: string
  prontuario: string | null
  lead_id: string | null
  paciente: string | null
  data: string
  horario: string | null
  prestador: string | null
  servico: string | null
  /** O que a recepção escreveu no agendamento ("Pagou sinal", "a pedido da Dra Lorena"). */
  observacao: string | null
  /** Desmarcou e marcou outra consulta em até 90 dias. */
  remarcada_para: string | null
}

export type VendaCancelada = {
  id: string
  kind: 'cirurgia' | 'protocolo'
  lead_id: string | null
  paciente: string
  procedimento: string | null
  valor_cents: number
  vendida_em: string
  cancelada_em: string
  motivo: string | null
  estorno: string | null
  observacao: string | null
  vendedora: string | null
}

export type CancelamentosDoMes = {
  mes: string
  consultas: ConsultaDesmarcada[]
  trocas_de_horario: number
  vendas: VendaCancelada[]
  vendas_sem_data_de_cancelamento: number
}

export async function fetchCancelamentosDoMes(mes: string): Promise<CancelamentosDoMes | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('crm_cancelamentos_do_mes', { p_mes: mes })
  if (error) throw new Error(error.message)
  return (data as CancelamentosDoMes) ?? null
}

export type ResumoCancelamentos = {
  consultas: { qtd: number; remarcaram: number; semNovaData: number }
  protocolo: { qtd: number; valorCents: number }
  cirurgia: { qtd: number; valorCents: number }
  total: number
}

export function resumoCancelamentos(d: CancelamentosDoMes | null): ResumoCancelamentos {
  const consultas = d?.consultas ?? []
  const vendas = d?.vendas ?? []
  const remarcaram = consultas.filter((c) => c.remarcada_para != null).length
  const doTipo = (kind: VendaCancelada['kind']) => {
    const lista = vendas.filter((v) => v.kind === kind)
    return { qtd: lista.length, valorCents: lista.reduce((acc, v) => acc + (v.valor_cents ?? 0), 0) }
  }
  return {
    consultas: { qtd: consultas.length, remarcaram, semNovaData: consultas.length - remarcaram },
    protocolo: doTipo('protocolo'),
    cirurgia: doTipo('cirurgia'),
    total: consultas.length + vendas.length,
  }
}

export type LinhaCancelamento = {
  chave: string
  tipo: 'consulta' | 'protocolo' | 'cirurgia'
  /** A data que colocou a linha neste mês: a da consulta, ou a do cancelamento da venda. */
  data: string
  paciente: string
  leadId: string | null
  /** Serviço ou procedimento, e quem atenderia. */
  oque: string | null
  detalhe: string | null
  motivo: string | null
  valorCents: number | null
  estorno: string | null
  remarcadaPara: string | null
}

/**
 * "ROSA C. PETRUCCI DAVINA" → "Rosa C. Petrucci Davina". A agenda da Shosp devolve o
 * nome em caixa alta e a venda em caixa normal; lado a lado na mesma lista, a caixa
 * alta parece outro sistema gritando.
 */
export function nomeDoPaciente(nome: string | null): string {
  const limpo = (nome ?? '').trim()
  if (!limpo) return 'Paciente sem nome'
  if (limpo !== limpo.toLocaleUpperCase('pt-BR')) return limpo
  const minusculas = new Set(['da', 'das', 'de', 'do', 'dos', 'e'])
  return limpo
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1)))
    .join(' ')
}

/** Uma lista só, da data mais recente para a mais antiga, para ler o mês de uma vez. */
export function linhasDeCancelamento(d: CancelamentosDoMes | null): LinhaCancelamento[] {
  if (!d) return []
  const consultas: LinhaCancelamento[] = d.consultas.map((c) => ({
    chave: `consulta:${c.codigo}`,
    tipo: 'consulta',
    data: c.data,
    paciente: nomeDoPaciente(c.paciente),
    leadId: c.lead_id,
    oque: c.servico,
    detalhe: [c.horario?.slice(0, 5), c.prestador].filter(Boolean).join(' · ') || null,
    motivo: c.observacao,
    valorCents: null,
    estorno: null,
    remarcadaPara: c.remarcada_para,
  }))
  const vendas: LinhaCancelamento[] = d.vendas.map((v) => ({
    chave: `venda:${v.id}`,
    tipo: v.kind,
    data: v.cancelada_em,
    paciente: nomeDoPaciente(v.paciente),
    leadId: v.lead_id,
    oque: v.procedimento,
    detalhe: `vendida em ${v.vendida_em.slice(8, 10)}/${v.vendida_em.slice(5, 7)}/${v.vendida_em.slice(0, 4)}${
      v.vendedora ? ` · ${v.vendedora}` : ''
    }`,
    motivo: [v.motivo, v.observacao].filter(Boolean).join('. ') || null,
    valorCents: v.valor_cents,
    estorno: v.estorno,
    remarcadaPara: null,
  }))
  return [...consultas, ...vendas].sort((a, b) => b.data.localeCompare(a.data) || a.paciente.localeCompare(b.paciente, 'pt-BR'))
}
