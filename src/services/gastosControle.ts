import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabaseClient'
import { createPayables, type Payable } from '@/services/estoqueCompras'

/** Centros de custo padrão da planilha Instituto Lorena (maio/2026). */
export const DEFAULT_COST_CENTERS = [
  'Centro Cirúrgico',
  'Infraestrutura',
  'Retirada sócios',
  'Administrativo',
  'Atendimento',
  'SPA',
  'Marketing',
  'RH/DP',
  'Pagamentos médicos',
  'Londrina',
  'Impostos',
  'Benefícios',
  'Obra',
  'Devolução paciente',
] as const

export type GastoRow = {
  date: string // yyyy-mm-dd
  counterparty: string
  paymentMethod: string
  costCenter: string
  subcategory: string
  amountCents: number
  importKey: string
}

function assertClient() {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

function toISODate(value: unknown): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel serial date
    const utc = Math.round((value - 25569) * 86400 * 1000)
    const d = new Date(utc)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (br) {
    const dd = br[1].padStart(2, '0')
    const mm = br[2].padStart(2, '0')
    return `${br[3]}-${mm}-${dd}`
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

function toCents(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100)
  const s = String(value).trim().replace(/R\$\s?/i, '').replace(/\s/g, '')
  if (!s) return null
  // 1.234,56 ou 1234.56
  const normalized = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.')
    : s
  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

function normHeader(h: unknown): string {
  return String(h ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function pickCol(headers: string[], ...aliases: string[]): number {
  for (const a of aliases) {
    const i = headers.findIndex((h) => h === a || h.includes(a))
    if (i >= 0) return i
  }
  return -1
}

export function buildGastoImportKey(row: Omit<GastoRow, 'importKey'>): string {
  return [
    row.date,
    row.counterparty.toUpperCase().trim(),
    row.costCenter.toUpperCase().trim(),
    row.subcategory.toUpperCase().trim(),
    String(row.amountCents),
    row.paymentMethod.toUpperCase().trim(),
  ].join('|')
}

/** Lê a planilha no formato Data | Razão Social | Forma Pagto | C. Custo | Subcategoria | Valor. */
export async function parseGastosSpreadsheet(file: File): Promise<GastoRow[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  })
  if (matrix.length < 2) return []

  const headerRow = (matrix[0] ?? []).map(normHeader)
  let iDate = pickCol(headerRow, 'data')
  let iRazao = pickCol(headerRow, 'razao social', 'razao', 'favorecido', 'fornecedor')
  let iForma = pickCol(headerRow, 'forma pagto', 'forma de pag', 'pagamento', 'forma')
  let iCc = pickCol(headerRow, 'c. custo', 'c custo', 'centro de custo', 'centro custo')
  let iSub = pickCol(headerRow, 'subcategoria', 'sub categoria')
  let iValor = pickCol(headerRow, 'valor')

  // Fallback posicional (planilha padrão Instituto).
  if (iDate < 0) iDate = 0
  if (iRazao < 0) iRazao = 1
  if (iForma < 0) iForma = 2
  if (iCc < 0) iCc = 3
  if (iSub < 0) iSub = 4
  if (iValor < 0) iValor = 5

  const out: GastoRow[] = []
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] ?? []
    const date = toISODate(row[iDate])
    const amountCents = toCents(row[iValor])
    const counterparty = String(row[iRazao] ?? '').trim()
    if (!date || amountCents == null || amountCents === 0 || !counterparty) continue
    // Ignora blocos de resumo à direita / linhas sem centro de custo típicas de totais.
    const costCenter = String(row[iCc] ?? '').trim()
    if (!costCenter) continue
    const paymentMethod = String(row[iForma] ?? '').trim() || 'PIX'
    const subcategory = String(row[iSub] ?? '').trim()
    const base = { date, counterparty, paymentMethod, costCenter, subcategory, amountCents }
    out.push({ ...base, importKey: buildGastoImportKey(base) })
  }
  return out
}

