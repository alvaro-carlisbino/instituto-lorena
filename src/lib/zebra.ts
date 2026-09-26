// Zebra Browser Print: aplicativo da Zebra que roda no computador ligado à impressora e recebe o
// ZPL do navegador em 127.0.0.1 (9100 em http, 9101 em https, com certificado próprio). Sem driver
// nem janela de impressão: a etiqueta sai no tamanho e na posição exatos do ZPL.
//
// A API é a mesma que o BrowserPrint.js da Zebra chama: GET /default?type=printer, GET /available,
// POST /write com {device, data}. O corpo vai como text/plain para não disparar preflight de CORS.

export type ImpressoraZebra = {
  name: string
  uid: string
  connection: string
  deviceType: string
  version?: number
  provider?: string
  manufacturer?: string
}

export type MotivoErroZebra = 'sem_browser_print' | 'sem_impressora' | 'impressora'

export class ErroZebra extends Error {
  readonly motivo: MotivoErroZebra
  constructor(message: string, motivo: MotivoErroZebra) {
    super(message)
    this.name = 'ErroZebra'
    this.motivo = motivo
  }
}

/** ZD220: 203 dpi, 8 pontos por milímetro, até 104 mm de largura de impressão. */
export const PONTOS_POR_MM = 8
export const LARGURA_MAXIMA_MM = 104

// http primeiro: Chrome e Edge aceitam http://127.0.0.1 numa página https e assim ninguém precisa
// aceitar o certificado do Browser Print. O Safari bloqueia e cai no https.
const ENDERECOS = ['http://127.0.0.1:9100', 'https://127.0.0.1:9101']
let enderecoQueRespondeu: string | null = null

// Prazo longo de propósito: na primeira chamada o Chrome pergunta se o site pode falar com apps
// deste computador, e o Browser Print pergunta se aceita o site. Sem Browser Print a conexão é
// recusada na hora, então o prazo só pesa quando alguém está respondendo a pergunta.
async function pedir(caminho: string, init: RequestInit = {}, prazoMs = 20_000): Promise<string> {
  const ordem = enderecoQueRespondeu ? [enderecoQueRespondeu, ...ENDERECOS.filter((e) => e !== enderecoQueRespondeu)] : ENDERECOS
  for (const base of ordem) {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), prazoMs)
    try {
      const r = await fetch(`${base}${caminho}`, { ...init, signal: ctrl.signal })
      const texto = await r.text()
      enderecoQueRespondeu = base
      if (!r.ok) throw new ErroZebra(texto.trim() || `O Browser Print respondeu ${r.status}.`, 'impressora')
      return texto
    } catch (e) {
      if (e instanceof ErroZebra) throw e
    } finally {
      window.clearTimeout(timer)
    }
  }
  throw new ErroZebra('O Browser Print da Zebra não respondeu neste computador.', 'sem_browser_print')
}

const ehImpressora = (d: unknown): d is ImpressoraZebra =>
  !!d && typeof d === 'object' && typeof (d as ImpressoraZebra).uid === 'string' && typeof (d as ImpressoraZebra).name === 'string'

/** Impressora padrão do Browser Print, ou null se ninguém escolheu uma no aplicativo. */
export async function impressoraPadrao(): Promise<ImpressoraZebra | null> {
  const texto = await pedir('/default?type=printer')
  if (!texto.trim()) return null
  try {
    const d: unknown = JSON.parse(texto)
    return ehImpressora(d) ? d : null
  } catch {
    return null
  }
}

/** Todas as impressoras que o Browser Print enxerga (USB, driver e rede). */
export async function impressorasDisponiveis(): Promise<ImpressoraZebra[]> {
  const texto = await pedir('/available', {}, 30_000)
  try {
    const d = JSON.parse(texto) as { printer?: unknown[] }
    return (d.printer ?? []).filter(ehImpressora)
  } catch {
    return []
  }
}

