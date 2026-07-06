import { supabase } from '@/lib/supabaseClient'
import { registerMovement } from '@/services/estoqueCompras'

// Fase 2 do estoque: lotes com validade (FEFO), kits cirúrgicos e livro de
// substâncias controladas. A baixa é sempre por AÇÃO da enfermagem (consumir o
// kit / saída manual) — nunca automática pela agenda (decisão de 16/jun).

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

// --------------------------------------------------------------------- lotes

export type StockBatch = {
  id: string
  itemId: string
  lotCode: string
  expiresOn: string | null
  qty: number
}

export async function listBatchBalances(itemId?: string): Promise<StockBatch[]> {
  const client = assertClient()
  let query = client
    .from('stock_batch_balances')
    .select('batch_id, item_id, lot_code, expires_on, qty')
  if (itemId) query = query.eq('item_id', itemId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: String(r.batch_id),
    itemId: String(r.item_id),
    lotCode: String(r.lot_code ?? ''),
    expiresOn: r.expires_on != null ? String(r.expires_on) : null,
    qty: Number(r.qty ?? 0),
  }))
}

/** Cria (ou reusa) o lote do item — a unique (tenant,item,lot_code) evita duplicar. */
export async function ensureBatch(payload: {
  itemId: string
  lotCode: string
  expiresOn?: string | null
}): Promise<string> {
  const client = assertClient()
  const lot = payload.lotCode.trim()
  if (!lot) throw new Error('Informe o código do lote.')
  const { data: existing, error: readErr } = await client
    .from('stock_batches')
    .select('id')
    .eq('item_id', payload.itemId)
    .eq('lot_code', lot)
    .maybeSingle()
  if (readErr) throw new Error(readErr.message)
  if (existing) return String((existing as { id: unknown }).id)
  const { data, error } = await client
    .from('stock_batches')
    .insert({ item_id: payload.itemId, lot_code: lot, expires_on: payload.expiresOn || null })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return String((data as { id: unknown }).id)
}

// ------------------------------------------------------------ modelos de kit

export type KitTemplateItem = { id: string; itemId: string; qty: number }
export type KitTemplate = {
  id: string
  name: string
  note: string | null
  active: boolean
  items: KitTemplateItem[]
}

export async function listKitTemplates(): Promise<KitTemplate[]> {
  const client = assertClient()
  const [tpls, items] = await Promise.all([
    client.from('kit_templates').select('id, name, note, active').eq('active', true).order('name'),
    client.from('kit_template_items').select('id, template_id, item_id, qty'),
  ])
  if (tpls.error) throw new Error(tpls.error.message)
  if (items.error) throw new Error(items.error.message)
  const byTpl = new Map<string, KitTemplateItem[]>()
  for (const r of items.data ?? []) {
    const key = String(r.template_id)
    const list = byTpl.get(key) ?? []
    list.push({ id: String(r.id), itemId: String(r.item_id), qty: Number(r.qty ?? 0) })
    byTpl.set(key, list)
  }
  return (tpls.data ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    note: r.note != null ? String(r.note) : null,
    active: Boolean(r.active),
    items: byTpl.get(String(r.id)) ?? [],
  }))
}

export async function createKitTemplate(payload: {
  name: string
  note?: string
  items: Array<{ itemId: string; qty: number }>
}): Promise<void> {
  const client = assertClient()
  const items = payload.items.filter((i) => i.itemId && i.qty > 0)
  if (payload.name.trim().length < 2) throw new Error('Informe o nome do modelo.')
  if (items.length === 0) throw new Error('Inclua ao menos um item no modelo.')
  const { data, error } = await client
    .from('kit_templates')
    .insert({ name: payload.name.trim(), note: payload.note?.trim() || null })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const templateId = String((data as { id: unknown }).id)
  const { error: itemsErr } = await client.from('kit_template_items').insert(
    items.map((i) => ({ template_id: templateId, item_id: i.itemId, qty: i.qty })),
  )
  if (itemsErr) {
    await client.from('kit_templates').delete().eq('id', templateId)
    throw new Error(itemsErr.message)
  }
}

export async function deactivateKitTemplate(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client
    .from('kit_templates')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// -------------------------------------------------------------- kits montados

export type KitStatus = 'montado' | 'consumido' | 'cancelado'
export type StockKitItem = { id: string; itemId: string; qty: number }
export type StockKit = {
  id: string
  name: string
  templateId: string | null
  leadId: string | null
  patientName: string | null
  procedureLabel: string | null
  scheduledFor: string | null
  status: KitStatus
  note: string | null
  createdAt: string
  consumedAt: string | null
  items: StockKitItem[]
}

export async function listKits(): Promise<StockKit[]> {
  const client = assertClient()
  const [kits, items] = await Promise.all([
    client
      .from('stock_kits')
      .select('id, name, template_id, lead_id, patient_name, procedure_label, scheduled_for, status, note, created_at, consumed_at')
      .order('created_at', { ascending: false })
      .limit(100),
    client.from('stock_kit_items').select('id, kit_id, item_id, qty'),
  ])
  if (kits.error) throw new Error(kits.error.message)
  if (items.error) throw new Error(items.error.message)
  const byKit = new Map<string, StockKitItem[]>()
  for (const r of items.data ?? []) {
    const key = String(r.kit_id)
    const list = byKit.get(key) ?? []
    list.push({ id: String(r.id), itemId: String(r.item_id), qty: Number(r.qty ?? 0) })
    byKit.set(key, list)
  }
  return (kits.data ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    templateId: r.template_id != null ? String(r.template_id) : null,
    leadId: r.lead_id != null ? String(r.lead_id) : null,
    patientName: r.patient_name != null ? String(r.patient_name) : null,
    procedureLabel: r.procedure_label != null ? String(r.procedure_label) : null,
    scheduledFor: r.scheduled_for != null ? String(r.scheduled_for) : null,
    status: (r.status === 'consumido' || r.status === 'cancelado' ? r.status : 'montado') as KitStatus,
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at ?? ''),
    consumedAt: r.consumed_at != null ? String(r.consumed_at) : null,
    items: byKit.get(String(r.id)) ?? [],
  }))
}

