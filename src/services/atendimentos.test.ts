import { describe, expect, it } from 'vitest'

import { type Atendimento, resumoPorSemana, segundaDaSemana } from './atendimentos'

/**
 * A conta que a Aline fazia contando linha colorida na planilha. Se ela errar, ela erra
 * baixo — e ninguém percebe, porque 43% e 57% são igualmente plausíveis numa semana de
 * sete atendimentos.
 */

const atendimento = (over: Partial<Atendimento>): Atendimento => ({
  id: Math.random().toString(36).slice(2),
  leadId: 'lead-1',
  paciente: 'Fulano',
  telefone: null,
  cidade: null,
  email: null,
  origem: null,
  tipo: 'consulta',
  indicacao: 'cirurgia',
  atendidoEm: '2026-09-02',
  medico: null,
  observacao: null,
  fonte: 'manual',
  fechou: false,
  vendaEm: null,
  valorCents: null,
  coluna: 'atendimento',
  ...over,
})

describe('segundaDaSemana', () => {
  it('devolve a própria segunda', () => {
    expect(segundaDaSemana('2026-08-31')).toBe('2026-08-31')
  })

  it('puxa o domingo para a segunda ANTERIOR (a semana da clínica termina no domingo)', () => {
    expect(segundaDaSemana('2026-09-06')).toBe('2026-08-31')
  })

  it('puxa o meio da semana para a segunda', () => {
    expect(segundaDaSemana('2026-09-03')).toBe('2026-08-31')
  })
})

describe('resumoPorSemana', () => {
  it('agrupa por semana e calcula a porcentagem de fechamento', () => {
    const semanas = resumoPorSemana([
      atendimento({ atendidoEm: '2026-08-31', fechou: true, valorCents: 1_500_000 }),
      atendimento({ atendidoEm: '2026-09-02', fechou: false }),
      atendimento({ atendidoEm: '2026-09-06', fechou: false }),
      atendimento({ atendidoEm: '2026-09-04', fechou: true, valorCents: 500_000 }),
    ])

    expect(semanas).toHaveLength(1)
    expect(semanas[0]).toMatchObject({
      inicio: '2026-08-31',
      fim: '2026-09-06',
      atendimentos: 4,
      fecharam: 2,
      pct: 50,
      receitaCents: 2_000_000,
    })
  })

  it('ordena da semana mais recente para a mais antiga', () => {
    const semanas = resumoPorSemana([
      atendimento({ atendidoEm: '2026-08-25' }),
      atendimento({ atendidoEm: '2026-09-01' }),
    ])
    expect(semanas.map((s) => s.inicio)).toEqual(['2026-08-31', '2026-08-24'])
  })

  it('marca como incompleta a semana em que só o que fechou ficou gravado', () => {
    // `fonte: 'venda'` é a linha que só existe porque virou venda: quem não fechou naquela
    // semana nunca foi registrado, então 100% ali não quer dizer nada.
    const [semana] = resumoPorSemana([
      atendimento({ atendidoEm: '2026-09-01', fechou: true, fonte: 'venda' }),
      atendimento({ atendidoEm: '2026-09-02', fechou: false, fonte: 'manual' }),
    ])
    expect(semana.pct).toBe(50)
    expect(semana.incompleta).toBe(true)
  })

  it('não marca como incompleta a semana feita só de registro de verdade', () => {
    const [semana] = resumoPorSemana([
      atendimento({ atendidoEm: '2026-09-01', fechou: true, fonte: 'pos_consulta' }),
      atendimento({ atendidoEm: '2026-09-02', fechou: false, fonte: 'manual' }),
    ])
    expect(semana.incompleta).toBe(false)
  })

  it('semana anterior ao início do registro é incompleta mesmo sem linha de venda', () => {
    const [semana] = resumoPorSemana([atendimento({ atendidoEm: '2026-07-06', fonte: 'manual' })])
    expect(semana.incompleta).toBe(true)
  })
})
