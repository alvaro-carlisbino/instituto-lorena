/** Parser CSV simples (aspas duplas, vírgula). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      if (row.some((x) => x.trim().length > 0)) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += c
    }
  }
  row.push(cell)
  if (row.some((x) => x.trim().length > 0)) rows.push(row)
  return rows
}

export function rowsToObjects(header: string[], dataRows: string[][]): Record<string, string>[] {
  return dataRows.map((cells) => {
    const o: Record<string, string> = {}
    header.forEach((h, j) => {
      o[h.trim()] = (cells[j] ?? '').trim()
    })
    return o
  })
}
