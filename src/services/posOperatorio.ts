import { supabase } from '@/lib/supabaseClient'

/**
 * Acompanhamento pós-cirúrgico: quem operou, quem voltou, quem sumiu.
 *
 * Junta três sistemas que já sabiam tudo separados — a SALA (espelho srg_*) sabe
 * quem operou, a SHOSP sabe quem voltou, a LOJA sabe quem comprou produto. O elo
 * com a loja é o telefone, porque o paciente da clínica e o cliente do Tricopill
 * são leads diferentes, em polos diferentes.
 *
 * Situação de cada marco:
 *   veio        — houve consulta na janela e a data já passou
 *   agendado    — há consulta marcada na janela, ainda por acontecer
 *   nao_veio    — a janela fechou e não houve consulta. É a única que vira cobrança
 *   aguardando  — a janela ainda não fechou
 *   sem_vinculo — o paciente não tem prontuário, então não dá para perguntar à
 *                 Shosp se ele voltou. É buraco de cadastro, não falta.
 */

export type SituacaoMarco = 'veio' | 'agendado' | 'nao_veio' | 'aguardando' | 'sem_vinculo'

export type MarcoRetorno = {
  ordem: number
  marco: string
  previsto: string
  situacao: SituacaoMarco
  veio_em: string | null
  agendado_para: string | null
}

export type PacientePosOp = {
  surgery_id: number | null
  sale_id: string | null
  dia: string
  dias_desde: number
  prontuario: string | null
  lead_id: string | null
  paciente: string | null
  telefone: string | null
  procedimento: string | null
  marcos: MarcoRetorno[]
  /** Marco mais recente vencido sem consulta. É o motivo da ligação de hoje. */
  marco_devendo: string | null
  vencido_ha: number | null
  retornos_feitos: number
  retornos_perdidos: number
  comprou_produto: boolean
  produto_cents: number
  ultima_compra: string | null
}

export const SITUACAO_LABEL: Record<SituacaoMarco, string> = {
  veio: 'Veio',
  agendado: 'Agendado',
  nao_veio: 'Não veio',
  aguardando: 'A vencer',
  sem_vinculo: 'Sem prontuário',
}

export async function listarPosOperatorio(desdeDias = 400): Promise<PacientePosOp[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('crm_pos_operatorio', { p_desde_dias: desdeDias })
  if (error) throw new Error(error.message)
  return (data ?? []) as PacientePosOp[]
}

/** Aniversário da cirurgia: a data que o Álvaro quer ver chegando. */
export function aniversarioDaCirurgia(dia: string, anos = 1): string {
  const [a, m, d] = dia.split('-').map(Number)
  return `${a + anos}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export type FiltroPosOp = 'todos' | 'devendo' | 'aniversario' | 'sem-produto' | 'sem-prontuario'

/**
 * O recorte da tela. Mora aqui, e não no componente, porque é a regra que decide
 * quem entra na fila de cobrança da recepção.
 *
 * `aniversario` compara MÊS, não dia: a pergunta é "quem faz um ano neste mês para
 * a gente convidar", e não "quem faz um ano exatamente hoje" — essa lista teria
 * uma pessoa por dia e ninguém trabalharia com ela.
 */
export function filtrarPosOp(
  lista: PacientePosOp[],
  filtro: FiltroPosOp,
  mesAniversario: string,
  termo: string,
): PacientePosOp[] {
  const busca = termo.trim().toLowerCase()
  return lista.filter((p) => {
    if (filtro === 'devendo' && !p.marco_devendo) return false
    if (filtro === 'sem-produto' && p.comprou_produto) return false
    if (filtro === 'sem-prontuario' && p.prontuario) return false
    if (filtro === 'aniversario' && !aniversarioDaCirurgia(p.dia).startsWith(mesAniversario)) return false
    if (!busca) return true
    return [p.paciente, p.telefone, p.procedimento, p.prontuario]
      .filter((v): v is string => !!v)
      .some((v) => v.toLowerCase().includes(busca))
  })
}

export function resumoPosOp(lista: PacientePosOp[]) {
  const comProntuario = lista.filter((p) => p.prontuario)
  const feitos = comProntuario.reduce((s, p) => s + p.retornos_feitos, 0)
  const perdidos = comProntuario.reduce((s, p) => s + p.retornos_perdidos, 0)
  return {
    pacientes: lista.length,
    devendo: lista.filter((p) => p.marco_devendo).length,
    compraram: lista.filter((p) => p.comprou_produto).length,
    receitaProdutoCents: lista.reduce((s, p) => s + (p.produto_cents ?? 0), 0),
    semProntuario: lista.length - comProntuario.length,
    feitos,
    perdidos,
    // Comparecimento só faz sentido sobre quem dá para conferir na Shosp. Somar os
    // sem prontuário no denominador afundaria a taxa por falta de cadastro.
    comparecimentoPct: feitos + perdidos > 0 ? Math.round((100 * feitos) / (feitos + perdidos)) : null,
  }
}
