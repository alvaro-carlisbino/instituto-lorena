// Parser client-side de extrato bancário — OFX (padrão dos bancos) e CSV (Itaú e afins).
// Espelha o estilo de nfeXml.ts: recebe o texto do arquivo e devolve linhas normalizadas.
// Nada de dependência externa; OFX é SGML e a gente varre por tags.

export type BankTxn = {
  date: string // 'yyyy-mm-dd'
  amountCents: number // ASSINADO: crédito > 0, débito < 0
  description: string
  /** identificador estável no extrato (FITID no OFX; hash da linha no CSV) — dedup do import */
  externalId: string
}

// ───────────────────────────────────────────────────────────────────── OFX

function ofxTag(block: string, tag: string): string | null {
  // OFX/SGML: <TAG>valor  (fecha na próxima tag ou fim de linha). Aceita também <TAG>valor</TAG>.
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i')
  const m = block.match(re)
  return m ? m[1].trim() : null
}

function ofxDate(raw: string | null): string {
  // DTPOSTED: yyyymmdd[hhmmss][.xxx][gmt] → pega só yyyymmdd
  const digits = String(raw ?? '').replace(/[^0-9]/g, '')
  if (digits.length < 8) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

function amountToCents(raw: string | null): number {
  const s = String(raw ?? '').trim()
  if (!s) return 0
  // OFX usa ponto decimal; CSV BR usa vírgula. Normaliza os dois.
  let norm = s.replace(/\s/g, '')
  if (norm.includes(',') && norm.includes('.')) {
    // 1.234,56 → tira milhar ponto, vírgula vira ponto
    norm = norm.replace(/\./g, '').replace(',', '.')
  } else if (norm.includes(',')) {
    norm = norm.replace(',', '.')
  }
  const n = Number(norm)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function parseOfx(text: string): BankTxn[] {
  const out: BankTxn[] = []
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  let idx = 0
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0] ?? raw
    const date = ofxDate(ofxTag(block, 'DTPOSTED'))
    const amountCents = amountToCents(ofxTag(block, 'TRNAMT'))
    const memo = ofxTag(block, 'MEMO') ?? ofxTag(block, 'NAME') ?? ''
    const fitid = ofxTag(block, 'FITID') ?? ''
    if (!date || amountCents === 0) {
      idx += 1
      continue
    }
    out.push({
      date,
      amountCents,
      description: memo.trim() || 'Lançamento',
      externalId: fitid.trim() || `ofx-${date}-${amountCents}-${idx}`,
    })
    idx += 1
  }
  return out
}

// ───────────────────────────────────────────────────────────────────── CSV

function detectDelimiter(sample: string): string {
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 }
  for (const ch of sample) if (ch in counts) counts[ch] += 1
  // ';' costuma vencer em CSV BR (vírgula é decimal); senão tab; senão vírgula.
  if (counts[';'] >= counts['\t'] && counts[';'] >= counts[',']) return ';'
  if (counts['\t'] > counts[',']) return '\t'
  return ','
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else inQuotes = !inQuotes
    } else if (ch === delim && !inQuotes) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim().replace(/^"|"$/g, ''))
}

function brDate(raw: string): string {
  const s = raw.trim()
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})/) // dd/mm/yyyy
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[2]}-${m[1]}`
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) // já ISO
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return ''
}

function looksLikeAmount(v: string): boolean {
  return /^-?\s*R?\$?\s*-?[\d.]*,?\d+-?$/.test(v.trim()) && /\d/.test(v)
}

/** CSV de extrato: formatos variam por banco. Heurística — acha a coluna de DATA (dd/mm),
 *  a de VALOR (número com vírgula/traço) e usa o resto como descrição. Débito negativo. */
export function parseCsv(text: string): BankTxn[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  const delim = detectDelimiter(lines.slice(0, 5).join('\n'))
  const rows = lines.map((l) => splitCsvLine(l, delim)).filter((cols) => cols.length >= 2)

  const out: BankTxn[] = []
  let idx = 0
  for (const cols of rows) {
    const dateIdx = cols.findIndex((c) => brDate(c))
    if (dateIdx < 0) {
      idx += 1
      continue // linha de cabeçalho/saldo/rodapé
    }
    // valor = última coluna que parece número monetário (Itaú põe valor no fim)
    let amountIdx = -1
    for (let i = cols.length - 1; i >= 0; i--) {
      if (i !== dateIdx && looksLikeAmount(cols[i])) {
        amountIdx = i
        break
      }
    }
    if (amountIdx < 0) {
      idx += 1
      continue
    }
    const date = brDate(cols[dateIdx])
    let amountRaw = cols[amountIdx].replace(/R?\$/i, '').trim()
    // valor com sinal no fim ("100,00-") → move o sinal pra frente
    if (/-$/.test(amountRaw)) amountRaw = `-${amountRaw.replace(/-$/, '')}`
    const amountCents = amountToCents(amountRaw)
    if (!date || amountCents === 0) {
      idx += 1
      continue
    }
    const description =
      cols
        .filter((_, i) => i !== dateIdx && i !== amountIdx)
        .join(' ')
        .trim() || 'Lançamento'
    out.push({
      date,
      amountCents,
      description,
      externalId: `csv-${date}-${amountCents}-${idx}`,
    })
    idx += 1
  }
  return out
}

/** Detecta OFX × CSV pelo conteúdo e parseia. */
export function parseBankStatement(text: string, fileName?: string): { txns: BankTxn[]; format: 'ofx' | 'csv' } {
  const isOfx = /<OFX>|<STMTTRN>|OFXHEADER/i.test(text) || /\.ofx$/i.test(fileName ?? '')
  if (isOfx) return { txns: parseOfx(text), format: 'ofx' }
  return { txns: parseCsv(text), format: 'csv' }
}