export async function createKit(payload: {
  templateId?: string | null
  name: string
  leadId?: string | null
  patientName?: string
  procedureLabel?: string
  scheduledFor?: string | null
  items: Array<{ itemId: string; qty: number }>
}): Promise<void> {
  const client = assertClient()
  const items = payload.items.filter((i) => i.itemId && i.qty > 0)
  if (items.length === 0) throw new Error('O kit precisa de ao menos um item.')
  const { data, error } = await client
    .from('stock_kits')
    .insert({
      template_id: payload.templateId || null,
      name: payload.name.trim() || 'Kit',
      lead_id: payload.leadId || null,
      patient_name: payload.patientName?.trim() || null,
      procedure_label: payload.procedureLabel?.trim() || null,
      scheduled_for: payload.scheduledFor || null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const kitId = String((data as { id: unknown }).id)
  const { error: itemsErr } = await client.from('stock_kit_items').insert(
    items.map((i) => ({ kit_id: kitId, item_id: i.itemId, qty: i.qty })),
  )
  if (itemsErr) {
    await client.from('stock_kits').delete().eq('id', kitId)
    throw new Error(itemsErr.message)
  }
}

/** Aloca a quantidade nos lotes por FEFO (vence primeiro sai primeiro; sem lote por último). */
export function allocateFefo(
  batches: StockBatch[],
  qtyNeeded: number,
): Array<{ batchId: string | null; qty: number }> {
  const available = batches
    .filter((b) => b.qty > 0)
    .sort((a, b) => {
      if (a.expiresOn && b.expiresOn) return a.expiresOn.localeCompare(b.expiresOn)
      if (a.expiresOn) return -1
      if (b.expiresOn) return 1
      return 0
    })
  const allocation: Array<{ batchId: string | null; qty: number }> = []
  let remaining = qtyNeeded
  for (const batch of available) {
    if (remaining <= 0) break
    const take = Math.min(batch.qty, remaining)
    allocation.push({ batchId: batch.id, qty: take })
    remaining -= take
  }
  // sem lote suficiente: o restante sai sem vínculo de lote (estoque legado/sem lote)
  if (remaining > 0) allocation.push({ batchId: null, qty: remaining })
  return allocation
}

/**
 * Consome o kit: baixa cada item por FEFO e registra itens controlados no livro.
 * É a "conferência ativa" da enfermeira — nada disso acontece automático.
 */
export async function consumeKit(
  kit: StockKit,
  controlledItemIds: Set<string>,
): Promise<{ movements: number; controlled: number }> {
  const client = assertClient()
  let movements = 0
  let controlled = 0
  for (const item of kit.items) {
    const batches = await listBatchBalances(item.itemId)
    const allocation = allocateFefo(batches, item.qty)
    for (const slice of allocation) {
      const movementId = await registerMovement({
        itemId: item.itemId,
        kind: 'saida',
        qty: slice.qty,
        reason: 'kit consumido',
        note: `${kit.name}${kit.patientName ? ` — ${kit.patientName}` : ''}`,
        refType: 'stock_kit',
        refId: kit.id,
        batchId: slice.batchId,
      })
      movements += 1
      if (controlledItemIds.has(item.itemId)) {
        const { error } = await client.from('controlled_substance_log').insert({
          item_id: item.itemId,
          batch_id: slice.batchId,
          movement_id: movementId,
          action: 'saida',
          qty: slice.qty,
          patient_name: kit.patientName || null,
          note: kit.procedureLabel || null,
        })
        if (error) throw new Error(error.message)
        controlled += 1
      }
    }
  }
  const { error } = await client
    .from('stock_kits')
    .update({ status: 'consumido', consumed_at: new Date().toISOString() })
    .eq('id', kit.id)
  if (error) throw new Error(error.message)
  return { movements, controlled }
}

export async function cancelKit(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('stock_kits').update({ status: 'cancelado' }).eq('id', id)
  if (error) throw new Error(error.message)
}

// --------------------------------------------------- livro de controlados

export type ControlledLogRow = {
  id: string
  itemId: string
  action: string
  qty: number
  patientName: string | null
  note: string | null
  createdAt: string
}

export async function listControlledLog(limit = 50): Promise<ControlledLogRow[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('controlled_substance_log')
    .select('id, item_id, action, qty, patient_name, note, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    itemId: String(r.item_id),
    action: String(r.action ?? ''),
    qty: Number(r.qty ?? 0),
    patientName: r.patient_name != null ? String(r.patient_name) : null,
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at ?? ''),
  }))
}

/** Entrada de controlado também vai pro livro (chamado junto do registerMovement de entrada). */
export async function logControlledEntry(payload: {
  itemId: string
  batchId?: string | null
  movementId?: string | null
  qty: number
  note?: string
}): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('controlled_substance_log').insert({
    item_id: payload.itemId,
    batch_id: payload.batchId ?? null,
    movement_id: payload.movementId ?? null,
    action: 'entrada',
    qty: payload.qty,
    note: payload.note?.trim() || null,
  })
  if (error) throw new Error(error.message)
}
