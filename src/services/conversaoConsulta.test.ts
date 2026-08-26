import { describe, expect, it } from 'vitest'

import {
  atrasoDeLancamento,
  denominadorIncompleto,
  entraramPorVenda,
  taxaProjetada,
  ganhoDoFollowUp,
  vendasForaDaConta,
  type ConversaoConsulta,
} from './conversaoConsulta'

const conv = (over: Partial<ConversaoConsulta> = {}): ConversaoConsulta => ({
  mes: '2026-08',
  kind: 'cirurgia',
  em_curso: true,
  ate_dia: '2026-08-19',
  agendamentos: 129,
  pacientes: 96,
  cenario_mes: { vendas: 6, receita_cents: 21_420_000, pct: 6.3 },
  cenario_followup: { vendas: 6, receita_cents: 21_420_000, pct: 6.3 },
  denominador: {
    tipo_usado: 'todas',
    cobertura_pct: 16.2,
    consultas_com_tipo: 28,
    consultas_no_mes: 173,
    consultas_tc: 12,
    pacientes_tc: 10,
    entraram_por_venda: 0,
  },
  de_safra_anterior: { vendas: 0, receita_cents: 0 },
  sem_vinculo: { vendas: 0, receita_cents: 0 },
  outro_kind: { kind: 'protocolo', pacientes: 0 },
  outra_regua: {
    tipo_usado: 'tc',
    pacientes: 10,
    cenario_mes: { vendas: 6, receita_cents: 21_420_000, pct: 60 },
    cenario_followup: { vendas: 6, receita_cents: 21_420_000, pct: 60 },
  },
  ultima_venda_registrada: '2026-08-11',
  dias_sem_registro: 8,
  ...over,
})

describe('ganhoDoFollowUp', () => {
  it('mede o que fechou no mês vindo de consulta antiga (o pedido da gerência)', () => {
    // Agosto/2026, cirurgia: 13 vendas fecharam no mês, 2 delas de consulta de meses atrás.
    const g = ganhoDoFollowUp(
      conv({
        pacientes: 129,
        cenario_mes: { vendas: 10, receita_cents: 39_427_192, pct: 7.8 },
        cenario_followup: { vendas: 13, receita_cents: 49_421_192, pct: 10.1 },
        de_safra_anterior: { vendas: 2, receita_cents: 6_684_000 },
      }),
    )
    expect(g.vendas).toBe(2)
    expect(g.receitaCents).toBe(6_684_000)
    expect(g.pontos).toBe(2.3)
  })

  it('zero quando tudo o que fechou nasceu de consulta do próprio mês', () => {
    expect(ganhoDoFollowUp(conv()).vendas).toBe(0)
  })

  it('não quebra sem dado', () => {
    expect(ganhoDoFollowUp(null)).toEqual({ vendas: 0, receitaCents: 0, pontos: null })
  })
})

describe('atrasoDeLancamento', () => {
  it('acusa quando a venda digitada ficou para trás da agenda', () => {
    // O caso real de 19/08/2026: agenda até o dia 19, última venda lançada no 11.
    expect(atrasoDeLancamento(conv())).toBe(8)
  })

  it('dois dias de folga é operação normal, não alarme', () => {
    expect(atrasoDeLancamento(conv({ dias_sem_registro: 2 }))).toBeNull()
  })

  it('mês fechado não tem atraso a cobrar: ninguém vai lançar venda de mês passado', () => {
    expect(atrasoDeLancamento(conv({ em_curso: false, dias_sem_registro: 20 }))).toBeNull()
  })
})

describe('vendasForaDaConta', () => {
  it('mostra a venda que não casa com consulta nenhuma, em vez de somá-la na taxa', () => {
    // Julho/2026: 11 vendas de cirurgia sem prontuário que ligue a uma consulta da agenda.
    const f = vendasForaDaConta(conv({ sem_vinculo: { vendas: 11, receita_cents: 40_980_000 } }))
    expect(f.vendas).toBe(11)
    expect(f.receitaCents).toBe(40_980_000)
  })

  it('não quebra sem dado', () => {
    expect(vendasForaDaConta(null)).toEqual({ vendas: 0, receitaCents: 0 })
  })
})

