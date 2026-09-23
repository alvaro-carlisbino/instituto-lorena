import { describe, expect, it } from 'vitest'

import { ehCodigoDePacote, folhaDeEtiquetas, metodoCurto } from './etiquetaCme'

const pacote = {
  codigo: '2900000000018',
  materialNome: 'Caixa Transplante <1>',
  lote: 'AC2-0457',
  autoclave: 'Autoclave 2',
  metodo: 'Vapor saturado sob pressão',
  esterilizadoEm: '2026-09-23T17:10:00Z',
  validade: '2026-10-23',
  responsavel: 'Édina',
}

describe('etiqueta da CME', () => {
  it('reconhece o código do pacote (29 + EAN válido) e não o do estoque', () => {
    expect(ehCodigoDePacote('2900000000018')).toBe(true)
    expect(ehCodigoDePacote('2900000000019')).toBe(false)
    expect(ehCodigoDePacote('2000000000015')).toBe(false)
  })

  it('traz os seis campos da RDC 15, a autoclave e escapa o nome', () => {
    const html = folhaDeEtiquetas([pacote])
    expect(html).toContain('Caixa Transplante &lt;1&gt;')
    expect(html).toContain('AC2-0457 · Autoclave 2')
    expect(html).toContain('23/09/2026 14:10')
    expect(html).toContain('23/10/2026')
    expect(html).toContain('Vapor')
    expect(html).toContain('Édina')
    expect(html).toContain('2900000000018')
  })

  it('uma página por etiqueta, no tamanho do rolo', () => {
    const html = folhaDeEtiquetas([pacote, pacote], { larguraMm: 60, alturaMm: 40 })
    expect(html).toContain('size: 60mm 40mm')
    expect(html.match(/class="et"/g)).toHaveLength(2)
  })

  it('método curto', () => {
    expect(metodoCurto('Vapor saturado sob pressão')).toBe('Vapor')
    expect(metodoCurto('Plasma de peróxido de hidrogênio')).toBe('Peróxido H2O2')
  })
})
