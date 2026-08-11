import { describe, expect, it } from 'vitest'

import { rotuloProgresso, rotuloSessoes, sessoesDefinidas } from './treatmentProtocols'

/**
 * O catálogo de protocolos nasceu das 205 vendas de 2026, e a planilha nunca registrou
 * quantas sessões cada protocolo tem. Por isso 0 significa "a definir".
 *
 * O bug que estes testes travam: a tela mostrava "Sessões 2/0" para todo protocolo cujo
 * número de sessões ainda não foi definido, e o toast dizia "Sessão 3/0 registrada".
 */
describe('rótulo de sessões', () => {
  it('trata 0 como "a definir", não como "nenhuma"', () => {
    expect(sessoesDefinidas(0)).toBe(false)
    expect(rotuloSessoes(0)).toBe('sessões a definir')
  })

  it('usa singular em 1 e plural no resto', () => {
    expect(rotuloSessoes(1)).toBe('1 sessão')
    expect(rotuloSessoes(3)).toBe('3 sessões')
    expect(rotuloSessoes(5)).toBe('5 sessões')
  })

  it('nunca escreve "/0" no progresso', () => {
    expect(rotuloProgresso(2, 0)).toBe('2 sessões feitas')
    expect(rotuloProgresso(0, 0)).toBe('0 sessões feitas')
    expect(rotuloProgresso(2, 3)).toBe('Sessões 2/3')
  })

  it('mostra o total quando ele existe, mesmo estourado', () => {
    // paciente que fez sessão a mais é dado real, não erro de render
    expect(rotuloProgresso(4, 3)).toBe('Sessões 4/3')
  })
})
