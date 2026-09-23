import { describe, expect, it } from 'vitest'

import { anestesiaParaGravar, anestesiaParaMostrar, totalParaMostrar, valorParaGravar } from './valorDaCirurgia'

describe('valor da cirurgia: total na tela, sem entrada no banco', () => {
  it('o caso do Gustavo Frederico: 45.200 com 2.500 de entrada grava 42.700', () => {
    expect(valorParaGravar(4_520_000, 250_000)).toBe(4_270_000)
    expect(totalParaMostrar(4_270_000, 250_000)).toBe(4_520_000)
  })

  it('sem entrada, total e valor gravado são o mesmo', () => {
    expect(valorParaGravar(4_000_000, 0)).toBe(4_000_000)
    expect(totalParaMostrar(4_000_000, null)).toBe(4_000_000)
  })

  it('entrada maior que o total não grava valor negativo', () => {
    expect(valorParaGravar(100_000, 250_000)).toBe(0)
  })

  it('anestesia: gravada sem a entrada, mostrada cheia, ida e volta', () => {
    expect(anestesiaParaMostrar(0, 250_000)).toBe(250_000)
    expect(anestesiaParaMostrar(50_000, 250_000)).toBe(300_000)
    expect(anestesiaParaGravar(300_000, 250_000)).toBe(50_000)
    expect(anestesiaParaGravar(200_000, 250_000)).toBe(0)
  })

  it('o lucro da tela é o lucro gravado: total menos anestesia cheia = valor menos anestesia gravada', () => {
    const total = 4_520_000
    const entrada = 250_000
    const anestesiaCheia = 250_000
    const gravada = anestesiaParaGravar(anestesiaCheia, entrada)
    expect(total - anestesiaCheia).toBe(valorParaGravar(total, entrada) - gravada)
  })
})
