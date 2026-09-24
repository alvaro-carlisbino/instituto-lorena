import { describe, expect, it } from 'vitest'

import {
  anestesiaParaGravar,
  anestesiaParaMostrar,
  entradaDaAnestesia,
  entradaDaAnestesiaGravada,
  totalParaMostrar,
  valorParaGravar,
} from './valorDaCirurgia'

describe('valor da cirurgia: total na tela, sem a anestesia paga pela entrada no banco', () => {
  it('o caso do Gustavo Frederico: 45.200 com 2.500 de entrada e 2.500 de anestesia grava 42.700', () => {
    const parte = entradaDaAnestesia(250_000, 250_000)
    expect(valorParaGravar(4_520_000, parte)).toBe(4_270_000)
    expect(totalParaMostrar({ valueCents: 4_270_000, depositCents: 250_000, totalCents: 4_520_000 })).toBe(4_520_000)
  })

  // O print de 24/09: a entrada passou da anestesia e a sobra sumia do valor e do lucro.
  it('o caso do Thiago Henrique: entrada de 10.000 com anestesia de 2.500 só desconta 2.500', () => {
    const total = 3_060_000
    const entrada = 1_000_000
    const anestesia = 250_000
    const parte = entradaDaAnestesia(entrada, anestesia)
    expect(parte).toBe(250_000)
    const valor = valorParaGravar(total, parte)
    expect(valor).toBe(2_810_000)
    const repasse = 370_000
    const lucro = valor - repasse - anestesiaParaGravar(anestesia, entrada)
    expect(lucro).toBe(2_440_000)
    // E o lucro é o de quem faz a conta de cabeça: total menos os custos.
    expect(lucro).toBe(total - repasse - anestesia)
  })

  it('entrada menor que a anestesia: a entrada inteira paga o anestesista e a clínica paga o resto', () => {
    const parte = entradaDaAnestesia(100_000, 250_000)
    expect(parte).toBe(100_000)
    expect(anestesiaParaGravar(250_000, 100_000)).toBe(150_000)
  })

  it('sem anestesia conhecida, a entrada inteira sai, como na regra antiga', () => {
    expect(entradaDaAnestesia(1_000_000, null)).toBe(1_000_000)
  })

  it('sem entrada, total e valor gravado são o mesmo', () => {
    expect(valorParaGravar(4_000_000, entradaDaAnestesia(0, 250_000))).toBe(4_000_000)
    expect(totalParaMostrar({ valueCents: 4_000_000, depositCents: null, totalCents: null })).toBe(4_000_000)
  })

  it('venda anterior a 24/09 (sem total gravado) mostra valor + entrada', () => {
    const antiga = { valueCents: 2_510_000, depositCents: 250_000, totalCents: null }
    expect(totalParaMostrar(antiga)).toBe(2_760_000)
    expect(entradaDaAnestesiaGravada(antiga)).toBe(250_000)
  })

  it('venda com total gravado: a parte da anestesia é o que falta do valor para o total', () => {
    expect(entradaDaAnestesiaGravada({ valueCents: 2_810_000, depositCents: 1_000_000, totalCents: 3_060_000 })).toBe(
      250_000,
    )
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
    for (const [entrada, anestesiaCheia] of [
      [250_000, 250_000],
      [1_000_000, 250_000],
      [100_000, 175_000],
      [0, 175_000],
    ]) {
      const gravada = anestesiaParaGravar(anestesiaCheia, entrada)
      const valor = valorParaGravar(total, entradaDaAnestesia(entrada, anestesiaCheia))
      expect(valor - gravada).toBe(total - anestesiaCheia)
    }
  })
})
