import { describe, expect, it } from 'vitest'

import type { StockItem } from '@/services/estoqueCompras'
import { suggestItemPlan } from '@/services/nfeImport'
import type { NfeItem, NfeParsed } from '@/services/nfeXml'

const item = (over: Partial<StockItem> & { id: string; name: string }): StockItem => ({
  sku: null,
  barcode: null,
  category: null,
  unit: 'UN',
  minQty: 0,
  source: 'nfe',
  controlled: false,
  note: null,
  active: true,
  aliases: [],
  blingProductId: null,
  replacedBy: null,
  qty: 0,
  lastMovementAt: null,
  ...over,
})

const nota = (linhas: Array<Partial<NfeItem> & { description: string }>): NfeParsed => ({
  key: null,
  number: '1',
  series: null,
  issueDate: '2026-09-14',
  supplierCnpj: null,
  supplierName: 'BE CARE',
  totalCents: 0,
  installments: [],
  items: linhas.map((l) => ({
    qty: 1,
    unit: 'PR',
    unitCostCents: 130,
    totalCents: 130,
    lotCode: null,
    expiresOn: null,
    ean: null,
    supplierCode: null,
    ...l,
  })),
})

describe('suggestItemPlan com item consolidado pela contagem', () => {
  const contado = item({ id: 'luva-70', name: 'LUVA 7,0 (ESTERIL)', source: 'kit-cirurgico' })
  const antigo = item({
    id: 'luva-becare',
    name: 'LUVA CIRURGICA ESTERIL 7,0 (BE CARE)',
    barcode: '7898000000017',
    active: false,
    replacedBy: 'luva-70',
  })

  it('nota com o nome antigo dá entrada no item que a enfermagem conta, não no inativo', () => {
    const [plano] = suggestItemPlan(nota([{ description: 'LUVA CIRURGICA ESTERIL 7,0 (BE CARE)' }]), [contado, antigo])
    expect(plano).toMatchObject({ action: 'existente', matchedItemId: 'luva-70', matchedBy: 'nome' })
  })

  it('o EAN do item antigo também leva ao item que ficou', () => {
    const [plano] = suggestItemPlan(nota([{ description: 'LUVA CIR 7.0 BECARE', ean: '7898000000017' }]), [contado, antigo])
    expect(plano).toMatchObject({ matchedItemId: 'luva-70', matchedBy: 'ean' })
  })

  it('consolidação em cadeia chega no último item; ciclo não trava', () => {
    const meio = item({ id: 'meio', name: 'LUVA 7', replacedBy: 'luva-70' })
    const velho = item({ id: 'velho', name: 'LUVA CIR 7', replacedBy: 'meio' })
    expect(suggestItemPlan(nota([{ description: 'LUVA CIR 7' }]), [contado, meio, velho])[0].matchedItemId).toBe('luva-70')

    const a = item({ id: 'a', name: 'A', replacedBy: 'b' })
    const b = item({ id: 'b', name: 'B', replacedBy: 'a' })
    expect(['a', 'b']).toContain(suggestItemPlan(nota([{ description: 'A' }]), [a, b])[0].matchedItemId)
  })

  it('item sem ponteiro segue casando nele mesmo', () => {
    const [plano] = suggestItemPlan(nota([{ description: 'LUVA 7,0 (ESTERIL)' }]), [contado, antigo])
    expect(plano.matchedItemId).toBe('luva-70')
  })

  it('item desativado sem substituto (não é estoque) vira "ignorar", não entrada escondida', () => {
    const tv = item({ id: 'tv', name: 'TV SAMSUNG 55 QLED 4K QN55Q7FAA', active: false })
    const [plano] = suggestItemPlan(nota([{ description: 'TV SAMSUNG 55 QLED 4K QN55Q7FAA' }]), [tv])
    expect(plano).toMatchObject({ action: 'ignorar', matchedItemId: null })
  })
})

describe('suggestItemPlan com embalagem', () => {
  const luva = item({ id: 'luva-70', name: 'LUVA 7,0 (ESTERIL)', aliases: ['LUVA CIRURGICA 7,0 ESTERIL C/200 PARES-BECARE'] })

  it('caixa entrando no item contado em pares sugere o fator do nome', () => {
    const [plano] = suggestItemPlan(nota([{ description: 'LUVA CIRURGICA 7,0 ESTERIL C/200 PARES-BECARE', unit: 'cx' }]), [luva])
    expect(plano).toMatchObject({ matchedItemId: 'luva-70', packFactor: 200, packSource: 'nome' })
  })

  it('fator aprendido pelo item consolidado vale pra nota que casa pelo ponteiro', () => {
    const contado = item({ id: 'clonidin', name: 'CLONIDIN EV', packFactors: { 'nome:clonidina (clonidin) 150mcg/ml c/30 amp 1ml - im/iv - sterile pack': 30 } })
    const antigo = item({ id: 'x', name: 'CLONIDINA (CLONIDIN) 150MCG/ML C/30 AMP 1ML - IM/IV - STERILE PACK', active: false, replacedBy: 'clonidin' })
    const [plano] = suggestItemPlan(
      nota([{ description: 'CLONIDINA (CLONIDIN) 150MCG/ML C/30 AMP 1ML - IM/IV - STERILE PACK', unit: 'UN' }]),
      [contado, antigo],
    )
    expect(plano).toMatchObject({ matchedItemId: 'clonidin', packFactor: 30, packSource: 'aprendido' })
  })

  it('sem sinal de embalagem o fator é 1', () => {
    const [plano] = suggestItemPlan(nota([{ description: 'LUVA 7,0 (ESTERIL)', unit: 'PR' }]), [luva])
    expect(plano).toMatchObject({ packFactor: 1, packSource: null })
  })
})
