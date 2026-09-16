import { describe, expect, it } from 'vitest'

import { contaDoProcedimento, somarContas } from './resultadoProcedimento'

const base = {
  receitaCents: 2_800_000,
  cobradoKitsCents: 0,
  materiaisKitsCents: 0,
  materiaisManualCents: 0,
  custoMedicoCents: 0,
  custoAnestesiaCents: 0,
  impostoCents: 0,
  outrosCents: 0,
  kits: 0,
}

describe('contaDoProcedimento', () => {
  it('com kit, o material é o custo real do kit e o digitado na venda é ignorado', () => {
    const c = contaDoProcedimento({ ...base, kits: 1, materiaisKitsCents: 130_447, materiaisManualCents: 50_000 })
    expect(c.materiais).toBe(130_447)
    expect(c.materiaisOrigem).toBe('kits')
    expect(c.lucro).toBe(2_800_000 - 130_447)
  })

  it('sem kit, usa o material digitado na venda', () => {
    const c = contaDoProcedimento({ ...base, materiaisManualCents: 90_000, custoMedicoCents: 600_000, impostoCents: 168_000 })
    expect(c.materiaisOrigem).toBe('manual')
    expect(c.custoTotal).toBe(858_000)
    expect(c.margem).toBeCloseTo((2_800_000 - 858_000) / 2_800_000)
  })

  it('cobrança a mais no kit entra como receita', () => {
    const c = contaDoProcedimento({ ...base, kits: 1, cobradoKitsCents: 25_000, materiaisKitsCents: 10_000 })
    expect(c.receitaTotal).toBe(2_825_000)
  })

  it('kit sem venda não tem margem, só prejuízo do material', () => {
    const c = contaDoProcedimento({ ...base, receitaCents: 0, kits: 1, materiaisKitsCents: 130_447 })
    expect(c.margem).toBeNull()
    expect(c.lucro).toBe(-130_447)
  })
})

describe('somarContas', () => {
  it('soma receita, custo e lucro de várias linhas', () => {
    const t = somarContas([
      { ...base, kits: 1, materiaisKitsCents: 100_000 },
      { ...base, receitaCents: 1_000_000, custoMedicoCents: 300_000, custoAnestesiaCents: 250_000 },
    ])
    expect(t.receita).toBe(3_800_000)
    expect(t.anestesia).toBe(250_000)
    expect(t.custo).toBe(650_000)
    expect(t.lucro).toBe(3_150_000)
  })
})
