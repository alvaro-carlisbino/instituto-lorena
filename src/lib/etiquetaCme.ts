import { ean13Svg, ean13Valido } from '@/lib/codigoBarras'
import { escaparHtml } from '@/lib/exportar'

// Etiqueta da CME na térmica (Zebra): uma página por etiqueta, no tamanho exato do rolo, pelo
// driver da impressora. RDC 15/2012, art. 85: nome do produto, lote, data da esterilização, data
// limite de uso, método e responsável pelo preparo. O lote leva a autoclave e o ciclo.

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

export const TAMANHO_PADRAO: TamanhoEtiqueta = { larguraMm: 50, alturaMm: 30 }

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

export function etiquetaHtml(p: PacoteParaEtiqueta): string {
  return `<section class="et">
  <div class="topo"><span>Instituto Lorena · CME</span><span>${escaparHtml(metodoCurto(p.metodo))}</span></div>
  <div class="nome">${escaparHtml(p.materialNome)}</div>
  <div class="dados">
    <b>Lote</b><span>${escaparHtml(p.lote)} · ${escaparHtml(p.autoclave)}</span>
    <b>Esteril.</b><span>${dataBr(p.esterilizadoEm)} ${horaBr(p.esterilizadoEm)}</span>
    <b>Validade</b><span class="val">${dataBr(p.validade)}</span>
    <b>Resp.</b><span>${escaparHtml(p.responsavel)}</span>
  </div>
  <div class="barra">${ean13Svg(p.codigo, { altura: 30, modulo: 2 }).replace('<svg ', '<svg preserveAspectRatio="none" ')}<div class="num">${p.codigo}</div></div>
</section>`
}

export function folhaDeEtiquetas(pacotes: PacoteParaEtiqueta[], tamanho: TamanhoEtiqueta = TAMANHO_PADRAO): string {
  const { larguraMm: w, alturaMm: h } = tamanho
  return `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas CME</title><style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .et { width: ${w}mm; height: ${h}mm; padding: 1.4mm 2mm; display: flex; flex-direction: column; gap: 0.5mm; overflow: hidden; page-break-after: always; break-after: page; }
  .et:last-child { page-break-after: auto; break-after: auto; }
  .topo { display: flex; justify-content: space-between; font-size: 5.5pt; text-transform: uppercase; letter-spacing: 0.02em; }
  .nome { font-size: 8.5pt; font-weight: 700; line-height: 1.05; max-height: 2.1em; overflow: hidden; }
  .dados { display: grid; grid-template-columns: auto 1fr; column-gap: 1.5mm; font-size: 6.2pt; line-height: 1.15; }
  .dados b { font-weight: 400; }
  .dados span { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .barra { margin-top: auto; text-align: center; }
  .barra svg { width: 100%; height: ${Math.max(4, Math.round(h * 0.22))}mm; display: block; }
  .num { font-size: 5.5pt; letter-spacing: 0.08em; }
</style></head><body>${pacotes.map(etiquetaHtml).join('\n')}</body></html>`
}

const CHAVE_TAMANHO = 'cme:etiqueta:tamanho'

export function lerTamanhoEtiqueta(): TamanhoEtiqueta {
  try {
    const t = JSON.parse(window.localStorage.getItem(CHAVE_TAMANHO) ?? 'null') as Partial<TamanhoEtiqueta> | null
    const l = Number(t?.larguraMm)
    const a = Number(t?.alturaMm)
    if (l >= 20 && l <= 120 && a >= 15 && a <= 120) return { larguraMm: l, alturaMm: a }
  } catch {
    /* sem armazenamento: vale o padrão */
  }
  return TAMANHO_PADRAO
}

export function guardarTamanhoEtiqueta(t: TamanhoEtiqueta): void {
  try {
    window.localStorage.setItem(CHAVE_TAMANHO, JSON.stringify(t))
  } catch {
    /* segue com o padrão */
  }
}
