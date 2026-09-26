import qrcode from 'qrcode-generator'

import { ean13Svg, ean13Valido } from '@/lib/codigoBarras'
import { escaparHtml } from '@/lib/exportar'
import { type GraficoZpl, type ImpressoraZebra, LARGURA_MAXIMA_MM, PONTOS_POR_MM, graficoZpl, mmParaPontos, textoZpl } from '@/lib/zebra'

// Etiqueta da CME na térmica (Zebra): uma página por etiqueta, no tamanho exato do rolo, pelo
// driver da impressora. RDC 15/2012, art. 85: nome do produto, lote, data da esterilização, data
// limite de uso, método e responsável pelo preparo.
//
// O desenho segue a etiqueta que a clínica já usava (foto do Álvaro, 23/09/2026): cabeçalho
// centralizado, nome do material, uma linha "ROTULO: valor" por campo, com EQUIPAMENTO separado do
// LOTE, e o QR à direita com o número do pacote embaixo.

export type PacoteParaEtiqueta = {
  codigo: string
  materialNome: string
  lote: string
  autoclave: string
  metodo: string
  esterilizadoEm: string
  validade: string
  responsavel: string
}

export type TamanhoEtiqueta = { larguraMm: number; alturaMm: number }
/** QR como na etiqueta antiga; barras para leitor que só lê código de uma dimensão. */
export type FormatoCodigo = 'qr' | 'barras'
/** Zebra: ZPL direto pelo Browser Print. Navegador: HTML pela janela de impressão e o driver. */
export type ModoImpressao = 'zebra' | 'navegador'
export type ConfigEtiqueta = TamanhoEtiqueta & {
  codigo: FormatoCodigo
  impressao: ModoImpressao
  /** Desloca o desenho dentro da etiqueta, em mm (positivo: para a direita e para baixo). */
  ajusteXMm: number
  ajusteYMm: number
  /** Escuridão somada à da impressora (^MD), de -15 a 15. */
  escuridao: number
  /** 180 graus, para quando o rolo entra ao contrário. */
  girar: boolean
  /** Logo do Instituto no topo (só na Zebra). */
  logo: boolean
  /** Impressora escolhida no Browser Print; null usa a padrão dele. */
  zebra: ImpressoraZebra | null
}

// O rolo que a clínica tem hoje na ZD220 é o grande, 110 × 150 mm (Álvaro, 26/09/2026).
export const TAMANHO_PADRAO: TamanhoEtiqueta = { larguraMm: 110, alturaMm: 150 }
export const CONFIG_PADRAO: ConfigEtiqueta = {
  ...TAMANHO_PADRAO,
  codigo: 'qr',
  impressao: 'zebra',
  ajusteXMm: 0,
  ajusteYMm: 0,
  escuridao: 0,
  girar: false,
  logo: true,
  zebra: null,
}

export const CABECALHO = 'INSTITUTO LORENA - CME'

/** Pacote da CME: EAN-13 interno com prefixo 29 (o estoque usa 20). */
export const ehCodigoDePacote = (codigo: string) => /^29\d{11}$/.test(codigo.trim()) && ean13Valido(codigo.trim())

const dataBr = (iso: string) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}
const horaBr = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

/** Método curto para caber: "Vapor saturado sob pressão" vira "Vapor". */
export const metodoCurto = (metodo: string) =>
  /vapor/i.test(metodo) ? 'Vapor' : /per[oó]xido/i.test(metodo) ? 'Peróxido H2O2' : /[oó]xido de etileno|eto/i.test(metodo) ? 'Óxido de etileno' : metodo

