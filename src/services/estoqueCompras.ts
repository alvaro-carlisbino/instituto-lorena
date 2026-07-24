import { supabase } from '@/lib/supabaseClient'

// Estoque + Compras + Contas a pagar. Todas as tabelas são multi-tenant com
// tenant_id default current_tenant_id() — o insert não precisa (nem deve)
// mandar tenant_id; a RLS isola clínica × Tricopill sozinha.

const BUCKET = 'crm-lead-attachments'

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

// ---------------------------------------------------------------- fornecedores

export type Supplier = {
  id: string
  name: string
  cnpj: string | null
  phone: string | null
  email: string | null
  note: string | null
  active: boolean
}

const SUPPLIER_COLS = 'id, name, cnpj, phone, email, note, active'

export async function listSuppliers(includeInactive = false): Promise<Supplier[]> {
  const client = assertClient()
  let query = client.from('stock_suppliers').select(SUPPLIER_COLS).order('name')
  if (!includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as Supplier[]
}

export async function upsertSupplier(payload: {
  id?: string
  name: string
  cnpj?: string | null
  phone?: string | null
  email?: string | null
  note?: string | null
  active?: boolean
}): Promise<Supplier> {
  const client = assertClient()
  const row = {
    name: payload.name.trim(),
    cnpj: payload.cnpj?.trim() || null,
    phone: payload.phone?.trim() || null,
    email: payload.email?.trim() || null,
    note: payload.note?.trim() || null,
    active: payload.active ?? true,
    updated_at: new Date().toISOString(),
  }
  const query = payload.id
    ? client.from('stock_suppliers').update(row).eq('id', payload.id)
    : client.from('stock_suppliers').insert(row)
  const { data, error } = await query.select(SUPPLIER_COLS).single()
  if (error) throw new Error(error.message)
  return data as Supplier
}

// --------------------------------------------------------------------- itens

export type StockItem = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category: string | null
  unit: string
  minQty: number
  source: string
  controlled: boolean
  note: string | null
  active: boolean
  /** Nomes alternativos (NF / princípio ativo) p/ match na entrada de nota. */
  aliases: string[]
  /** ID do produto no Bling — quando vinculado, a entrada de estoque é espelhada no Bling. */
  blingProductId: string | null
  /** saldo atual (da view stock_balances) */
  qty: number
  lastMovementAt: string | null
}

export async function listStockItems(includeInactive = false): Promise<StockItem[]> {
  const client = assertClient()
  let itemsQuery = client
    .from('stock_items')
    .select('id, name, sku, barcode, category, unit, min_qty, source, controlled, note, active, aliases, bling_product_id')
    .order('name')
  if (!includeInactive) itemsQuery = itemsQuery.eq('active', true)
  const [items, balances] = await Promise.all([
    itemsQuery,
    client.from('stock_balances').select('item_id, qty, last_movement_at'),
  ])
  if (items.error) throw new Error(items.error.message)
  if (balances.error) throw new Error(balances.error.message)
  const byItem = new Map(
    (balances.data ?? []).map((b) => [String(b.item_id), b] as const),
  )
  return (items.data ?? []).map((r) => {
    const bal = byItem.get(String(r.id))
    const aliasesRaw = (r as { aliases?: unknown }).aliases
    return {
      id: String(r.id),
      name: String(r.name),
      sku: r.sku != null ? String(r.sku) : null,
      barcode: r.barcode != null ? String(r.barcode) : null,
      category: r.category != null ? String(r.category) : null,
      unit: String(r.unit ?? 'un'),
      minQty: Number(r.min_qty ?? 0),
      source: String(r.source ?? 'manual'),
      controlled: Boolean(r.controlled),
      note: r.note != null ? String(r.note) : null,
      active: Boolean(r.active),
      aliases: Array.isArray(aliasesRaw) ? aliasesRaw.map((a) => String(a)) : [],
      blingProductId: r.bling_product_id != null ? String(r.bling_product_id) : null,
      qty: Number(bal?.qty ?? 0),
      lastMovementAt: bal?.last_movement_at ? String(bal.last_movement_at) : null,
    }
  })
}

