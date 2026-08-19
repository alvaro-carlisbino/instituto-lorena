import { describe, expect, it } from 'vitest'

import { proximoEstado, situacaoDoDia, slotsAposClique } from './vagasCirurgia'

describe('situacaoDoDia', () => {
  it('dia sem nada é livre (cinza), não vaga vazia', () => {
    expect(situacaoDoDia(undefined, 0)).toEqual({ situacao: 'livre', marcadas: 0, vagas: 0 })
  })

  it('dia com cirurgia no CRM nasce verde sem ninguém clicar', () => {
    expect(situacaoDoDia(undefined, 2)).toEqual({ situacao: 'ocupada', marcadas: 2, vagas: 0 })
  })

  it('data aberta sem paciente é vermelha', () => {
    expect(situacaoDoDia({ slots: 1, preenchida: false }, 0)).toEqual({ situacao: 'aberta', marcadas: 0, vagas: 1 })
  })

  it('a venda marcada no dia ocupa a vaga e o dia fica verde sozinho', () => {
    expect(situacaoDoDia({ slots: 1, preenchida: false }, 1)).toEqual({ situacao: 'ocupada', marcadas: 1, vagas: 0 })
  })

  it('duas vagas e uma cirurgia: ainda vermelho, com uma vaga', () => {
    expect(situacaoDoDia({ slots: 2, preenchida: false }, 1)).toEqual({ situacao: 'aberta', marcadas: 1, vagas: 1 })
  })

  it('preenchida à mão zera as vagas mesmo sem venda', () => {
    expect(situacaoDoDia({ slots: 3, preenchida: true }, 0)).toEqual({ situacao: 'preenchida', marcadas: 0, vagas: 0 })
  })

  it('mais cirurgia que vaga não vira número negativo', () => {
    expect(situacaoDoDia({ slots: 1, preenchida: false }, 3).vagas).toBe(0)
  })
})

describe('proximoEstado: o ciclo do clique', () => {
  it('dia vazio anda livre → aberta → preenchida → livre', () => {
    expect(proximoEstado({ situacao: 'livre', marcadas: 0 })).toBe('aberta')
    expect(proximoEstado({ situacao: 'aberta', marcadas: 0 })).toBe('preenchida')
    expect(proximoEstado({ situacao: 'preenchida', marcadas: 0 })).toBe('livre')
  })

  it('dia com cirurgia só alterna "cabe mais uma" e volta', () => {
    expect(proximoEstado({ situacao: 'ocupada', marcadas: 1 })).toBe('aberta')
    expect(proximoEstado({ situacao: 'aberta', marcadas: 1 })).toBe('livre')
  })
})

describe('slotsAposClique', () => {
  it('abrir vaga num dia vazio é uma vaga', () => {
    expect(slotsAposClique('aberta', 0, 0)).toBe(1)
  })

  it('abrir vaga num dia com duas cirurgias é "cabe mais uma": três', () => {
    expect(slotsAposClique('aberta', 0, 2)).toBe(3)
  })

  it('não diminui o que a Agenda Cirúrgica já tinha', () => {
    expect(slotsAposClique('aberta', 4, 1)).toBe(4)
    expect(slotsAposClique('preenchida', 4, 0)).toBe(4)
  })

  it('respeita o teto de 12 do banco e o piso de 1', () => {
    expect(slotsAposClique('aberta', 0, 30)).toBe(12)
    expect(slotsAposClique('preenchida', 0, 0)).toBe(1)
  })
})
