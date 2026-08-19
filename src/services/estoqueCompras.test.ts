import { describe, expect, it } from 'vitest'

import { mexeEmDinheiro, montarPatchParcela } from '@/services/estoqueCompras'

describe('montarPatchParcela', () => {
  it('campo ausente do patch não entra na linha — senão editar só o centro zeraria o valor', () => {
    const row = montarPatchParcela({ costCenter: 'SPA' })
    expect(row).toEqual({ cost_center: 'SPA' })
    expect('amount_cents' in row).toBe(false)
    expect('due_date' in row).toBe(false)
  })

  it('campo presente e vazio vira null: quem apagou a observação quer ela apagada', () => {
    expect(montarPatchParcela({ note: '   ', subcategory: '', counterparty: '' })).toEqual({
      note: null,
      subcategory: null,
      counterparty: null,
    })
  })

  it('centro e categoria vazios viram null, não string vazia', () => {
    expect(montarPatchParcela({ costCenter: '', categoryId: '' })).toEqual({
      cost_center: null,
      category_id: null,
    })
  })

  it('descrição em branco é erro, não descrição vazia no banco', () => {
    expect(() => montarPatchParcela({ description: '  ' })).toThrow(/descrição/i)
  })

  it('valor zero ou negativo é erro', () => {
    expect(() => montarPatchParcela({ amountCents: 0 })).toThrow(/maior que zero/i)
    expect(() => montarPatchParcela({ amountCents: -100 })).toThrow(/maior que zero/i)
    expect(() => montarPatchParcela({ amountCents: Number.NaN })).toThrow(/maior que zero/i)
  })

  it('vencimento vazio é erro', () => {
    expect(() => montarPatchParcela({ dueDate: '' })).toThrow(/vencimento/i)
  })

  it('arredonda centavos e apara os textos', () => {
    expect(montarPatchParcela({ amountCents: 1250.6, description: ' Aluguel ' })).toEqual({
      amount_cents: 1251,
      description: 'Aluguel',
    })
  })
})

describe('mexeEmDinheiro', () => {
  it('valor e vencimento pedem a checagem de status; o resto não', () => {
    expect(mexeEmDinheiro(montarPatchParcela({ amountCents: 100 }))).toBe(true)
    expect(mexeEmDinheiro(montarPatchParcela({ dueDate: '2026-09-01' }))).toBe(true)
    expect(mexeEmDinheiro(montarPatchParcela({ description: 'Aluguel', costCenter: 'SPA' }))).toBe(false)
  })
})