export async function upsertStockItem(payload: {
  id?: string
  name: string
  sku?: string | null
  barcode?: string | null
  category?: string | null
  unit?: string
  minQty?: number
  controlled?: boolean
  source?: string
  note?: string | null
  aliases?: string[]
  active?: boolean
  blingProductId?: string | null
}): Promise<string> {
  const client = assertClient()
  const row: Record<string, unknown> = {
    name: payload.name.trim(),
    sku: payload.sku?.trim() || null,
    barcode: payload.barcode?.trim() || null,
    category: payload.category?.trim() || null,
    unit: (payload.unit ?? 'un').trim() || 'un',
    min_qty: payload.minQty ?? 0,
    controlled: payload.controlled ?? false,
    note: payload.note?.trim() || null,
    active: payload.active ?? true,
    updated_at: new Date().toISOString(),
  }
  if (payload.aliases !== undefined) {
    row.aliases = payload.aliases.map((a) => a.trim()).filter(Boolean)
  }
  if (payload.source) row.source = payload.source
  if (payload.blingProductId !== undefined) row.bling_product_id = payload.blingProductId?.trim() || null
  const query = payload.id
    ? client.from('stock_items').update(row).eq('id', payload.id)
    : client.from('stock_items').insert(row)
  const { data, error } = await query.select('id').single()
  if (error) throw new Error(error.message)
  return String((data as { id: unknown }).id)
}

// ---------------------------------------------------------------- movimentos

export type StockMovement = {
  id: string
  itemId: string
  kind: 'entrada' | 'saida' | 'ajuste'
  qtyDelta: number
  reason: string | null
  note: string | null
  createdAt: string
}

export async function listMovements(itemId: string, limit = 50): Promise<StockMovement[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('stock_movements')
    .select('id, item_id, kind, qty_delta, reason, note, created_at')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    itemId: String(r.item_id),
    kind: (r.kind === 'saida' || r.kind === 'ajuste' ? r.kind : 'entrada') as StockMovement['kind'],
    qtyDelta: Number(r.qty_delta ?? 0),
    reason: r.reason != null ? String(r.reason) : null,
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at ?? ''),
  }))
}

export type StockMovementRow = StockMovement & {
  refType: string | null
  unitCostCents: number | null
}

/** Movimentos de TODOS os itens no período (base dos relatórios). Datas em yyyy-mm-dd. */
export async function listMovementsInRange(fromDay: string, toDay: string): Promise<StockMovementRow[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('stock_movements')
    .select('id, item_id, kind, qty_delta, reason, note, ref_type, unit_cost_cents, created_at')
    .gte('created_at', `${fromDay}T00:00:00`)
    .lte('created_at', `${toDay}T23:59:59.999`)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    itemId: String(r.item_id),
    kind: (r.kind === 'saida' || r.kind === 'ajuste' ? r.kind : 'entrada') as StockMovement['kind'],
    qtyDelta: Number(r.qty_delta ?? 0),
    reason: r.reason != null ? String(r.reason) : null,
    note: r.note != null ? String(r.note) : null,
    refType: r.ref_type != null ? String(r.ref_type) : null,
    unitCostCents: r.unit_cost_cents != null ? Number(r.unit_cost_cents) : null,
    createdAt: String(r.created_at ?? ''),
  }))
}

