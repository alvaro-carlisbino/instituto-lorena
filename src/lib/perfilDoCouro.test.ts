import { describe, expect, it } from 'vitest'

import { montarPerfil } from './perfilDoCouro'

const m = (regiao: string, esp: number | null, finos = 10) => ({
  regiao,
  espessuraMediaUm: esp,
  pctFiosFinos: finos,
})

describe('montarPerfil', () => {
  it('elege a área doadora como referência', () => {
    const p = montarPerfil([m('Frontal 1', 62), m('Vertex center', 65), m('Occiput 3 left', 74)])
    expect(p.referenciaUm).toBe(74)
    expect(p.regiaoReferencia).toBe('Occiput 3 left')
    expect(p.regioes.find((r) => r.regiao === 'Occiput 3 left')?.ehDoadora).toBe(true)
    expect(p.regioes.find((r) => r.regiao === 'Frontal 1')?.ehDoadora).toBe(false)
  })

  it('com duas doadoras, a referência é a média — uma captura só carrega o erro sozinha', () => {
    const p = montarPerfil([m('Occiput 3 left', 70), m('Occiput 3 right', 76), m('Mid', 60)])
    expect(p.referenciaUm).toBe(73)
    expect(p.regiaoReferencia).toBe('média das occipitais')
  })

  it('sem doadora no exame, não inventa referência', () => {
    const p = montarPerfil([m('Frontal 1', 62), m('Mid', 65)])
    expect(p.referenciaUm).toBeNull()
    expect(p.regiaoReferencia).toBeNull()
  })

  it('ignora medida sem região, que não tem o que comparar', () => {
    const p = montarPerfil([m('Frontal 1', 62), { regiao: null, espessuraMediaUm: 70, pctFiosFinos: 5 }])
    expect(p.regioes).toHaveLength(1)
  })

  it('pega a doadora digitada à mão, não só a do worklist', () => {
    const p = montarPerfil([m('Frontal 1', 62), m('area doadora', 75)])
    expect(p.referenciaUm).toBe(75)
  })
})

describe('referência histórica — desconfiar da própria régua', () => {
  it('usa a mediana, para uma captura ruim não puxar o valor', () => {
    // 71 é o outlier; a mediana de [71, 78, 79, 80] é 78,5
    const p = montarPerfil([m('Occiput 3 left', 70)], [71, 78, 79, 80])
    expect(p.referenciaHistoricaUm).toBe(78.5)
  })

  it('com um exame anterior só, não arrisca uma referência histórica', () => {
    // comparar contra um único valor, que carrega os mesmos 5,1% de erro, daria
    // alarme falso na metade das vezes
    const p = montarPerfil([m('Occiput 3 left', 70)], [78])
    expect(p.referenciaHistoricaUm).toBeNull()
  })

  it('sem histórico nenhum, devolve nulo em vez de zero', () => {
    const p = montarPerfil([m('Occiput 3 left', 70)])
    expect(p.referenciaHistoricaUm).toBeNull()
  })

  it('descarta valor zerado ou negativo do histórico', () => {
    const p = montarPerfil([m('Occiput 3 left', 70)], [0, 78, 80])
    expect(p.referenciaHistoricaUm).toBe(79)
  })

  it('a doadora deste exame sendo bem menor que a histórica é sinal de captura ruim', () => {
    // é o caso do Wichoski: 70,9 µm num exame contra ~78 nos outros. A régua
    // inteira desloca, e a tela tem que avisar em vez de mostrar região tratada
    // "mais grossa que a doadora".
    const p = montarPerfil([m('Occiput 2 left', 70.9), m('Frontal 1', 73.4)], [78.5, 79.2, 78.9])
    const desvio = ((p.referenciaUm! - p.referenciaHistoricaUm!) * 100) / p.referenciaHistoricaUm!
    expect(Math.abs(desvio)).toBeGreaterThan(5.1)
  })
})