export async function listGastos(opts?: {
  month?: string // yyyy-mm
  costCenter?: string
  q?: string
}): Promise<Payable[]> {
  const client = assertClient()
  let query = client
    .from('payable_installments')
    .select('id, invoice_id, supplier_id, category_id, account_id, description, due_date, amount_cents, status, paid_at, payment_method, barcode, storage_path, note, cost_center, counterparty, subcategory, import_key, stock_suppliers(name)')
    .order('due_date', { ascending: false })
    .limit(5000)

  if (opts?.month && /^\d{4}-\d{2}$/.test(opts.month)) {
    const [y, m] = opts.month.split('-').map(Number)
    const start = `${opts.month}-01`
    const endDate = new Date(y, m, 0)
    const end = endDate.toISOString().slice(0, 10)
    query = query.gte('due_date', start).lte('due_date', end)
  }
  if (opts?.costCenter) query = query.eq('cost_center', opts.costCenter)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  let rows = (data ?? []).map((r) => {
    const supplier = r.stock_suppliers as { name?: unknown } | null
    const status = r.status === 'pago' || r.status === 'cancelado' ? r.status : 'aberto'
    return {
      id: String(r.id),
      invoiceId: r.invoice_id != null ? String(r.invoice_id) : null,
      supplierId: r.supplier_id != null ? String(r.supplier_id) : null,
      supplierName: supplier?.name != null ? String(supplier.name) : null,
      categoryId: r.category_id != null ? String(r.category_id) : null,
      accountId: r.account_id != null ? String(r.account_id) : null,
      description: String(r.description ?? ''),
      dueDate: String(r.due_date ?? ''),
      amountCents: Number(r.amount_cents ?? 0),
      status: status as Payable['status'],
      paidAt: r.paid_at != null ? String(r.paid_at) : null,
      paymentMethod: r.payment_method != null ? String(r.payment_method) : null,
      barcode: r.barcode != null ? String(r.barcode) : null,
      storagePath: r.storage_path != null ? String(r.storage_path) : null,
      note: r.note != null ? String(r.note) : null,
      costCenter: r.cost_center != null ? String(r.cost_center) : null,
      counterparty: r.counterparty != null ? String(r.counterparty) : null,
      subcategory: r.subcategory != null ? String(r.subcategory) : null,
      importKey: r.import_key != null ? String(r.import_key) : null,
    } satisfies Payable
  })

  // Gastos = linhas com centro de custo OU importadas da planilha.
  rows = rows.filter((r) => r.costCenter || r.importKey)

  if (opts?.q?.trim()) {
    const q = opts.q.trim().toLowerCase()
    rows = rows.filter((r) => {
      const hay = [r.counterparty, r.supplierName, r.description, r.subcategory, r.costCenter, r.paymentMethod]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }
  return rows
}

export function totalsByCostCenter(rows: Payable[]): Array<{ costCenter: string; cents: number; count: number }> {
  const map = new Map<string, { cents: number; count: number }>()
  for (const r of rows) {
    const key = r.costCenter?.trim() || 'Sem centro'
    const cur = map.get(key) ?? { cents: 0, count: 0 }
    cur.cents += r.amountCents
    cur.count += 1
    map.set(key, cur)
  }
  return Array.from(map.entries())
    .map(([costCenter, v]) => ({ costCenter, ...v }))
    .sort((a, b) => b.cents - a.cents)
}

export async function importGastosRows(
  rows: GastoRow[],
  opts?: { markPaid?: boolean },
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 }
  const client = assertClient()
  const keys = rows.map((r) => r.importKey)
  const { data: existing, error: exErr } = await client
    .from('payable_installments')
    .select('import_key')
    .in('import_key', keys)
  if (exErr) throw new Error(exErr.message)
  const have = new Set((existing ?? []).map((r) => String(r.import_key)))
  const fresh = rows.filter((r) => !have.has(r.importKey))
  const skipped = rows.length - fresh.length
  if (fresh.length === 0) return { inserted: 0, skipped }

  const markPaid = opts?.markPaid !== false
  // Insert em lotes pra não estourar payload.
  const chunk = 80
  let inserted = 0
  for (let i = 0; i < fresh.length; i += chunk) {
    const slice = fresh.slice(i, i + chunk)
    const payload = slice.map((r) => {
      const desc = r.subcategory
        ? `${r.counterparty} — ${r.subcategory}`
        : r.counterparty
      return {
        description: desc,
        due_date: r.date,
        amount_cents: r.amountCents,
        payment_method: r.paymentMethod || null,
        cost_center: r.costCenter || null,
        counterparty: r.counterparty || null,
        subcategory: r.subcategory || null,
        import_key: r.importKey,
        status: markPaid ? 'pago' : 'aberto',
        paid_at: markPaid ? new Date(`${r.date}T12:00:00`).toISOString() : null,
        note: 'Importado da planilha de gastos',
      }
    })
    const { error } = await client.from('payable_installments').insert(payload)
    if (error) throw new Error(error.message)
    inserted += payload.length
  }
  return { inserted, skipped }
}

export async function createGastoManual(input: {
  date: string
  counterparty: string
  paymentMethod: string
  costCenter: string
  subcategory?: string
  amountCents: number
  markPaid?: boolean
}): Promise<void> {
  const subcategory = input.subcategory?.trim() || ''
  const base = {
    date: input.date,
    counterparty: input.counterparty.trim(),
    paymentMethod: input.paymentMethod.trim() || 'PIX',
    costCenter: input.costCenter.trim(),
    subcategory,
    amountCents: input.amountCents,
  }
  await createPayables({
    description: subcategory ? `${base.counterparty} — ${subcategory}` : base.counterparty,
    amountCents: base.amountCents,
    firstDueDate: base.date,
    installments: 1,
    paymentMethod: base.paymentMethod,
    costCenter: base.costCenter,
    counterparty: base.counterparty,
    subcategory: subcategory || null,
    status: input.markPaid === false ? 'aberto' : 'pago',
    paidAt: base.date,
    importKey: buildGastoImportKey(base),
    note: 'Lançamento manual — gastos e controle',
  })
}