export async function registerMovement(payload: {
  itemId: string
  kind: 'entrada' | 'saida' | 'ajuste'
  qty: number
  reason?: string
  note?: string
  refType?: string
  refId?: string
  batchId?: string | null
  /** Custo unitário em centavos no momento do movimento (base do gasto por paciente). */
  unitCostCents?: number | null
  /** Armazém/setor — null usa o padrão do tenant na view de saldos. */
  warehouseId?: string | null
}): Promise<string> {
  const client = assertClient()
  const qty = Math.abs(payload.qty)
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantidade inválida.')
  const delta = payload.kind === 'saida' ? -qty : qty
  const { data, error } = await client
    .from('stock_movements')
    .insert({
      item_id: payload.itemId,
      kind: payload.kind,
      qty_delta: delta,
      reason: payload.reason?.trim() || null,
      note: payload.note?.trim() || null,
      ref_type: payload.refType ?? null,
      ref_id: payload.refId ?? null,
      batch_id: payload.batchId ?? null,
      warehouse_id: payload.warehouseId || null,
      unit_cost_cents:
        payload.unitCostCents != null && payload.unitCostCents > 0
          ? Math.round(payload.unitCostCents)
          : null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return String((data as { id: unknown }).id)
}

// ------------------------------------------------------------ ordens de compra

export type PurchaseOrderStatus = 'solicitada' | 'aprovada' | 'comprada' | 'recebida' | 'cancelada'

export type PurchaseOrderItem = {
  id: string
  itemId: string | null
  description: string
  qty: number
  unitCostCents: number
}

export type PurchaseOrder = {
  id: string
  code: string
  supplierId: string | null
  supplierName: string | null
  status: PurchaseOrderStatus
  expectedDate: string | null
  totalCents: number
  note: string | null
  responsibleUserId: string | null
  responsibleName: string | null
  createdAt: string
  items: PurchaseOrderItem[]
}

const PO_STATUSES: PurchaseOrderStatus[] = ['solicitada', 'aprovada', 'comprada', 'recebida', 'cancelada']

export async function listPurchaseOrders(): Promise<PurchaseOrder[]> {
  const client = assertClient()
  const [orders, items] = await Promise.all([
    client
      .from('purchase_orders')
      .select(
        'id, code, supplier_id, status, expected_date, total_cents, note, responsible_user_id, responsible_name, created_at, stock_suppliers(name)',
      )
      .order('created_at', { ascending: false })
      .limit(200),
    client
      .from('purchase_order_items')
      .select('id, po_id, item_id, description, qty, unit_cost_cents'),
  ])
  if (orders.error) throw new Error(orders.error.message)
  if (items.error) throw new Error(items.error.message)
  const itemsByPo = new Map<string, PurchaseOrderItem[]>()
  for (const r of items.data ?? []) {
    const poId = String(r.po_id)
    const list = itemsByPo.get(poId) ?? []
    list.push({
      id: String(r.id),
      itemId: r.item_id != null ? String(r.item_id) : null,
      description: String(r.description ?? ''),
      qty: Number(r.qty ?? 0),
      unitCostCents: Number(r.unit_cost_cents ?? 0),
    })
    itemsByPo.set(poId, list)
  }
  return (orders.data ?? []).map((r) => {
    const supplier = r.stock_suppliers as { name?: unknown } | null
    const status = PO_STATUSES.includes(r.status as PurchaseOrderStatus)
      ? (r.status as PurchaseOrderStatus)
      : 'solicitada'
    return {
      id: String(r.id),
      code: String(r.code ?? ''),
      supplierId: r.supplier_id != null ? String(r.supplier_id) : null,
      supplierName: supplier?.name != null ? String(supplier.name) : null,
      status,
      expectedDate: r.expected_date != null ? String(r.expected_date) : null,
      totalCents: Number(r.total_cents ?? 0),
      note: r.note != null ? String(r.note) : null,
      responsibleUserId: r.responsible_user_id != null ? String(r.responsible_user_id) : null,
      responsibleName: r.responsible_name != null ? String(r.responsible_name) : null,
      createdAt: String(r.created_at ?? ''),
      items: itemsByPo.get(String(r.id)) ?? [],
    }
  })
}

export async function createPurchaseOrder(payload: {
  supplierId?: string | null
  expectedDate?: string | null
  note?: string
  responsibleUserId?: string | null
  responsibleName?: string | null
  items: Array<{ itemId: string | null; description: string; qty: number; unitCostCents: number }>
}): Promise<void> {
  const client = assertClient()
  const items = payload.items.filter((i) => i.description.trim() && i.qty > 0)
  if (items.length === 0) throw new Error('Inclua ao menos um item na ordem de compra.')
  const totalCents = items.reduce((sum, i) => sum + Math.round(i.qty * i.unitCostCents), 0)
  const code = `OC-${Date.now().toString(36).toUpperCase()}`
  const { data, error } = await client
    .from('purchase_orders')
    .insert({
      code,
      supplier_id: payload.supplierId || null,
      expected_date: payload.expectedDate || null,
      total_cents: totalCents,
      note: payload.note?.trim() || null,
      responsible_user_id: payload.responsibleUserId || null,
      responsible_name: payload.responsibleName?.trim() || null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const poId = String((data as { id: unknown }).id)
  const { error: itemsError } = await client.from('purchase_order_items').insert(
    items.map((i) => ({
      po_id: poId,
      item_id: i.itemId,
      description: i.description.trim(),
      qty: i.qty,
      unit_cost_cents: i.unitCostCents,
    })),
  )
  if (itemsError) {
    // evita OC órfã sem itens se o insert dos itens falhar (ex.: RLS)
    await client.from('purchase_orders').delete().eq('id', poId)
    throw new Error(itemsError.message)
  }
}

export async function setPurchaseOrderStatus(id: string, status: PurchaseOrderStatus): Promise<void> {
  const client = assertClient()
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (status === 'aprovada') {
    patch.approved_at = new Date().toISOString()
    const { data } = await client.auth.getUser()
    if (data.user?.id) patch.approved_by = data.user.id
  }
  const { error } = await client.from('purchase_orders').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Marca a OC como recebida e dá ENTRADA no estoque dos itens vinculados a stock_items. */
export async function receivePurchaseOrder(po: PurchaseOrder): Promise<{ stocked: number; skipped: number }> {
  const client = assertClient()
  let stocked = 0
  let skipped = 0
  for (const item of po.items) {
    if (!item.itemId) {
      skipped += 1
      continue
    }
    await registerMovement({
      itemId: item.itemId,
      kind: 'entrada',
      qty: item.qty,
      reason: 'compra',
      note: `Recebimento da ${po.code}`,
      refType: 'purchase_order',
      refId: po.id,
      unitCostCents: item.unitCostCents,
    })
    stocked += 1
  }
  const { error } = await client
    .from('purchase_orders')
    .update({ status: 'recebida', received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', po.id)
  if (error) throw new Error(error.message)
  return { stocked, skipped }
}

// ------------------------------------------------------- notas fiscais de compra

export type PurchaseInvoice = {
  id: string
  supplierId: string | null
  supplierName: string | null
  poId: string | null
  number: string
  issueDate: string | null
  totalCents: number
  storagePath: string | null
  fileName: string | null
  note: string | null
  createdAt: string
}

export async function listPurchaseInvoices(): Promise<PurchaseInvoice[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('purchase_invoices')
    .select('id, supplier_id, po_id, number, issue_date, total_cents, storage_path, file_name, note, created_at, stock_suppliers(name)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const supplier = r.stock_suppliers as { name?: unknown } | null
    return {
      id: String(r.id),
      supplierId: r.supplier_id != null ? String(r.supplier_id) : null,
      supplierName: supplier?.name != null ? String(supplier.name) : null,
      poId: r.po_id != null ? String(r.po_id) : null,
      number: String(r.number ?? ''),
      issueDate: r.issue_date != null ? String(r.issue_date) : null,
      totalCents: Number(r.total_cents ?? 0),
      storagePath: r.storage_path != null ? String(r.storage_path) : null,
      fileName: r.file_name != null ? String(r.file_name) : null,
      note: r.note != null ? String(r.note) : null,
      createdAt: String(r.created_at ?? ''),
    }
  })
}

export async function createPurchaseInvoice(payload: {
  number: string
  supplierId?: string | null
  poId?: string | null
  issueDate?: string | null
  totalCents: number
  note?: string
  file?: File | null
}): Promise<PurchaseInvoice> {
  const client = assertClient()
  let storagePath: string | null = null
  if (payload.file) {
    const safe = payload.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    storagePath = `purchase-invoices/${Date.now()}-${safe}`
    const { error: upErr } = await client.storage.from(BUCKET).upload(storagePath, payload.file, {
      contentType: payload.file.type || 'application/octet-stream',
    })
    if (upErr) throw new Error(upErr.message)
  }
  const { data, error } = await client
    .from('purchase_invoices')
    .insert({
      number: payload.number.trim(),
      supplier_id: payload.supplierId || null,
      po_id: payload.poId || null,
      issue_date: payload.issueDate || null,
      total_cents: payload.totalCents,
      storage_path: storagePath,
      file_name: payload.file?.name ?? null,
      note: payload.note?.trim() || null,
    })
    .select('id, supplier_id, po_id, number, issue_date, total_cents, storage_path, file_name, note, created_at')
    .single()
  if (error) {
    if (storagePath) await client.storage.from(BUCKET).remove([storagePath]).catch(() => {})
    throw new Error(error.message)
  }
  const r = data as Record<string, unknown>
  return {
    id: String(r.id),
    supplierId: r.supplier_id != null ? String(r.supplier_id) : null,
    supplierName: null,
    poId: r.po_id != null ? String(r.po_id) : null,
    number: String(r.number ?? ''),
    issueDate: r.issue_date != null ? String(r.issue_date) : null,
    totalCents: Number(r.total_cents ?? 0),
    storagePath: r.storage_path != null ? String(r.storage_path) : null,
    fileName: r.file_name != null ? String(r.file_name) : null,
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at ?? ''),
  }
}

export type InvoiceMovement = {
  id: string
  itemId: string
  itemName: string
  qtyDelta: number
  unit: string
  unitCostCents: number | null
  createdAt: string
}

/** O que essa NF colocou no estoque. Sem isso a nota registrada é só um total: não dava
 *  pra conferir se a entrada bateu com o que veio na caixa. */
export async function listInvoiceMovements(invoiceId: string): Promise<InvoiceMovement[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('stock_movements')
    .select('id, item_id, qty_delta, unit_cost_cents, created_at, stock_items(name, unit)')
    .eq('ref_type', 'purchase_invoice')
    .eq('ref_id', invoiceId)
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const item = r.stock_items as { name?: unknown; unit?: unknown } | null
    return {
      id: String(r.id),
      itemId: String(r.item_id),
      itemName: item?.name != null ? String(item.name) : 'Item removido',
      qtyDelta: Number(r.qty_delta ?? 0),
      unit: item?.unit != null ? String(item.unit) : 'un',
      unitCostCents: r.unit_cost_cents != null ? Number(r.unit_cost_cents) : null,
      createdAt: String(r.created_at ?? ''),
    }
  })
}

export async function getAttachmentSignedUrl(storagePath: string, expires = 3600): Promise<string> {
  const client = assertClient()
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(storagePath, expires)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Falha ao gerar link do anexo.')
  return data.signedUrl
}

// ------------------------------------------------- boletos / parcelas a pagar

export type PayableStatus = 'aberto' | 'pago' | 'cancelado'

export type Payable = {
  id: string
  invoiceId: string | null
  supplierId: string | null
  supplierName: string | null
  categoryId: string | null
  accountId: string | null
  description: string
  dueDate: string
  amountCents: number
  status: PayableStatus
  paidAt: string | null
  paymentMethod: string | null
  barcode: string | null
  storagePath: string | null
  note: string | null
  /** Centro de custo da planilha de gastos (ex.: Centro Cirúrgico, SPA). */
  costCenter: string | null
  /** Razão social / favorecido (quando não há supplier cadastrado). */
  counterparty: string | null
  /** Subcategoria livre (NF, VT, diarista, nome do colaborador…). */
  subcategory: string | null
  importKey: string | null
}

export async function listPayables(): Promise<Payable[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('payable_installments')
    .select('id, invoice_id, supplier_id, category_id, account_id, description, due_date, amount_cents, status, paid_at, payment_method, barcode, storage_path, note, cost_center, counterparty, subcategory, import_key, stock_suppliers(name)')
    .order('due_date')
    .limit(2000)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const supplier = r.stock_suppliers as { name?: unknown } | null
    const status: PayableStatus =
      r.status === 'pago' || r.status === 'cancelado' ? (r.status as PayableStatus) : 'aberto'
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
      status,
      paidAt: r.paid_at != null ? String(r.paid_at) : null,
      paymentMethod: r.payment_method != null ? String(r.payment_method) : null,
      barcode: r.barcode != null ? String(r.barcode) : null,
      storagePath: r.storage_path != null ? String(r.storage_path) : null,
      note: r.note != null ? String(r.note) : null,
      costCenter: r.cost_center != null ? String(r.cost_center) : null,
      counterparty: r.counterparty != null ? String(r.counterparty) : null,
      subcategory: r.subcategory != null ? String(r.subcategory) : null,
      importKey: r.import_key != null ? String(r.import_key) : null,
    }
  })
}