/** QR do código do pacote em SVG, módulo a módulo (nítido em qualquer escala da térmica). */
export function qrSvg(texto: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(texto)
  qr.make()
  const n = qr.getModuleCount()
  const margem = 1
  let rects = ''
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (qr.isDark(y, x)) rects += `<rect x="${x + margem}" y="${y + margem}" width="1" height="1"/>`
    }
  }
  const lado = n + margem * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`
}

const maiusculo = (s: string) => s.toLocaleUpperCase('pt-BR')

export function etiquetaHtml(p: PacoteParaEtiqueta, formato: FormatoCodigo = 'qr'): string {
  const linha = (rotulo: string, valor: string) => `<div class="l"><span class="r">${rotulo}:</span>${escaparHtml(valor)}</div>`
  const codigo =
    formato === 'qr'
      ? `<div class="qr">${qrSvg(p.codigo)}<div class="num">${p.codigo}</div></div>`
      : `<div class="barras">${ean13Svg(p.codigo, { altura: 30, modulo: 2 }).replace('<svg ', '<svg preserveAspectRatio="none" ')}<div class="num">${p.codigo}</div></div>`
  return `<section class="et et-${formato}">
  <div class="cab">${CABECALHO}</div>
  <div class="nome">${escaparHtml(p.materialNome)}</div>
  <div class="corpo">
    <div class="campos">
      ${linha('ESTERILIZAÇÃO', `${dataBr(p.esterilizadoEm)} ${horaBr(p.esterilizadoEm)}`.trim())}
      ${linha('VALIDADE', dataBr(p.validade))}
      ${linha('MÉTODO ESTER', maiusculo(metodoCurto(p.metodo)))}
      ${linha('LOTE', p.lote)}
      ${linha('EQUIPAMENTO', p.autoclave)}
      ${linha('RESPONSÁVEL', maiusculo(p.responsavel))}
    </div>
    ${codigo}
  </div>
</section>`
}

export function folhaDeEtiquetas(pacotes: PacoteParaEtiqueta[], config: Partial<ConfigEtiqueta> = CONFIG_PADRAO): string {
  const w = config.larguraMm ?? CONFIG_PADRAO.larguraMm
  const h = config.alturaMm ?? CONFIG_PADRAO.alturaMm
  const formato = config.codigo ?? CONFIG_PADRAO.codigo
  // Tudo em proporção: o mesmo desenho serve para 100×50, 80×40 ou 60×30. Num rolo em pé
  // (110×150) quem manda é a largura, e o desenho fica no alto da etiqueta.
  const u = Math.min(h / 50, w / 100)
  const mm = (v: number) => `${(v * u).toFixed(2)}mm`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas CME</title><style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .et { width: ${w}mm; height: ${h}mm; padding: ${mm(2.2)} ${mm(3)}; display: flex; flex-direction: column; overflow: hidden; page-break-after: always; break-after: page; }
  .et:last-child { page-break-after: auto; break-after: auto; }
  .cab { text-align: center; font-size: ${mm(3.1)}; font-weight: 700; letter-spacing: 0.02em; }
  .nome { font-size: ${mm(3.6)}; font-weight: 700; line-height: 1.1; margin-top: ${mm(0.6)}; max-height: 2.2em; overflow: hidden; }
  .corpo { flex: 1; display: flex; gap: ${mm(2)}; align-items: center; min-height: 0; margin-top: ${mm(0.8)}; }
  .campos { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; align-self: stretch; }
  .l { font-size: ${mm(3)}; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r { letter-spacing: 0.02em; margin-right: ${mm(0.6)}; }
  .qr { width: ${mm(23)}; flex: none; text-align: center; }
  .qr svg { width: 100%; height: auto; display: block; }
  .num { font-size: ${mm(2.5)}; margin-top: ${mm(0.5)}; letter-spacing: 0.04em; }
  .barras { width: 42%; flex: none; text-align: center; }
  .barras svg { width: 100%; height: ${mm(14)}; display: block; }
  ${h > w * 0.8 ? `.corpo { flex: none; height: ${mm(38)}; }` : ''}
</style></head><body>${pacotes.map((p) => etiquetaHtml(p, formato)).join('\n')}</body></html>`
}

const CHAVE_CONFIG = 'cme:etiqueta:config'

const numeroEntre = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : padrao
}

export function lerConfigEtiqueta(): ConfigEtiqueta {
  try {
    const t = JSON.parse(window.localStorage.getItem(CHAVE_CONFIG) ?? 'null') as Partial<ConfigEtiqueta> | null
    const l = Number(t?.larguraMm)
    const a = Number(t?.alturaMm)
    const tamanhoOk = l >= 30 && l <= 150 && a >= 20 && a <= 150
    return {
      larguraMm: tamanhoOk ? l : CONFIG_PADRAO.larguraMm,
      alturaMm: tamanhoOk ? a : CONFIG_PADRAO.alturaMm,
      codigo: t?.codigo === 'barras' ? 'barras' : 'qr',
      impressao: t?.impressao === 'navegador' ? 'navegador' : 'zebra',
      ajusteXMm: numeroEntre(t?.ajusteXMm, -20, 20, 0),
      ajusteYMm: numeroEntre(t?.ajusteYMm, -20, 20, 0),
      escuridao: Math.round(numeroEntre(t?.escuridao, -15, 15, 0)),
      girar: t?.girar === true,
      logo: t?.logo !== false,
      zebra: t?.zebra && typeof t.zebra.uid === 'string' && typeof t.zebra.name === 'string' ? t.zebra : null,
    }
  } catch {
    return CONFIG_PADRAO
  }
}

