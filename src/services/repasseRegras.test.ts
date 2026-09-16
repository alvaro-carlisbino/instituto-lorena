import { describe, expect, it } from 'vitest'

import { type RegraRepasse, acharRegra, calcularRepasse, descreverRegra } from './repasseRegras'

const regra = (over: Partial<RegraRepasse> = {}): RegraRepasse => ({
  id: 'r1',
  papel: 'medico',
  pessoa: 'Matheus Amaral',
  kind: 'cirurgia',
  modo: 'percentual',
  percentual: 30,
  fixoCents: null,
  ...over,
})

describe('acharRegra', () => {
  it('casa a pessoa sem diferença de caixa nem espaço, como o índice do banco', () => {
    expect(acharRegra([regra()], 'medico', 'cirurgia', '  matheus AMARAL ')?.id).toBe('r1')
  })

  it('regra de cirurgia não vale para protocolo, nem regra de médico para anestesia', () => {
    expect(acharRegra([regra()], 'medico', 'protocolo', 'Matheus Amaral')).toBeNull()
    expect(acharRegra([regra()], 'anestesia', 'cirurgia', 'Matheus Amaral')).toBeNull()
  })

  it('venda sem médico escolhido não pega regra nenhuma', () => {
    expect(acharRegra([regra({ pessoa: '' })], 'medico', 'cirurgia', null)).toBeNull()
  })
})

describe('calcularRepasse', () => {
  it('percentual sai do valor da venda', () => {
    expect(calcularRepasse(regra(), 2_950_000)).toBe(885_000)
  })

  it('fixo não depende do valor', () => {
    const anestesia = regra({ papel: 'anestesia', pessoa: 'Grupo Ingá', modo: 'fixo', percentual: null, fixoCents: 250_000 })
    expect(calcularRepasse(anestesia, 2_950_000)).toBe(250_000)
    expect(calcularRepasse(anestesia, 0)).toBe(250_000)
  })

  it('sem regra é zero, e meio centavo arredonda para cima como no Postgres', () => {
    expect(calcularRepasse(null, 2_950_000)).toBe(0)
    expect(calcularRepasse(regra({ percentual: 12.5 }), 1_001)).toBe(125)
  })
})

describe('descreverRegra', () => {
  it('fala em português o que a regra faz', () => {
    expect(descreverRegra(regra({ percentual: 27.5 }))).toBe('27,5% do valor')
    expect(descreverRegra(regra({ modo: 'fixo', fixoCents: 250_000 }))).toMatch(/2\.500,00 por venda$/)
  })
})