export async function createPayables(payload: {
  description: string
  supplierId?: string | null
  invoiceId?: string | null
  categoryId?: string | null
  accountId?: string | null
  amountCents: number
  firstDueDate: string
  installments: number
  paymentMethod?: string | null
  barcode?: string | null
  note?: string
  costCenter?: string | null
  counterparty?: string | null
  subcategory?: string | null
  status?: PayableStatus
  paidAt?: string | null
  importKey?: string | null
}): Promise<void> {
  const client = assertClient()
  const n = Math.max(1, Math.round(payload.installments))
  const rows = Array.from({ length: n }, (_, i) => {
    const due = new Date(`${payload.firstDueDate}T12:00:00`)
    due.setMonth(due.getMonth() + i)
    return {
      description: n > 1 ? `${payload.description.trim()} (${i + 1}/${n})` : payload.description.trim(),
      supplier_id: payload.supplierId || null,
      invoice_id: payload.invoiceId || null,
      category_id: payload.categoryId || null,
      account_id: payload.accountId || null,
      amount_cents: payload.amountCents,
      due_date: due.toISOString().slice(0, 10),
      payment_method: payload.paymentMethod || null,
      barcode: i === 0 ? payload.barcode?.trim() || null : null,
      note: payload.note?.trim() || null,
      cost_center: payload.costCenter?.trim() || null,
      counterparty: payload.counterparty?.trim() || null,
      subcategory: payload.subcategory?.trim() || null,
      status: payload.status ?? 'aberto',
      paid_at: payload.status === 'pago'
        ? (payload.paidAt ? new Date(`${payload.paidAt}T12:00:00`).toISOString() : new Date().toISOString())
        : null,
      import_key: payload.importKey || null,
    }
  })
  const { error } = await client.from('payable_installments').insert(rows)
  if (error) throw new Error(error.message)
}

