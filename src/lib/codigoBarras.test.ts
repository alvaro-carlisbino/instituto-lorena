import { describe, expect, it } from 'vitest'

import { codigoInterno, digitoEan13, ean13Svg, ean13Valido, modulosEan13, proximaSequencia } from './codigoBarras'

describe('EAN-13', () => {
  it('calcula o dígito verificador de códigos reais', () => {
    expect(digitoEan13('789848847084')).toBe(1) // compressa cirúrgica 7898488470841
    expect(digitoEan13('789097311726')).toBe(2) // agulha BD 7890973117262
    expect(ean13Valido('7898488470841')).toBe(true)
    expect(ean13Valido('7898488470842')).toBe(false)
  })

  it('código interno usa o prefixo 20 e fecha com verificador válido', () => {
    const c = codigoInterno(1)
    expect(c).toHaveLength(13)
    expect(c.startsWith('200000000001')).toBe(true)
    expect(ean13Valido(c)).toBe(true)
  })

  it('próxima sequência ignora EAN de fábrica e código inválido', () => {
    expect(proximaSequencia(['7898488470841', codigoInterno(7), codigoInterno(3), '2000000000099', null])).toBe(8)
    expect(proximaSequencia([])).toBe(1)
  })

  it('gera as 95 barras com guardas nas pontas e no meio', () => {
    const bits = modulosEan13('7898488470841')
    expect(bits).toHaveLength(95)
    expect(bits.startsWith('101')).toBe(true)
    expect(bits.endsWith('101')).toBe(true)
    expect(bits.slice(45, 50)).toBe('01010')
  })

  it('SVG só com barras pretas sobre fundo branco', () => {
    const svg = ean13Svg(codigoInterno(42))
    expect(svg).toContain('<svg')
    expect(svg).toContain('fill="#000"')
  })
})