export function guardarConfigEtiqueta(c: ConfigEtiqueta): void {
  try {
    window.localStorage.setItem(CHAVE_CONFIG, JSON.stringify(c))
  } catch {
    /* segue com o padrão */
  }
}

// ── ZPL para a Zebra (ZD220, 203 dpi) ─────────────────────────────────────────────────────────
// O mesmo desenho do HTML, em pontos: cabeçalho, nome em até duas linhas, os seis campos à
// esquerda e o QR (ou as barras) à direita. Tudo proporcional à altura, como no HTML.

// Largura da fonte 0 (a fonte escalável da Zebra) por caractere, em fração da altura. Medido
// numa ZD de 203 dpi emulada: maiúscula ~0,52, M ~0,77, dígito ~0,49, minúscula ~0,42.
function larguraDoCaractere(c: string): number {
  if (/[MW]/.test(c)) return 0.78
  if (/[A-ZÀ-Þ]/.test(c)) return 0.56
  if (/[0-9]/.test(c)) return 0.5
  if (/[mw]/.test(c)) return 0.66
  if (/[a-zß-ÿ]/.test(c)) return 0.45
  if (c === ' ') return 0.25
  return 0.32
}
export const larguraDoTextoZpl = (s: string, altura: number) => [...s].reduce((t, c) => t + altura * larguraDoCaractere(c), 0)

/** Corta com "..." o que não cabe: na Zebra o texto comprido passaria por cima do QR. */
export function caberNaLargura(s: string, altura: number, largura: number): string {
  if (larguraDoTextoZpl(s, altura) <= largura) return s
  let t = s
  while (t.length > 1 && larguraDoTextoZpl(`${t}...`, altura) > largura) t = t.slice(0, -1)
  return `${t.trimEnd()}...`
}

/** Quebra por palavra em até `maxLinhas`; a última leva "..." se sobrar texto. */
export function quebrarLinhas(s: string, altura: number, largura: number, maxLinhas: number): string[] {
  const linhas: string[] = []
  let atual = ''
  const palavras = s.trim().split(/\s+/)
  for (let i = 0; i < palavras.length; i += 1) {
    const tentativa = atual ? `${atual} ${palavras[i]}` : palavras[i]
    if (larguraDoTextoZpl(tentativa, altura) <= largura || !atual) {
      atual = tentativa
      continue
    }
    linhas.push(atual)
    atual = palavras[i]
    if (linhas.length === maxLinhas - 1) {
      atual = palavras.slice(i).join(' ')
      break
    }
  }
  if (atual) linhas.push(atual)
  return linhas.slice(0, maxLinhas).map((l) => caberNaLargura(l, altura, largura))
}

/** Cabeçalho de toda etiqueta: tamanho, UTF-8, orientação e escuridão (sempre, para desfazer a anterior). */
function inicioZpl(config: ConfigEtiqueta): string {
  const esc = Math.max(-15, Math.min(15, Math.round(config.escuridao)))
  return `^XA^CI28^PW${larguraUtil(config)}^LL${mmParaPontos(config.alturaMm)}^LH0,0^PO${config.girar ? 'I' : 'N'}^MD${esc}`
}

/** Deslocamento do ajuste fino, sem deixar coordenada negativa (o ^FO não aceita). */
const posicionador = (config: ConfigEtiqueta) => {
  const dx = mmParaPontos(config.ajusteXMm)
  const dy = mmParaPontos(config.ajusteYMm)
  return (x: number, y: number) => `^FO${Math.max(0, Math.round(x + dx))},${Math.max(0, Math.round(y + dy))}`
}

const fonte = (altura: number) => `^A0N,${altura},${altura}`

// O ^BQ desenha o QR 10 pontos abaixo do ^FO: sobe o mesmo tanto para o QR ficar onde se mediu.
const DESLOCAMENTO_QR = 10
const MODULOS_EAN13 = 95