/** Parcelas com data/valor EXATOS (duplicatas da NF-e), diferente do parcelamento mensal gerado. */
export async function createPayablesExact(rows: Array<{
  description: string
  supplierId?: string | null
  invoiceId?: string | null
  categoryId?: string | null
  accountId?: string | null
  dueDate: string
  amountCents: number
  paymentMethod?: string | null
  note?: string
}>): Promise<void> {
  if (rows.length === 0) return
  const client = assertClient()
  const { error } = await client.from('payable_installments').insert(
    rows.map((r) => ({
      description: r.description.trim(),
      supplier_id: r.supplierId || null,
      invoice_id: r.invoiceId || null,
      category_id: r.categoryId || null,
      account_id: r.accountId || null,
      due_date: r.dueDate,
      amount_cents: r.amountCents,
      payment_method: r.paymentMethod || null,
      note: r.note?.trim() || null,
    })),
  )
  if (error) throw new Error(error.message)
}

/** Baixa uma conta a pagar. Se `pay` trouxer uma conta (banco/caixa), grava também a SAÍDA
 *  real no razão de caixa (fin_transactions) — é assim que a baixa manual aparece no fluxo
 *  de caixa da clínica. Sem conta → só muda o status (comportamento antigo preservado). */
export async function setPayableStatus(
  id: string,
  status: PayableStatus,
  pay?: {
    accountId?: string | null
    paidOn?: string
    amountCents?: number
    categoryId?: string | null
    description?: string
    supplierName?: string | null
  },
): Promise<void> {
  const client = assertClient()
  const paidOn = pay?.paidOn ?? new Date().toISOString().slice(0, 10)
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  patch.paid_at = status === 'pago' ? new Date(`${paidOn}T12:00:00`).toISOString() : null
  if (status === 'pago' && pay?.accountId) patch.account_id = pay.accountId
  const { error } = await client.from('payable_installments').update(patch).eq('id', id)
  if (error) throw new Error(error.message)

  // Lançamento de caixa (saída) quando pago via uma conta. Escrito direto aqui pra não criar
  // ciclo de import com financeiro.ts (que só importa o TIPO Payable deste módulo).
  if (status === 'pago' && pay?.accountId && pay.amountCents && pay.amountCents > 0) {
    const { error: txnErr } = await client.from('fin_transactions').insert({
      account_id: pay.accountId,
      date: paidOn,
      amount_cents: -Math.abs(Math.round(pay.amountCents)),
      direction: 'out',
      category_id: pay.categoryId || null,
      description: pay.description ?? null,
      counterparty: pay.supplierName ?? null,
      source: 'payable',
      reconciled_ref_type: 'payable',
      reconciled_ref_id: id,
    })
    if (txnErr) throw new Error(txnErr.message)
  }
}
