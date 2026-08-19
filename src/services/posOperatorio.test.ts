import { describe, expect, it } from 'vitest'

import {
  aniversarioDaCirurgia,
  filtrarPosOp,
  resumoPosOp,
  type MarcoRetorno,
  type PacientePosOp,
} from './posOperatorio'

const marco = (over: Partial<MarcoRetorno> = {}): MarcoRetorno => ({
  ordem: 1,
  marco: 'Retorno 1 mês',
  previsto: '2026-09-18',
  situacao: 'veio',
  veio_em: '2026-09-20',
  agendado_para: null,
  ...over,
})

const paciente = (over: Partial<PacientePosOp> = {}): PacientePosOp => ({
  surgery_id: 1,
  sale_id: null,
  dia: '2026-08-19',
  dias_desde: 30,
  prontuario: '5480',
  lead_id: null,
  paciente: 'Paciente Teste',
  telefone: '44999998888',
  procedimento: 'Tc Frontal/ Coroa',
  marcos: [marco()],
  marco_devendo: null,
  vencido_ha: null,
  retornos_feitos: 1,
  retornos_perdidos: 0,
  comprou_produto: false,
  produto_cents: 0,
  ultima_compra: null,
  ...over,
})

describe('aniversarioDaCirurgia', () => {
  it('anda um ano sem passar por Date, que moveria o dia pelo fuso', () => {
    expect(aniversarioDaCirurgia('2026-08-19')).toBe('2027-08-19')
  })

  it('preserva o primeiro dia do ano', () => {
    expect(aniversarioDaCirurgia('2025-11-17')).toBe('2026-11-17')
  })
})

describe('filtrarPosOp', () => {
  const lista = [
    paciente({ surgery_id: 1, dia: '2026-08-19', marco_devendo: 'Retorno 1 mês', vencido_ha: 12 }),
    paciente({ surgery_id: 2, dia: '2025-11-17', comprou_produto: true, produto_cents: 30_000 }),
    paciente({ surgery_id: 3, dia: '2026-05-02', prontuario: null }),
  ]

  it('a fila de cobrança é só quem tem marco vencido', () => {
    expect(filtrarPosOp(lista, 'devendo', '2026-08', '').map((p) => p.surgery_id)).toEqual([1])
  })

  it('aniversário compara o MÊS, não o dia — a lista precisa ter gente para trabalhar', () => {
    expect(filtrarPosOp(lista, 'aniversario', '2026-11', '').map((p) => p.surgery_id)).toEqual([2])
    expect(filtrarPosOp(lista, 'aniversario', '2027-08', '').map((p) => p.surgery_id)).toEqual([1])
  })

  it('quem nunca comprou produto é a lista de oferta', () => {
    expect(filtrarPosOp(lista, 'sem-produto', '2026-08', '').map((p) => p.surgery_id)).toEqual([1, 3])
  })

  it('sem prontuário é balde próprio, não some no meio', () => {
    expect(filtrarPosOp(lista, 'sem-prontuario', '2026-08', '').map((p) => p.surgery_id)).toEqual([3])
  })

  it('a busca atravessa o recorte escolhido', () => {
    const so2 = [paciente({ surgery_id: 9, paciente: 'Fulano de Tal', marco_devendo: 'Retorno 15 dias' })]
    expect(filtrarPosOp(so2, 'devendo', '2026-08', 'fulano')).toHaveLength(1)
    expect(filtrarPosOp(so2, 'devendo', '2026-08', 'sicrano')).toHaveLength(0)
  })
})

describe('resumoPosOp', () => {
  it('comparecimento ignora quem não tem prontuário: falta de cadastro não é falta', () => {
    const r = resumoPosOp([
      paciente({ prontuario: '1', retornos_feitos: 3, retornos_perdidos: 1 }),
      // Sem prontuário a RPC devolve tudo como sem_vinculo, com os contadores zerados.
      // Se ele entrasse no denominador, a taxa cairia por buraco de cadastro.
      paciente({ prontuario: null, retornos_feitos: 0, retornos_perdidos: 0 }),
    ])
    expect(r.comparecimentoPct).toBe(75)
    expect(r.semProntuario).toBe(1)
    expect(r.pacientes).toBe(2)
  })

  it('sem base conferível a taxa é nula, não zero — zero seria mentira', () => {
    expect(resumoPosOp([paciente({ prontuario: null, retornos_feitos: 0, retornos_perdidos: 0 })]).comparecimentoPct)
      .toBeNull()
  })
})
