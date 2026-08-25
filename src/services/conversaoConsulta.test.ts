import { describe, expect, it } from 'vitest'

import {
  atrasoDeLancamento,
  faltaTipoDeConsulta,
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
    pacientes_tc: 10,
  },
  de_safra_anterior: { vendas: 0, receita_cents: 0 },
  sem_vinculo: { vendas: 0, receita_cents: 0 },
  outro_kind: { kind: 'protocolo', pacientes: 0 },
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

describe('faltaTipoDeConsulta', () => {
  it('avisa que o denominador ainda é toda consulta, e o quanto falta', () => {
    // 25/08/2026: a grade da Shosp não traz o serviço, só 16,2% das consultas do mês têm tipo.
    expect(faltaTipoDeConsulta(conv())).toBe(16.2)
  })

  it('cala a boca quando o card já mede só transplante', () => {
    expect(
      faltaTipoDeConsulta(
        conv({
          denominador: {
            tipo_usado: 'tc',
            cobertura_pct: 92.4,
            consultas_com_tipo: 160,
            consultas_no_mes: 173,
            pacientes_tc: 41,
          },
        }),
      ),
    ).toBeNull()
  })
})
