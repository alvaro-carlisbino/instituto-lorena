import { describe, expect, it } from 'vitest'

import { atrasoDeLancamento, ganhoDoFollowUp, type ConversaoConsulta } from './conversaoConsulta'

const conv = (over: Partial<ConversaoConsulta> = {}): ConversaoConsulta => ({
  mes: '2026-08',
  kind: 'cirurgia',
  em_curso: true,
  ate_dia: '2026-08-19',
  agendamentos: 129,
  pacientes: 96,
  cenario_mes: { vendas: 6, receita_cents: 21_420_000, pct: 6.3 },
  cenario_followup: { vendas: 6, receita_cents: 21_420_000, pct: 6.3 },
  ultima_venda_registrada: '2026-08-11',
  dias_sem_registro: 8,
  ...over,
})

describe('ganhoDoFollowUp', () => {
  it('mede o que só existiu porque alguém ligou de volta', () => {
    // Junho/2026, protocolo: 35,6% viraram 47,5% por causa do follow-up.
    const g = ganhoDoFollowUp(
      conv({
        em_curso: false,
        pacientes: 118,
        cenario_mes: { vendas: 42, receita_cents: 17_935_300, pct: 35.6 },
        cenario_followup: { vendas: 56, receita_cents: 23_734_300, pct: 47.5 },
      }),
    )
    expect(g.vendas).toBe(14)
    expect(g.receitaCents).toBe(5_799_000)
    expect(g.pontos).toBe(11.9)
  })

  it('zero quando tudo fechou dentro do mês', () => {
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
