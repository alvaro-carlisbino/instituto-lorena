import { describe, expect, it } from 'vitest'

import { gerarBoletos, somarMeses } from './boletosDaNota'

describe('somarMeses', () => {
  it('mantém o dia do mês', () => {
    expect(somarMeses('2026-09-11', 1)).toBe('2026-10-11')
    expect(somarMeses('2026-11-20', 2)).toBe('2027-01-20')
  })

  it('fim de mês não pula para o mês seguinte', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(somarMeses('2026-01-31', 2)).toBe('2026-03-31')
  })
})

describe('gerarBoletos', () => {
  it('divide a nota da Health Tech em 3 boletos mensais que somam o total', () => {
    const boletos = gerarBoletos(844273, 3, '2026-10-11')
    expect(boletos).toEqual([
      { dueDate: '2026-10-11', amountCents: 281425 },
      { dueDate: '2026-11-11', amountCents: 281424 },
      { dueDate: '2026-12-11', amountCents: 281424 },
    ])
    expect(boletos.reduce((s, b) => s + b.amountCents, 0)).toBe(844273)
  })

  it('sem vencimento digitado deixa a data vazia em vez de inventar a emissão', () => {
    expect(gerarBoletos(1000, 2, '')).toEqual([
      { dueDate: '', amountCents: 500 },
      { dueDate: '', amountCents: 500 },
    ])
  })

  it('quantidade inválida vira 1 boleto', () => {
    expect(gerarBoletos(1000, 0, '2026-10-01')).toEqual([{ dueDate: '2026-10-01', amountCents: 1000 }])
  })
})
