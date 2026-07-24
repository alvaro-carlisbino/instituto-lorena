import { supabase } from '@/lib/supabaseClient'
import { registerMovement } from '@/services/estoqueCompras'

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type StockWarehouse = {
  id: string
  name: string
  code: string | null
  active: boolean
  isDefault: boolean
  note: string | null
}

export type StockTransfer = {
  id: string
  fromWarehouseId: string
  toWarehouseId: string
  fromName: string
  toName: string
  note: string | null
  createdAt: string
  items: Array<{ id: string; itemId: string; qty: number }>
}

export async function listWarehouses(): Promise<StockWarehouse[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('stock_warehouses')
    .select('id, name, code, active, is_default, note')
    .eq('active', true)
    .order('is_default', { ascending: false })
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    code: r.code != null ? String(r.code) : null,
    active: Boolean(r.active),
    isDefault: Boolean(r.is_default),
    note: r.note != null ? String(r.note) : null,
  }))
}

export async function upsertWarehouse(payload: {
  id?: string
  name: string
  code?: string | null
  isDefault?: boolean
  note?: string | null
}): Promise<void> {
  const client = assertClient()
  if (payload.name.trim().length < 2) throw new Error('Informe o nome do armazém/setor.')
  if (payload.isDefault) {
    await client.from('stock_warehouses').update({ is_default: false }).eq('is_default', true)
  }
  const row = {
    name: payload.name.trim(),
    code: payload.code?.trim() || null,
    is_default: Boolean(payload.isDefault),
    note: payload.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  if (payload.id) {
    const { error } = await client.from('stock_warehouses').update(row).eq('id', payload.id)
    if (error) throw new Error(error.message)
    return
  }
  const { error } = await client.from('stock_warehouses').insert(row)
  if (error) throw new Error(error.message)
}

export async function listWarehouseBalances(warehouseId?: string): Promise<Array<{ warehouseId: string; itemId: string; qty: number }>> {
  const client = assertClient()
  let q = client.from('stock_warehouse_balances').select('warehouse_id, item_id, qty')
  if (warehouseId) q = q.eq('warehouse_id', warehouseId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    warehouseId: String(r.warehouse_id),
    itemId: String(r.item_id),
    qty: Number(r.qty ?? 0),
  }))
}

export async function createTransfer(payload: {
  fromWarehouseId: string
  toWarehouseId: string
  note?: string
  items: Array<{ itemId: string; qty: number }>
}): Promise<void> {
  const client = assertClient()
  const items = payload.items.filter((i) => i.itemId && i.qty > 0)
  if (!payload.fromWarehouseId || !payload.toWarehouseId) throw new Error('Informe origem e destino.')
  if (payload.fromWarehouseId === payload.toWarehouseId) throw new Error('Origem e destino devem ser diferentes.')
  if (items.length === 0) throw new Error('Inclua ao menos um item.')

  const { data, error } = await client
    .from('stock_transfers')
    .insert({
      from_warehouse_id: payload.fromWarehouseId,
      to_warehouse_id: payload.toWarehouseId,
      note: payload.note?.trim() || null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const transferId = String((data as { id: unknown }).id)

  const { error: itemsErr } = await client.from('stock_transfer_items').insert(
    items.map((i) => ({ transfer_id: transferId, item_id: i.itemId, qty: i.qty })),
  )
  if (itemsErr) {
    await client.from('stock_transfers').delete().eq('id', transferId)
    throw new Error(itemsErr.message)
  }

  for (const item of items) {
    await registerMovement({
      itemId: item.itemId,
      kind: 'saida',
      qty: item.qty,
      reason: 'transferencia',
      note: `Transferência → outro setor`,
      refType: 'stock_transfer',
      refId: transferId,
      warehouseId: payload.fromWarehouseId,
    })
    await registerMovement({
      itemId: item.itemId,
      kind: 'entrada',
      qty: item.qty,
      reason: 'transferencia',
      note: `Transferência ← outro setor`,
      refType: 'stock_transfer',
      refId: transferId,
      warehouseId: payload.toWarehouseId,
    })
  }
}

export async function listTransfers(): Promise<StockTransfer[]> {
  const client = assertClient()
  const [trs, items, wh] = await Promise.all([
    client
      .from('stock_transfers')
      .select('id, from_warehouse_id, to_warehouse_id, note, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    client.from('stock_transfer_items').select('id, transfer_id, item_id, qty'),
    client.from('stock_warehouses').select('id, name'),
  ])
  if (trs.error) throw new Error(trs.error.message)
  if (items.error) throw new Error(items.error.message)
  if (wh.error) throw new Error(wh.error.message)
  const nameById = new Map((wh.data ?? []).map((w) => [String(w.id), String(w.name)] as const))
  const byTr = new Map<string, Array<{ id: string; itemId: string; qty: number }>>()
  for (const r of items.data ?? []) {
    const key = String(r.transfer_id)
    const list = byTr.get(key) ?? []
    list.push({ id: String(r.id), itemId: String(r.item_id), qty: Number(r.qty ?? 0) })
    byTr.set(key, list)
  }
  return (trs.data ?? []).map((r) => ({
    id: String(r.id),
    fromWarehouseId: String(r.from_warehouse_id),
    toWarehouseId: String(r.to_warehouse_id),
    fromName: nameById.get(String(r.from_warehouse_id)) ?? '?',
    toName: nameById.get(String(r.to_warehouse_id)) ?? '?',
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at ?? ''),
    items: byTr.get(String(r.id)) ?? [],
  }))
}