/** Largura útil em pontos: a ZD220 só imprime 104 mm, mesmo num rolo de 110. */
const larguraUtil = (config: ConfigEtiqueta) => mmParaPontos(Math.min(config.larguraMm, LARGURA_MAXIMA_MM))

/** Etiqueta em pé (o rolo de 110 × 150): logo no topo, campos em duas colunas, QR embaixo. */
export const ehRetrato = (config: TamanhoEtiqueta) => config.alturaMm > config.larguraMm * 0.8

/** Largura em pontos em que a logo entra na etiqueta, para quem vai converter a imagem. */
export function larguraDaLogo(config: ConfigEtiqueta): number {
  const W = larguraUtil(config)
  if (ehRetrato(config)) return Math.round(W - 2 * mmParaPontos(4 * escalaRetrato(config)))
  return Math.round(Math.min(W * 0.62, (config.alturaMm / 50) * mmParaPontos(40)))
}

const escalaRetrato = (config: ConfigEtiqueta) => Math.min(Math.min(config.larguraMm, LARGURA_MAXIMA_MM) / 100, config.alturaMm / 140)

function campos(p: PacoteParaEtiqueta): Array<[string, string]> {
  return [
    ['ESTERILIZAÇÃO', `${dataBr(p.esterilizadoEm)} ${horaBr(p.esterilizadoEm)}`.trim()],
    ['VALIDADE', dataBr(p.validade)],
    ['MÉTODO ESTER', maiusculo(metodoCurto(p.metodo))],
    ['LOTE', p.lote],
    ['EQUIPAMENTO', p.autoclave],
    ['RESPONSÁVEL', maiusculo(p.responsavel)],
  ]
}

function qrDoPacote(codigo: string) {
  const qr = qrcode(0, 'M')
  qr.addData(codigo)
  qr.make()
  return qr.getModuleCount()
}

export function etiquetaZpl(p: PacoteParaEtiqueta, config: ConfigEtiqueta = CONFIG_PADRAO, copias = 1, logo: GraficoZpl | null = null): string {
  const corpo = ehRetrato(config) ? corpoRetrato(p, config, logo) : corpoPaisagem(p, config, logo)
  return [inicioZpl(config), ...corpo, `^PQ${Math.max(1, Math.round(copias))}^XZ`].join('\n')
}

function corpoPaisagem(p: PacoteParaEtiqueta, config: ConfigEtiqueta, logo: GraficoZpl | null): string[] {
  const W = larguraUtil(config)
  const H = mmParaPontos(config.alturaMm)
  const u = config.alturaMm / 50
  const d = (mm: number) => Math.round(mm * u * PONTOS_POR_MM)
  const fo = posicionador(config)
  const padX = d(3)
  const padY = d(2.2)
  const partes: string[] = []

  let y = padY
  if (logo) {
    partes.push(`${fo((W - logo.larguraPontos) / 2, y)}${graficoZpl(logo)}`)
    y += logo.alturaPontos + d(0.8)
  } else {
    const hCab = d(3.1)
    partes.push(`${fo(padX, y)}${fonte(hCab)}^FB${W - 2 * padX},1,0,C,0${textoZpl(CABECALHO)}`)
    y += hCab + d(0.8)
  }

  const hNome = d(3.6)
  for (const linha of quebrarLinhas(p.materialNome, hNome, W - 2 * padX, 2)) {
    partes.push(`${fo(padX, y)}${fonte(hNome)}${textoZpl(linha)}`)
    y += hNome + d(0.4)
  }

  const topo = y + d(1.6)
  const base = H - padY
  const area = base - topo
  const larguraCodigo = config.codigo === 'qr' ? d(23) : Math.round(W * 0.42)
  const xCodigo = W - padX - larguraCodigo
  partes.push(...blocoDoCodigo(p.codigo, config, fo, xCodigo, topo, larguraCodigo, area, d(2.5), d(0.5), d(14)))

  const hCampo = d(3.3)
  const larguraCampos = xCodigo - d(2) - padX
  const lista = campos(p)
  const passo = Math.max(hCampo, (area - hCampo) / (lista.length - 1))
  lista.forEach(([rotulo, valor], i) => {
    partes.push(`${fo(padX, topo + i * passo)}${fonte(hCampo)}${textoZpl(caberNaLargura(`${rotulo}: ${valor}`, hCampo, larguraCampos))}`)
  })
  return partes
}

