// Exportar relatório: Excel de verdade (.xlsx, com números como número) e PDF pela impressão.
//
// O repo só exportava CSV com ";", e cada tela montava o seu Blob. CSV abre no Excel com
// acento quebrado ou coluna colada dependendo da máquina; quem fecha o mês quer planilha.

export type Celula = string | number | null | undefined
export type Aba = { nome: string; colunas: string[]; linhas: Celula[][] }

const nomeArquivo = (base: string) =>
  base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

/** Planilha .xlsx com uma aba por tabela. SheetJS carrega só quando alguém exporta. */
export async function exportarExcel(arquivo: string, abas: Aba[]): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const aba of abas) {
    const ws = XLSX.utils.aoa_to_sheet([aba.colunas, ...aba.linhas.map((l) => l.map((c) => (c == null ? '' : c)))])
    ws['!cols'] = aba.colunas.map((c, i) => ({
      wch: Math.min(48, Math.max(c.length, ...aba.linhas.slice(0, 200).map((l) => String(l[i] ?? '').length)) + 2),
    }))
    // Nome de aba no Excel: até 31 caracteres e sem : \ / ? * [ ]
    XLSX.utils.book_append_sheet(wb, ws, aba.nome.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Planilha')
  }
  XLSX.writeFile(wb, `${nomeArquivo(arquivo)}.xlsx`)
}

/**
 * Imprime um HTML sem abrir janela. `window.open(..., 'noopener')` devolve null mesmo quando
 * abre a aba, e as telas diziam "Permita pop-ups" sempre. O iframe escondido imprime só ele.
 */
export function imprimirHtml(html: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (!doc || !frame.contentWindow) {
    frame.remove()
    throw new Error('Não foi possível preparar a impressão.')
  }
  doc.open()
  doc.write(html)
  doc.close()
  const imprimir = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    window.setTimeout(() => frame.remove(), 60_000)
  }
  if (doc.readyState === 'complete') window.setTimeout(imprimir, 50)
  else frame.addEventListener('load', imprimir, { once: true })
}

export const escaparHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** Relatório em PDF (pela impressão): título, período, cartões de resumo e uma tabela. */
export function exportarPdf(opts: {
  titulo: string
  subtitulo?: string
  resumo?: Array<{ rotulo: string; valor: string }>
  colunas: string[]
  /** Índices das colunas numéricas, alinhadas à direita. */
  numericas?: number[]
  linhas: Celula[][]
  rodape?: string
}): void {
  const num = new Set(opts.numericas ?? [])
  const th = opts.colunas.map((c, i) => `<th${num.has(i) ? ' class="n"' : ''}>${escaparHtml(c)}</th>`).join('')
  const tr = opts.linhas
    .map((l) => `<tr>${l.map((c, i) => `<td${num.has(i) ? ' class="n"' : ''}>${escaparHtml(String(c ?? ''))}</td>`).join('')}</tr>`)
    .join('')
  const cards = (opts.resumo ?? [])
    .map((r) => `<div class="card"><span>${escaparHtml(r.rotulo)}</span><strong>${escaparHtml(r.valor)}</strong></div>`)
    .join('')
  imprimirHtml(`<!doctype html><html><head><meta charset="utf-8"/><title>${escaparHtml(opts.titulo)}</title>
    <style>
      @page{size:A4 landscape;margin:12mm}
      body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:0}
      h1{font-size:18px;margin:0}.sub{color:#555;font-size:12px;margin:2px 0 12px}
      .cards{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
      .card{border:1px solid #ddd;border-radius:6px;padding:6px 10px;min-width:110px}
      .card span{display:block;font-size:10px;color:#666;text-transform:uppercase}.card strong{font-size:14px}
      table{width:100%;border-collapse:collapse;font-size:10.5px}
      th,td{border-bottom:1px solid #e3e3e3;padding:5px 4px;text-align:left;vertical-align:top}
      th{font-size:9.5px;text-transform:uppercase;color:#666;background:#f6f6f6}
      .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
      tr{page-break-inside:avoid}.foot{margin-top:10px;font-size:10px;color:#777}
    </style></head><body>
    <h1>${escaparHtml(opts.titulo)}</h1>
    ${opts.subtitulo ? `<div class="sub">${escaparHtml(opts.subtitulo)}</div>` : ''}
    ${cards ? `<div class="cards">${cards}</div>` : ''}
    <table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>
    ${opts.rodape ? `<div class="foot">${escaparHtml(opts.rodape)}</div>` : ''}
    </body></html>`)
}