describe('denominadorIncompleto', () => {
  it('acusa TETO enquanto a agenda não terminou de dizer o tipo', () => {
    // 26/08/2026: régua de TC ligada com 55,8% de cobertura. As 53 consultas sem tipo podem ser
    // de transplante e ainda não estão embaixo da conta.
    const d = denominadorIncompleto(
      conv({
        denominador: {
          tipo_usado: 'tc',
          cobertura_pct: 55.8,
          consultas_com_tipo: 67,
          consultas_no_mes: 120,
          consultas_tc: 24,
          pacientes_tc: 21,
          entraram_por_venda: 1,
        },
      }),
    )
    expect(d).toEqual({ coberturaPct: 55.8, consultasSemTipo: 53 })
  })

  it('cala a boca quando a agenda respondeu tudo', () => {
    expect(
      denominadorIncompleto(
        conv({
          denominador: {
            tipo_usado: 'tc',
            cobertura_pct: 100,
            consultas_com_tipo: 120,
            consultas_no_mes: 120,
            consultas_tc: 30,
            pacientes_tc: 26,
            entraram_por_venda: 0,
          },
        }),
      ),
    ).toBeNull()
  })

  it('não fala de denominador de transplante quando a régua é a clínica inteira', () => {
    // Protocolo continua medindo toda consulta: aviso de cobertura ali não quer dizer nada.
    expect(denominadorIncompleto(conv())).toBeNull()
  })
})

describe('entraramPorVenda', () => {
  it('conta quem entrou por ter fechado, não por ter consulta de transplante', () => {
    // Agosto/2026: R$ 49.500 fechados em 25/08 sobre "CONSULTA CLÍNICA FEMININA".
    expect(
      entraramPorVenda(
        conv({
          denominador: {
            tipo_usado: 'tc',
            cobertura_pct: 55.8,
            consultas_com_tipo: 67,
            consultas_no_mes: 120,
            consultas_tc: 24,
            pacientes_tc: 21,
            entraram_por_venda: 1,
          },
        }),
      ),
    ).toBe(1)
  })

  it('não quebra sem dado', () => {
    expect(entraramPorVenda(null)).toBe(0)
  })
})

describe('taxaProjetada', () => {
  const agosto = () =>
    conv({
      agendamentos: 26,
      pacientes: 21,
      cenario_mes: { vendas: 10, receita_cents: 39_427_192, pct: 47.6 },
      cenario_followup: { vendas: 11, receita_cents: 43_311_192, pct: 52.4 },
      denominador: {
        tipo_usado: 'tc',
        cobertura_pct: 55.8,
        consultas_com_tipo: 67,
        consultas_no_mes: 120,
        consultas_tc: 24,
        pacientes_tc: 21,
        entraram_por_venda: 1,
      },
    })

  it('mostra onde a taxa cai se as consultas sem tipo se parecerem com as conhecidas', () => {
    // Agosto/2026: 53 consultas sem serviço, 35,8% das tipadas são de transplante. O denominador
    // de 21 pacientes viraria ~36, e os 47,6% que a tela mede viram ~27,5%.
    const p = taxaProjetada(agosto())
    expect(p).toEqual({ pacientes: 36, pctSafra: 27.5, pctCaixa: 30.3 })
  })

  it('cala a boca quando a agenda classificou tudo: não há o que projetar', () => {
    expect(
      taxaProjetada(
        conv({
          denominador: {
            tipo_usado: 'tc',
            cobertura_pct: 100,
            consultas_com_tipo: 120,
            consultas_no_mes: 120,
            consultas_tc: 26,
            pacientes_tc: 21,
            entraram_por_venda: 0,
          },
        }),
      ),
    ).toBeNull()
  })

  it('não projeta na régua da clínica inteira, onde consulta sem tipo já está no denominador', () => {
    expect(taxaProjetada(conv())).toBeNull()
  })

  it('não quebra sem dado', () => {
    expect(taxaProjetada(null)).toBeNull()
  })
})
