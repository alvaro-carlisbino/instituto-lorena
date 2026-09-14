import { describe, expect, it } from 'vitest'

import {
  chavesEmbalagem,
  converterPorEmbalagem,
  fatorDoNome,
  sugerirFatorEmbalagem,
  unidadeEhEmbalagem,
} from '@/lib/nfeEmbalagem'

// Nomes reais das notas da clínica (jan a ago/2026).
describe('fatorDoNome', () => {
  it.each([
    ['LUVA CIRURGICA 7,0 ESTERIL C/200 PARES-BECARE', 200],
    ['SERINGA DESC. 03ML S/AG LUER LOCK CX.C/1000 - BD V10/30', 1000],
    ['TORNEIRA DESC. 3V LOCK C/ 50-SEVENCARE', 50],
    ['EPINEFRINA 1MG/1ML (HYFREN) CX C/100 UN - HYPOFARMA', 100],
    ['AC.TRANEXAMICO 50MG/ML 100AMP 5ML GEN-HIPOLABOR', 100],
    ['CLORIDRATO DE ROPIVACAINA 10MG/ML - GEN-SOL INJ IA-25FR 20ML-HYPOFARMA', 25],
    ['CEFUROXIMA 750MG IV/IM 50FAM GEN-BIOCHIMICO', 50],
    ['DIPIFARMA 500MG/ML - DIPIRONA-SOL INJ-100 AMPX2ML-FARMACE', 100],
    ['DOBUTAMINA 250MG/20ML CX 10 AMP HYPOFARMA', 10],
    ['HEPTRIS 40MG/0,4ML - ENOXAPARINA SODICA-SOL INJ IV/SC-10 SER PREENC+SI', 10],
    ['MICROCANULA 21G C/AG 22GX50MM CX/12 - UNIQMED', 12],
    ['ELETRODO DESCARTAVEL ADULTO - PACOTE 50UN-37X42MM-DESCARPACK', 50],
    ['SOLUCAO DE RINGER 500ML 20 FRASCOS-ECOFLAC BRAUN', 20],
    ['FIO SUTURA NYLON INCOLOR CIRURGIA PLASTICA CX C/24UN SHALON', 24],
  ])('%s -> %i', (nome, fator) => {
    expect(fatorDoNome(nome)).toBe(fator)
  })

  it('embalagem dentro de embalagem multiplica', () => {
    expect(fatorDoNome('CAMPO OPERATORIO 25X28 C/RX 12G ESTERIL C/5 C/100-FORTCLEAN')).toBe(500)
  })

  it('conteúdo do frasco e medida não viram fator', () => {
    expect(fatorDoNome('MINOXIDIL 5% FRASCO C/60 CAPS')).toBeNull()
    expect(fatorDoNome('LENCOL DESC. 220X140 C/EL C/10 GR20 - PROTDESC')).toBeNull()
    expect(fatorDoNome('GENTA +DIPR BETA 1/0,5MG/G CR 30GR GERMED')).toBeNull()
    expect(fatorDoNome('SORO GLICOSADO 250ML')).toBeNull()
  })
})

describe('unidadeEhEmbalagem', () => {
  it('caixa, pacote e as grafias sujas das notas', () => {
    for (const u of ['CX', 'cx', 'CX100', 'PCT', 'pct', 'PT', 'Pacote', 'FD', 'KIT']) expect(unidadeEhEmbalagem(u)).toBe(true)
    for (const u of ['UN', 'Unid.', 'PR', 'AMP', 'FR', 'BL', 'RL']) expect(unidadeEhEmbalagem(u)).toBe(false)
  })

  it('"pc" só é pacote quando o nome diz PCT', () => {
    expect(unidadeEhEmbalagem('pc', 'ABAIXADOR DE LINGUA PCT C/100')).toBe(true)
    expect(unidadeEhEmbalagem('PC', 'DISJUNTOR MINI SOPRANO 1 X 20 AMP')).toBe(false)
  })
})

describe('sugerirFatorEmbalagem', () => {
  const luvaContada = { unit: 'UN', packFactors: {} }

  it('caixa da nota entrando em item contado em unidade: fator do nome', () => {
    const linha = { description: 'LUVA CIRURGICA 7,0 ESTERIL C/200 PARES-BECARE', unit: 'cx', ean: null }
    expect(sugerirFatorEmbalagem(linha, luvaContada)).toEqual({ fator: 200, origem: 'nome' })
  })

  it('nota em unidade não converte, mesmo com C/100 no nome (a seringa já vem contada)', () => {
    const linha = { description: 'SERINGA 03ML S/AGULHA LUER LOK BD C/1000', unit: 'UN', ean: null }
    expect(sugerirFatorEmbalagem(linha, luvaContada)).toBeNull()
  })

  it('item contado em caixa recebe caixa sem conversão', () => {
    const linha = { description: 'INTEGRADOR QUIMICO CX C/250', unit: 'CX', ean: null }
    expect(sugerirFatorEmbalagem(linha, { unit: 'CX' })).toBeNull()
  })

  it('fator aprendido vale acima do nome e de qualquer unidade (EAN ou nome sem lote)', () => {
    const [porEan, porNome] = chavesEmbalagem('CLONIDINA (CLONIDIN) 150MCG/ML C/30 AMP 1ML L: 123 V: 01/01/2030', '7896676400019')
    expect(porEan).toBe('ean:7896676400019')
    const linha = { description: 'CLONIDINA (CLONIDIN) 150MCG/ML C/30 AMP 1ML L: 999', unit: 'UN', ean: null }
    expect(sugerirFatorEmbalagem(linha, { unit: 'UN', packFactors: { [porNome]: 30 } })).toEqual({ fator: 30, origem: 'aprendido' })
    expect(sugerirFatorEmbalagem({ ...linha, ean: '7896676400019' }, { unit: 'UN', packFactors: { [porEan]: 30 } })?.fator).toBe(30)
  })
})

describe('converterPorEmbalagem', () => {
  it('multiplica a quantidade e divide o custo', () => {
    expect(converterPorEmbalagem(2, 23940, 200)).toEqual({ qty: 400, unitCostCents: 120 })
  })

  it('fator inválido vira 1', () => {
    expect(converterPorEmbalagem(3, 500, 0)).toEqual({ qty: 3, unitCostCents: 500 })
  })
})
