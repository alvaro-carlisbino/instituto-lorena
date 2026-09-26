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

// Como o BrowserPrint.js 3.0.216 da Zebra: http://127.0.0.1:9100 (o Chrome aceita http no
// 127.0.0.1 numa página https, e ninguém precisa aceitar certificado); o Safari bloqueia e cai no
// https 9101.
const ENDERECOS = ['http://127.0.0.1:9100', 'https://127.0.0.1:9101']
let enderecoQueRespondeu: string | null = null

/** Cada conversa com o Browser Print, para a tela de testes mostrar o que aconteceu. */
export type PassoZebra = { hora: string; metodo: string; url: string; resultado: string; ok: boolean }
const passos: PassoZebra[] = []
const anotar = (metodo: string, url: string, ok: boolean, resultado: string) => {
  passos.unshift({ hora: new Date().toLocaleTimeString('pt-BR'), metodo, url, ok, resultado: resultado.slice(0, 300) })
  passos.length = Math.min(passos.length, 30)
}
export const passosZebra = (): PassoZebra[] => [...passos]

// Prazo longo de propósito: na primeira chamada o Chrome pergunta se o site pode falar com apps
// deste computador, e o Browser Print pergunta se aceita o site. Sem Browser Print a conexão é
// recusada na hora, então o prazo só pesa quando alguém está respondendo a pergunta.
async function pedir(caminho: string, init: RequestInit = {}, prazoMs = 20_000): Promise<string> {
  const ordem = enderecoQueRespondeu ? [enderecoQueRespondeu, ...ENDERECOS.filter((e) => e !== enderecoQueRespondeu)] : ENDERECOS
  const metodo = init.method ?? 'GET'
  let ultimaFalha = ''
  for (const base of ordem) {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), prazoMs)
    const url = `${base}${caminho}`
    try {
      const r = await fetch(url, { ...init, signal: ctrl.signal })
      const texto = await r.text()
      enderecoQueRespondeu = base
      anotar(metodo, url, r.ok, `${r.status} ${texto.trim() || '(vazio)'}`)
      if (!r.ok) throw new ErroZebra(texto.trim() || `O Browser Print respondeu ${r.status}.`, 'impressora')
      return texto
    } catch (e) {
      if (e instanceof ErroZebra) throw e
      ultimaFalha = ctrl.signal.aborted ? `sem resposta em ${prazoMs / 1000}s` : e instanceof Error ? e.message : String(e)
      anotar(metodo, url, false, ultimaFalha)
    } finally {
      window.clearTimeout(timer)
    }
  }
  throw new ErroZebra(`O Browser Print da Zebra não respondeu neste computador (${ultimaFalha}).`, 'sem_browser_print')
}

/**
 * O device do jeito que o BrowserPrint.js manda de volta: só estes sete campos e version 2 fixo
 * (é a versão da API, não a da impressora). Mandar o objeto como veio do /available não é o mesmo.
 */
export function deviceParaEnvio(d: ImpressoraZebra) {
  return {
    name: d.name,
    uid: d.uid,
    connection: d.connection,
    deviceType: d.deviceType,
    version: 2,
    provider: d.provider,
    manufacturer: d.manufacturer,
  }
}

const ehImpressora = (d: unknown): d is ImpressoraZebra =>
  !!d && typeof d === 'object' && typeof (d as ImpressoraZebra).uid === 'string' && typeof (d as ImpressoraZebra).name === 'string'

/** O /default costuma vir em JSON; algumas versões mandam linhas "name: ...", e essas também servem. */
export function lerDevice(texto: string): ImpressoraZebra | null {
  const t = texto.trim()
  if (!t) return null
  try {
    const d: unknown = JSON.parse(t)
    return ehImpressora(d) ? d : null
  } catch {
    const campos: Record<string, string> = {}
    for (const linha of t.split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/)
      if (m) campos[m[1]] = m[2]
    }
    return campos.uid && campos.name
      ? { name: campos.name, uid: campos.uid, connection: campos.connection ?? '', deviceType: campos.deviceType ?? 'printer', provider: campos.provider, manufacturer: campos.manufacturer }
      : null
  }
}