/** A impressora guardada neste computador; se sumiu, a padrão do Browser Print; senão a primeira. */
export async function acharImpressora(uidGuardado?: string | null): Promise<{ escolhida: ImpressoraZebra; todas: ImpressoraZebra[] }> {
  const padrao = await impressoraPadrao()
  let todas: ImpressoraZebra[] = []
  try {
    todas = await impressorasDisponiveis()
  } catch {
    /* sem a lista, a padrão resolve */
  }
  if (padrao && !todas.some((d) => d.uid === padrao.uid)) todas = [padrao, ...todas]
  const escolhida = todas.find((d) => d.uid === uidGuardado) ?? padrao ?? todas[0]
  if (!escolhida) throw new ErroZebra('O Browser Print está aberto, mas não achou nenhuma impressora. Confira o cabo USB e se a Zebra está ligada.', 'sem_impressora')
  return { escolhida, todas }
}

export async function enviarZpl(impressora: ImpressoraZebra, zpl: string): Promise<void> {
  await pedir('/write', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ device: impressora, data: zpl }),
  })
}

/**
 * Texto de campo ZPL. Com ^CI28 a impressora lê UTF-8; com ^FH cada byte fora do ASCII (e os
 * caracteres de comando ^ ~ _) vai em hexa, então acento chega inteiro por qualquer caminho.
 */
export function textoZpl(texto: string): string {
  let saida = ''
  for (const c of texto) {
    const code = c.codePointAt(0) ?? 0
    if (code >= 0x20 && code <= 0x7e && c !== '^' && c !== '~' && c !== '_') {
      saida += c
    } else {
      for (const b of new TextEncoder().encode(c)) saida += `_${b.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return `^FH_^FD${saida}^FS`
}

export const mmParaPontos = (mm: number) => Math.round(mm * PONTOS_POR_MM)

/** Imagem 1 bit por ponto, no formato do ^GF (hexa, linha a linha). */
export type GraficoZpl = { larguraPontos: number; alturaPontos: number; bytesPorLinha: number; hex: string }

export const graficoZpl = (g: GraficoZpl) => {
  const total = g.hex.length / 2
  return `^GFA,${total},${total},${g.bytesPorLinha},${g.hex}^FS`
}

/** Pixels RGBA → 1 bit: escuro (luminância abaixo do limiar, sobre fundo branco) vira ponto preto. */
export function pixelsParaGrafico(rgba: Uint8ClampedArray, largura: number, altura: number, limiar = 150): GraficoZpl {
  const bytesPorLinha = Math.ceil(largura / 8)
  const bytes = new Uint8Array(bytesPorLinha * altura)
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const i = (y * largura + x) * 4
      const a = rgba[i + 3] / 255
      const lum = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a)
      if (lum < limiar) bytes[y * bytesPorLinha + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  let hex = ''
  for (const b of bytes) hex += b.toString(16).toUpperCase().padStart(2, '0')
  return { larguraPontos: bytesPorLinha * 8, alturaPontos: altura, bytesPorLinha, hex }
}

const cacheDeImagens = new Map<string, Promise<GraficoZpl>>()

/** Carrega a imagem (logo), redimensiona para a largura em pontos e converte para ^GF. */
export function imagemParaGrafico(url: string, larguraPontos: number): Promise<GraficoZpl> {
  const chave = `${url}@${larguraPontos}`
  const pronto = cacheDeImagens.get(chave)
  if (pronto) return pronto
  const promessa = (async () => {
    const img = new Image()
    img.src = url
    await img.decode()
    const largura = Math.max(8, Math.round(larguraPontos))
    const altura = Math.max(1, Math.round((img.naturalHeight * largura) / img.naturalWidth))
    const canvas = document.createElement('canvas')
    canvas.width = largura
    canvas.height = altura
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Sem canvas para converter a imagem.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, largura, altura)
    ctx.drawImage(img, 0, 0, largura, altura)
    return pixelsParaGrafico(ctx.getImageData(0, 0, largura, altura).data, largura, altura)
  })()
  promessa.catch(() => cacheDeImagens.delete(chave))
  cacheDeImagens.set(chave, promessa)
  return promessa
}