function corpoRetrato(p: PacoteParaEtiqueta, config: ConfigEtiqueta, logo: GraficoZpl | null): string[] {
  const W = larguraUtil(config)
  const H = mmParaPontos(config.alturaMm)
  const s = escalaRetrato(config)
  const d = (mm: number) => Math.round(mm * s * PONTOS_POR_MM)
  const fo = posicionador(config)
  const pad = d(4)
  const largura = W - 2 * pad
  const partes: string[] = []
  const linha = (y: number) => partes.push(`${fo(pad, y)}^GB${largura},${Math.max(2, d(0.4))},${Math.max(2, d(0.4))}^FS`)

  let y = pad
  if (logo) {
    partes.push(`${fo((W - logo.larguraPontos) / 2, y)}${graficoZpl(logo)}`)
    y += logo.alturaPontos + d(2.5)
    const hSub = d(3.6)
    partes.push(`${fo(pad, y)}${fonte(hSub)}^FB${largura},1,0,C,0${textoZpl('CME  ·  MATERIAL ESTERILIZADO')}`)
    y += hSub + d(2)
  } else {
    const hCab = d(5)
    partes.push(`${fo(pad, y)}${fonte(hCab)}^FB${largura},1,0,C,0${textoZpl(CABECALHO)}`)
    y += hCab + d(2)
  }
  linha(y)
  y += d(2.5)

  const hNome = d(8)
  for (const l of quebrarLinhas(p.materialNome, hNome, largura, 2)) {
    partes.push(`${fo(pad, y)}${fonte(hNome)}${textoZpl(l)}`)
    y += hNome + d(1)
  }
  y += d(1)
  linha(y)
  y += d(3)

  // Seis campos em duas colunas: rótulo pequeno em cima, valor grande embaixo.
  const hRotulo = d(3.6)
  const hValor = d(5.6)
  const vao = d(4)
  const coluna = Math.round((largura - vao) / 2)
  const lista = campos(p)
  const porColuna = Math.ceil(lista.length / 2)
  const passo = hRotulo + d(0.8) + hValor + d(5)
  lista.forEach(([rotulo, valor], i) => {
    const x = pad + (i < porColuna ? 0 : coluna + vao)
    const yc = y + (i % porColuna) * passo
    partes.push(`${fo(x, yc)}${fonte(hRotulo)}${textoZpl(rotulo)}`)
    partes.push(`${fo(x, yc + hRotulo + d(0.8))}${fonte(hValor)}${textoZpl(caberNaLargura(valor, hValor, coluna))}`)
  })
  y += porColuna * passo
  linha(y)
  y += d(3)

  const area = H - pad - y
  const larguraCodigo = config.codigo === 'qr' ? Math.min(largura, d(45)) : Math.round(largura * 0.85)
  partes.push(...blocoDoCodigo(p.codigo, config, fo, pad + (largura - larguraCodigo) / 2, y, larguraCodigo, area, d(4), d(1.2), d(26)))
  return partes
}

/** QR (ou EAN-13) com o número embaixo, centrado na caixa e no meio da altura disponível. */
function blocoDoCodigo(
  codigo: string,
  config: ConfigEtiqueta,
  fo: (x: number, y: number) => string,
  x: number,
  topo: number,
  largura: number,
  area: number,
  hNum: number,
  vaoNum: number,
  alturaBarras: number,
): string[] {
  if (config.codigo === 'qr') {
    const n = qrDoPacote(codigo)
    let mag = Math.max(1, Math.min(10, Math.floor(largura / n)))
    while (mag > 1 && mag * n + vaoNum + hNum > area) mag -= 1
    const lado = mag * n
    const yBloco = topo + Math.max(0, Math.round((area - (lado + vaoNum + hNum)) / 2))
    return [
      `${fo(x + (largura - lado) / 2, Math.max(0, yBloco - DESLOCAMENTO_QR))}^BQN,2,${mag}^FDMA,${codigo}^FS`,
      `${fo(x, yBloco + lado + vaoNum)}${fonte(hNum)}^FB${Math.round(largura)},1,0,C,0${textoZpl(codigo)}`,
    ]
  }
  const modulo = Math.max(1, Math.floor(largura / MODULOS_EAN13))
  // As barras de guarda do EAN descem uns 5 módulos abaixo das outras: o número vai depois delas.
  const vao = modulo * 5 + vaoNum
  const hBarras = Math.max(mmParaPontos(5), Math.min(alturaBarras, area - hNum - vao))
  const yBloco = topo + Math.max(0, Math.round((area - (hBarras + vao + hNum)) / 2))
  return [
    `${fo(x + (largura - modulo * MODULOS_EAN13) / 2, yBloco)}^BY${modulo}^BEN,${hBarras},N,N^FD${codigo.slice(0, 12)}^FS`,
    `${fo(x, yBloco + hBarras + vao)}${fonte(hNum)}^FB${Math.round(largura)},1,0,C,0${textoZpl(codigo)}`,
  ]
}

