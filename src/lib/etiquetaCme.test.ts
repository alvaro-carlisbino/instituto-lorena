import { describe, expect, it } from 'vitest'

import { CONFIG_PADRAO, caberNaLargura, ehCodigoDePacote, etiquetaZpl, folhaDeEtiquetas, metodoCurto, qrSvg, reguaZpl } from './etiquetaCme'
import { graficoZpl, pixelsParaGrafico, textoZpl } from './zebra'

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

  it('traz os seis campos da RDC 15 como na etiqueta antiga, com o equipamento e o QR', () => {
    const html = folhaDeEtiquetas([pacote])
    expect(html).toContain('INSTITUTO LORENA - CME')
    expect(html).toContain('Caixa Transplante &lt;1&gt;')
    expect(html).toContain('ESTERILIZAÇÃO:</span>23/09/2026 14:10')
    expect(html).toContain('VALIDADE:</span>23/10/2026')
    expect(html).toContain('MÉTODO ESTER:</span>VAPOR')
    expect(html).toContain('LOTE:</span>AC2-0457')
    expect(html).toContain('EQUIPAMENTO:</span>Autoclave 2')
    expect(html).toContain('RESPONSÁVEL:</span>ÉDINA')
    expect(html).toContain('class="qr"')
    expect(html).toContain('2900000000018')
  })

  it('código de barras quando o leitor não lê QR', () => {
    const html = folhaDeEtiquetas([pacote], { codigo: 'barras' })
    expect(html).toContain('class="barras"')
    expect(html).not.toContain('class="qr"')
  })

  it('o QR sai quadrado e com módulos', () => {
    const svg = qrSvg('2900000000018')
    const [, lado] = svg.match(/viewBox="0 0 (\d+) \1"/) ?? []
    expect(Number(lado)).toBeGreaterThan(20)
    expect(svg.match(/<rect x=/g)!.length).toBeGreaterThan(100)
  })

  it('uma página por etiqueta, no tamanho do rolo', () => {
    const html = folhaDeEtiquetas([pacote, pacote], { larguraMm: 60, alturaMm: 40, codigo: 'qr' })
    expect(html).toContain('size: 60mm 40mm')
    expect(html.match(/class="et /g)).toHaveLength(2)
  })

  it('método curto', () => {
    expect(metodoCurto('Vapor saturado sob pressão')).toBe('Vapor')
    expect(metodoCurto('Plasma de peróxido de hidrogênio')).toBe('Peróxido H2O2')
  })

  it('ZPL do rolo grande (110 × 150): largura útil da ZD220, UTF-8 e os campos em hexa', () => {
    const zpl = etiquetaZpl(pacote, CONFIG_PADRAO)
    expect(zpl).toMatch(/^\^XA\^CI28\^PW832\^LL1200\^LH0,0\^PON\^MD0/)
    expect(zpl).toContain('ESTERILIZA_C3_87_C3_83O')
    expect(zpl).toContain('^FDAC2-0457^FS')
    expect(zpl).toContain('_C3_89DINA')
    expect(zpl).toMatch(/\^BQN,2,\d+\^FDMA,2900000000018\^FS/)
    expect(zpl.trim().endsWith('^PQ1^XZ')).toBe(true)
  })

  it('ZPL deitado com barras, ajuste, escuridão e cópias', () => {
    const zpl = etiquetaZpl(pacote, { ...CONFIG_PADRAO, larguraMm: 100, alturaMm: 50, codigo: 'barras', ajusteXMm: 1, escuridao: 4, girar: true }, 3)
    expect(zpl).toContain('^PW800^LL400')
    expect(zpl).toContain('^POI^MD4')
    expect(zpl).toContain('^BEN,')
    expect(zpl).toContain('^FD290000000001^FS')
    expect(zpl).not.toContain('^BQN')
    expect(zpl).toContain('^FO32,')
    expect(zpl).toContain('^PQ3^XZ')
  })

  it('logo entra como ^GFA no topo', () => {
    const px = new Uint8ClampedArray(16 * 2 * 4).fill(255)
    px.set([0, 0, 0, 255], 0)
    const logo = pixelsParaGrafico(px, 16, 2)
    expect(logo.hex).toBe('80000000')
    expect(graficoZpl(logo)).toBe('^GFA,4,4,2,80000000^FS')
    expect(etiquetaZpl(pacote, CONFIG_PADRAO, 1, logo)).toContain('^GFA,4,4,2,80000000^FS')
  })

  it('texto longo é cortado com reticências em vez de passar por cima do QR', () => {
    const t = caberNaLargura('RESPONSÁVEL: MARIA APARECIDA DOS SANTOS OLIVEIRA', 26, 300)
    expect(t.endsWith('...')).toBe(true)
    expect(t.length).toBeLessThan(30)
  })

  it('texto ZPL escapa acento e caracteres de comando', () => {
    expect(textoZpl('Ç^~_a')).toBe('^FH_^FD_C3_87_5E_7E_5Fa^FS')
  })

  it('régua com moldura no tamanho útil', () => {
    expect(reguaZpl({ ...CONFIG_PADRAO, larguraMm: 100, alturaMm: 50 })).toContain('^FO0,0^GB800,400,3^FS')
  })
})
