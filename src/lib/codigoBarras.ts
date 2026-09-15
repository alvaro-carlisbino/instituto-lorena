// Etiqueta de código de barras para o que chega sem código de fábrica (gaze em pacote, item
// fracionado, campo avulso). EAN-13 porque todo leitor lê sem configurar nada; o prefixo 20-29
// é reservado pelo GS1 para uso interno, então nunca colide com produto de mercado.

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** Dígito verificador do EAN-13 a partir dos 12 primeiros dígitos. */
export function digitoEan13(doze: string): number {
  if (!/^\d{12}$/.test(doze)) throw new Error('EAN-13 precisa de 12 dígitos antes do verificador.')
  const soma = doze.split('').reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (soma % 10)) % 10
}

export const ean13Valido = (codigo: string) => /^\d{13}$/.test(codigo) && digitoEan13(codigo.slice(0, 12)) === Number(codigo[12])

export const PREFIXO_INTERNO = '20'

/** Código interno n (1, 2, 3...) → EAN-13 "20" + 10 dígitos + verificador. */
export function codigoInterno(sequencia: number): string {
  if (!Number.isInteger(sequencia) || sequencia < 1 || sequencia > 9_999_999_999) throw new Error('Sequência inválida.')
  const doze = `${PREFIXO_INTERNO}${String(sequencia).padStart(10, '0')}`
  return `${doze}${digitoEan13(doze)}`
}

/** Próxima sequência livre olhando os códigos internos que já existem. */
export function proximaSequencia(codigos: Array<string | null | undefined>): number {
  let maior = 0
  for (const c of codigos) {
    if (c && c.startsWith(PREFIXO_INTERNO) && ean13Valido(c)) maior = Math.max(maior, Number(c.slice(2, 12)))
  }
  return maior + 1
}

/** As 95 barras do EAN-13 como "1" (preta) e "0" (branca). */
export function modulosEan13(codigo: string): string {
  if (!ean13Valido(codigo)) throw new Error(`Código EAN-13 inválido: ${codigo}`)
  const d = codigo.split('').map(Number)
  const paridade = PARIDADE[d[0]]
  let bits = '101'
  for (let i = 1; i <= 6; i += 1) bits += (paridade[i - 1] === 'L' ? L : G)[d[i]]
  bits += '01010'
  for (let i = 7; i <= 12; i += 1) bits += R[d[i]]
  return `${bits}101`
}

/** SVG do EAN-13 (sem texto: a etiqueta escreve os dígitos embaixo). */
export function ean13Svg(codigo: string, { altura = 48, modulo = 2 }: { altura?: number; modulo?: number } = {}): string {
  const bits = modulosEan13(codigo)
  const margem = 9 * modulo
  const largura = bits.length * modulo + margem * 2
  let rects = ''
  let x = margem
  for (let i = 0; i < bits.length; ) {
    if (bits[i] === '1') {
      let j = i
      while (j < bits.length && bits[j] === '1') j += 1
      rects += `<rect x="${x}" y="0" width="${(j - i) * modulo}" height="${altura}"/>`
      x += (j - i) * modulo
      i = j
    } else {
      x += modulo
      i += 1
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largura} ${altura}" width="${largura}" height="${altura}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`
}
