import qrcode from 'qrcode-generator'

import { ean13Svg, ean13Valido } from '@/lib/codigoBarras'
import { escaparHtml } from '@/lib/exportar'

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
export type ConfigEtiqueta = TamanhoEtiqueta & { codigo: FormatoCodigo }

export const TAMANHO_PADRAO: TamanhoEtiqueta = { larguraMm: 100, alturaMm: 50 }
export const CONFIG_PADRAO: ConfigEtiqueta = { ...TAMANHO_PADRAO, codigo: 'qr' }

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
  // Tudo em proporção da altura: o mesmo desenho serve para 100×50, 80×40 ou 60×30.
  const u = h / 50
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
</style></head><body>${pacotes.map((p) => etiquetaHtml(p, formato)).join('\n')}</body></html>`
}

const CHAVE_CONFIG = 'cme:etiqueta:config'

export function lerConfigEtiqueta(): ConfigEtiqueta {
  try {
    const t = JSON.parse(window.localStorage.getItem(CHAVE_CONFIG) ?? 'null') as Partial<ConfigEtiqueta> | null
    const l = Number(t?.larguraMm)
    const a = Number(t?.alturaMm)
    const codigo: FormatoCodigo = t?.codigo === 'barras' ? 'barras' : 'qr'
    if (l >= 30 && l <= 150 && a >= 20 && a <= 150) return { larguraMm: l, alturaMm: a, codigo }
    return { ...CONFIG_PADRAO, codigo }
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