/** Um ^XA...^XZ por pacote: a Zebra corta (ou para no picote) a cada um. */
export const etiquetasZpl = (pacotes: PacoteParaEtiqueta[], config: ConfigEtiqueta = CONFIG_PADRAO, logo: GraficoZpl | null = null) =>
  pacotes.map((p) => etiquetaZpl(p, config, 1, logo)).join('\n')

/**
 * Régua de alinhamento: moldura na borda exata da etiqueta, outra a 2 mm, cruz no centro e
 * marcas a cada 5 mm. Mostra se o tamanho configurado bate com o rolo e para onde ajustar.
 */
export function reguaZpl(config: ConfigEtiqueta = CONFIG_PADRAO): string {
  const W = larguraUtil(config)
  const H = mmParaPontos(config.alturaMm)
  const fo = posicionador(config)
  const m = mmParaPontos(2)
  const partes: string[] = [inicioZpl(config)]
  partes.push(`${fo(0, 0)}^GB${W},${H},3^FS`)
  partes.push(`${fo(m, m)}^GB${W - 2 * m},${H - 2 * m},1^FS`)
  const cruz = mmParaPontos(3)
  partes.push(`${fo(Math.round(W / 2), Math.round(H / 2) - cruz)}^GB2,${cruz * 2},2^FS`)
  partes.push(`${fo(Math.round(W / 2) - cruz, Math.round(H / 2))}^GB${cruz * 2},2,2^FS`)
  const hMarca = mmParaPontos(Math.min(3, config.alturaMm / 12))
  const hNumero = mmParaPontos(Math.min(2.5, config.alturaMm / 16))
  for (let mm = 5; mm < Math.min(config.larguraMm, LARGURA_MAXIMA_MM); mm += 5) {
    const longa = mm % 10 === 0
    partes.push(`${fo(mmParaPontos(mm), 0)}^GB2,${longa ? hMarca * 2 : hMarca},2^FS`)
    if (longa && mm % 20 === 0) partes.push(`${fo(mmParaPontos(mm) + 4, hMarca * 2 - hNumero)}${fonte(hNumero)}^FD${mm}^FS`)
  }
  for (let mm = 5; mm < config.alturaMm; mm += 5) {
    const longa = mm % 10 === 0
    partes.push(`${fo(0, mmParaPontos(mm))}^GB${longa ? hMarca * 2 : hMarca},2,2^FS`)
    if (longa) partes.push(`${fo(hMarca * 2 + 4, mmParaPontos(mm) - Math.round(hNumero / 2))}${fonte(hNumero)}^FD${mm}^FS`)
  }
  const hTexto = mmParaPontos(Math.min(3.2, config.alturaMm / 15))
  const linhas = [
    `${config.larguraMm} x ${config.alturaMm} mm`,
    'ÁÉÍÓÚ ÂÊÔ ÃÕ Ç',
    `AJUSTE ${config.ajusteXMm} / ${config.ajusteYMm} MM  ESCURIDÃO ${config.escuridao}`,
  ]
  const larguraTexto = Math.round(W * 0.7)
  const xTexto = Math.round((W - larguraTexto) / 2)
  const yTexto = Math.round(H / 2) + cruz + mmParaPontos(1.5)
  linhas.forEach((l, i) => {
    partes.push(`${fo(xTexto, yTexto + i * Math.round(hTexto * 1.3))}${fonte(hTexto)}^FB${larguraTexto},1,0,C,0${textoZpl(l)}`)
  })
  partes.push('^PQ1^XZ')
  return partes.join('\n')
}

/** Calibra o sensor de picote: a Zebra puxa algumas etiquetas até achar o espaço entre elas. */
export const CALIBRAR_ZPL = '~JC'
/** Imprime a etiqueta de configuração da própria impressora (resolução, sensor, escuridão). */
export const CONFIGURACAO_ZPL = '~WC'
