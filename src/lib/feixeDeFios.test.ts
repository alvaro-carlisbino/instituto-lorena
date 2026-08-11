import { describe, expect, it } from 'vitest'

import { FIOS_NO_FEIXE, montarFeixe } from './feixeDeFios'
import { FAIXAS } from './tricoscopia'

const hist = (o: Partial<Record<string, number>>) => ({
  ate20: 0, '20a40': 0, '40a60': 0, '60a80': 0, '80a100': 0, acima100: 0, ...o,
})

const medida = (h: Record<string, number>) => ({
  espessuraHist: h,
  espessuraMediaUm: 60,
  comprimentoMedioMm: 0.5,
})

describe('montarFeixe', () => {
  it('desenha sempre a mesma quantidade de fios — é o ponto da montagem', () => {
    // Os dois exames têm contagens totalmente diferentes (33 fios contra 300); o
    // feixe iguala, porque a contagem é a medida barulhenta e o que interessa é o
    // calibre.
    const magro = montarFeixe(medida(hist({ '20a40': 30, '40a60': 3 })))!
    const cheio = montarFeixe(medida(hist({ '60a80': 200, '80a100': 100 })))!
    expect(magro.fios).toHaveLength(FIOS_NO_FEIXE)
    expect(cheio.fios).toHaveLength(FIOS_NO_FEIXE)
  })

  it('reparte na proporção medida, e a soma fecha em cem', () => {
    // 25/25/25/25 nas quatro faixas de cima
    const f = montarFeixe(medida(hist({ '40a60': 1, '60a80': 1, '80a100': 1, acima100: 1 })))!
    const soma = Object.values(f.porFaixa).reduce((a, b) => a + b, 0)
    expect(soma).toBe(FIOS_NO_FEIXE)
    expect(f.porFaixa.f40a60).toBe(25)
    expect(f.porFaixa.acima100).toBe(25)
  })

  it('fecha em cem mesmo com proporção que não divide redondo', () => {
    // três faixas iguais dariam 33,33 cada; maiores restos tem que fechar em 100
    const f = montarFeixe(medida(hist({ '40a60': 1, '60a80': 1, '80a100': 1 })))!
    const soma = Object.values(f.porFaixa).reduce((a, b) => a + b, 0)
    expect(soma).toBe(FIOS_NO_FEIXE)
    expect(f.fios).toHaveLength(FIOS_NO_FEIXE)
  })

  it('junta as duas faixas mais finas no corte de 40 µm', () => {
    const f = montarFeixe(medida(hist({ ate20: 10, '20a40': 10, '60a80': 80 })))!
    expect(f.porFaixa.ate40).toBe(20)
    expect(f.pctFinos).toBeCloseTo(20, 5)
  })

  it('sai ordenado do mais fino para o mais grosso', () => {
    const f = montarFeixe(medida(hist({ '20a40': 20, '40a60': 20, '80a100': 60 })))!
    const espessuras = f.fios.map((x) => x.espessuraUm)
    expect(espessuras).toEqual([...espessuras].sort((a, b) => a - b))
  })

  it('nenhum fio escapa da faixa em que foi contado', () => {
    const f = montarFeixe(medida(hist({ '20a40': 50, acima100: 50 })))!
    for (const fio of f.fios) {
      if (fio.faixa === 'ate40') expect(fio.espessuraUm).toBeLessThanOrEqual(40)
      if (fio.faixa === 'acima100') expect(fio.espessuraUm).toBeGreaterThanOrEqual(100)
    }
  })

  it('é determinístico: mesmo exame, mesmo feixe', () => {
    const a = montarFeixe(medida(hist({ '40a60': 7, '60a80': 13 })))!
    const b = montarFeixe(medida(hist({ '40a60': 7, '60a80': 13 })))!
    expect(a.fios).toEqual(b.fios)
  })

  it('sem histograma não inventa feixe', () => {
    expect(montarFeixe({ espessuraHist: null, espessuraMediaUm: 60, comprimentoMedioMm: 0.5 })).toBeNull()
    expect(montarFeixe(medida(hist({})))).toBeNull()
  })

  it('cobre exatamente as faixas declaradas, sem sobra', () => {
    const f = montarFeixe(medida(hist({ '60a80': 1 })))!
    expect(Object.keys(f.porFaixa).sort()).toEqual(FAIXAS.map((x) => x.id).sort())
  })
})
