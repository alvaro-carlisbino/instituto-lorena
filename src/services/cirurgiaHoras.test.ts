import { describe, expect, it } from 'vitest'

import { duracao } from './cirurgiaHoras'

/**
 * A conta que a tela existe para responder: "foi uma hora ou foram 40 minutos?".
 * Um bloco de 35 min lido como "1 h" muda a leitura de desempenho de uma pessoa
 * — 352 folículos viram 352/h (abaixo da meta de 550) em vez de 603/h (acima).
 * Por isso o formatador nunca arredonda para cima até a hora cheia.
 */
describe('duracao', () => {
  it('mostra minuto quando o bloco não fechou a hora', () => {
    expect(duracao(35)).toBe('35 min')
    expect(duracao(59)).toBe('59 min')
  })

  it('mostra hora cheia sem minuto pendurado', () => {
    expect(duracao(60)).toBe('1 h')
    expect(duracao(120)).toBe('2 h')
  })

  it('mostra hora e minuto com dois dígitos, para alinhar em coluna tabular', () => {
    expect(duracao(95)).toBe('1 h 35')
    expect(duracao(61)).toBe('1 h 01')
    expect(duracao(275)).toBe('4 h 35')
  })

  it('não inventa duração quando o bloco não tem as duas pontas do relógio', () => {
    expect(duracao(null)).toBe('—')
    expect(duracao(undefined)).toBe('—')
  })

  it('arredonda o segundo quebrado em vez de truncar', () => {
    // 59,6 min é um bloco de uma hora com atraso de segundos, não 59 minutos.
    expect(duracao(59.6)).toBe('1 h')
    expect(duracao(0.4)).toBe('0 min')
  })
})
