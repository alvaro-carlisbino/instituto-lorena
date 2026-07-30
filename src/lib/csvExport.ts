/**
 * Exportação de CSV no dialeto que o Excel em português abre com dois cliques:
 * separador `;` e BOM UTF-8 (sem o BOM, "Protocolo capilar" vira "Protocolo capilarâ¦").
 *
 * Estas duas funções estavam copiadas dentro de /carrinhos-abandonados, /gastos e
 * /relatorio-vendas. Ficam aqui para a próxima tela não copiar uma quarta vez.
 */

/** Escapa uma célula. Só cita quando precisa, para o arquivo continuar legível. */
export function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCsv(filename: string, rows: string[][]): void {
  const body = rows.map((r) => r.map(csvCell).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