/** Impressora padrão do Browser Print, ou null se ninguém escolheu uma no aplicativo. */
export async function impressoraPadrao(): Promise<ImpressoraZebra | null> {
  return lerDevice(await pedir('/default?type=printer'))
}

/** Todas as impressoras que o Browser Print enxerga (USB, driver e rede). */
export async function impressorasDisponiveis(): Promise<ImpressoraZebra[]> {
  const texto = await pedir('/available', {}, 30_000)
  try {
    const d = JSON.parse(texto) as Record<string, unknown>
    return Object.values(d)
      .filter(Array.isArray)
      .flat()
      .filter(ehImpressora)
      .filter((x) => !x.deviceType || x.deviceType === 'printer')
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
    body: JSON.stringify({ device: deviceParaEnvio(impressora), data: zpl }),
  })
}

async function lerDaImpressora(impressora: ImpressoraZebra): Promise<string> {
  return pedir('/read', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ device: deviceParaEnvio(impressora) }),
  })
}

export type StatusZebra = { pronta: boolean; problemas: string[]; ribbon: boolean; bruto: string }

/**
 * ~HS (host status): três blocos entre STX e ETX, separados por vírgula. Bloco 1: papel acabou
 * (2º campo), pausada (3º). Bloco 2: cabeça aberta (3º), ribbon acabou (4º), modo ribbon (5º),
 * etiquetas ainda na fila (9º).
 */
export function lerStatusHs(bruto: string): StatusZebra | null {
  const STX = String.fromCharCode(2)
  const ETX = String.fromCharCode(3)
  const blocos = bruto
    .split(STX)
    .slice(1)
    .filter((b) => b.includes(ETX))
    .map((b) => b.slice(0, b.indexOf(ETX)).split(','))
  if (blocos.length < 2 || blocos[0].length < 3 || blocos[1].length < 5) return null
  const [b1, b2] = blocos
  const problemas: string[] = []
  if (b1[1] === '1') problemas.push('Sem etiqueta (papel acabou ou sensor não achou)')
  if (b1[2] === '1') problemas.push('Pausada: aperte o botão de pausa da Zebra')
  if (b2[2] === '1') problemas.push('Tampa ou cabeça aberta')
  if (b2[3] === '1') problemas.push('Sem ribbon (a Zebra está no modo transferência térmica)')
  if (b1[11] === '1') problemas.push('Cabeça quente demais')
  const restantes = Number(b2[8])
  if (Number.isFinite(restantes) && restantes > 0) problemas.push(`${restantes} etiqueta(s) ainda na fila da Zebra`)
  return { pronta: problemas.length === 0, problemas, ribbon: b2[4] === '1', bruto }
}

/** Pergunta o status (só funciona com a Zebra em conexão usb ou rede; pelo driver não há leitura). */
export async function statusDaImpressora(impressora: ImpressoraZebra): Promise<StatusZebra> {
  await enviarZpl(impressora, '~HS')
  let bruto = ''
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => window.setTimeout(r, 400))
    bruto += await lerDaImpressora(impressora)
    const s = lerStatusHs(bruto)
    if (s) return s
  }
  throw new ErroZebra(
    bruto.trim()
      ? `A Zebra respondeu algo que não é o status: ${bruto.trim().slice(0, 80)}`
      : `A Zebra não devolveu o status. Pela conexão "${impressora.connection}" talvez não dê para ler (pelo driver do Windows não dá).`,
    'impressora',
  )
}

/** A menor etiqueta possível: se esta não sair, o problema não é o desenho da etiqueta. */
export const ZPL_MINIMO = '^XA^FO40,40^A0N,60,60^FDTESTE ZEBRA^FS^FO40,120^A0N,30,30^FDSe saiu, o caminho funciona.^FS^XZ'

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
