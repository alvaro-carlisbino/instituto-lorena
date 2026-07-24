/**
 * Importação de planilhas do shop (CSV/TSV — Excel salva como CSV).
 * Mapeia colunas flexíveis de custo/pagamento.
 */

export type ShopImportRow = {
  date: string | null
  description: string
  amountCents: number
  kind: 'custo' | 'pagamento' | 'outro'
  counterparty: string | null
  raw: Record<string, string>
}

export type ShopImportResult = {
  rows: ShopImportRow[]
  skipped: number
  headers: string[]
}

function parseCsv(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ','
  return lines.map((line) => {
    const cells: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = !inQ
      } else if (ch === sep && !inQ) {
        cells.push(cur.trim())
        cur = ''
      } else cur += ch
    }
    cells.push(cur.trim())
    return cells
  })
}

function normHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function parseMoney(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  // 1.234,56 ou 1234.56 ou 1234,56
  const cleaned = s.replace(/R\$\s?/i, '').replace(/\s/g, '')
  let n: number
  if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(cleaned) || /^-?\d+,\d+$/.test(cleaned)) {
    n = Number(cleaned.replace(/\./g, '').replace(',', '.'))
  } else {
    n = Number(cleaned.replace(/,/g, ''))
  }
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

function parseDate(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const br = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
  if (br) {
    const y = br[3].length === 2 ? `20${br[3]}` : br[3]
    return `${y}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

const DATE_KEYS = ['data', 'date', 'dt', 'vencimento', 'pagamento_em', 'created_at']
const DESC_KEYS = ['descricao', 'description', 'historico', 'memo', 'produto', 'item', 'obs', 'observacao']
const AMOUNT_KEYS = ['valor', 'amount', 'total', 'custo', 'pagamento', 'vlr', 'price']
const KIND_KEYS = ['tipo', 'type', 'natureza', 'categoria', 'kind']
const PARTY_KEYS = ['fornecedor', 'cliente', 'contraparte', 'counterparty', 'nome', 'paciente']

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (row[k]) return row[k]
  }
  return ''
}

function inferKind(raw: string, amountCents: number): 'custo' | 'pagamento' | 'outro' {
  const t = raw.toLowerCase()
  if (/pag|receb|pix|cartao|cartão|entrada/.test(t)) return 'pagamento'
  if (/cust|despes|compra|fornecedor|boleto/.test(t)) return 'custo'
  if (amountCents < 0) return 'custo'
  return 'outro'
}

/** Parseia CSV/TSV do shop → linhas normalizadas de custo/pagamento. */
export function parseShopSpreadsheet(text: string): ShopImportResult {
  const table = parseCsv(text)
  if (table.length < 2) return { rows: [], skipped: 0, headers: [] }
  const headers = table[0].map(normHeader)
  let skipped = 0
  const rows: ShopImportRow[] = []
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]
    const raw: Record<string, string> = {}
    headers.forEach((h, idx) => {
      raw[h] = cells[idx] ?? ''
    })
    const amountCents = parseMoney(pick(raw, AMOUNT_KEYS))
    const description = pick(raw, DESC_KEYS) || pick(raw, PARTY_KEYS) || 'Importação shop'
    if (amountCents == null || amountCents === 0) {
      skipped += 1
      continue
    }
    const kindRaw = pick(raw, KIND_KEYS)
    rows.push({
      date: parseDate(pick(raw, DATE_KEYS)),
      description,
      amountCents: Math.abs(amountCents),
      kind: inferKind(kindRaw || description, amountCents),
      counterparty: pick(raw, PARTY_KEYS) || null,
      raw,
    })
  }
  return { rows, skipped, headers }
}
