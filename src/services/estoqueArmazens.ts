import { buscarTudo } from '@/lib/supabasePaginate'
import { supabase } from '@/lib/supabaseClient'

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

export type StockTransferItem = { id: string; itemId: string; qty: number }

export type StockTransfer = {
  id: string
  fromWarehouseId: string
  toWarehouseId: string
  fromName: string
  toName: string
  note: string | null
  createdAt: string
  cancelledAt: string | null
  cancelReason: string | null
  items: StockTransferItem[]
}

function mapWarehouse(r: Record<string, unknown>): StockWarehouse {
  return {
    id: String(r.id),
    name: String(r.name),
    code: r.code != null ? String(r.code) : null,
    active: Boolean(r.active),
    isDefault: Boolean(r.is_default),
    note: r.note != null ? String(r.note) : null,
  }
}

/** Setores do polo, o padrão primeiro. `incluirInativos` para a tela de cadastro. */
export async function listWarehouses(incluirInativos = false): Promise<StockWarehouse[]> {
  let q = assertClient().from('stock_warehouses').select('id, name, code, active, is_default, note')
  if (!incluirInativos) q = q.eq('active', true)
  const { data, error } = await q.order('is_default', { ascending: false }).order('name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapWarehouse(r as Record<string, unknown>))
}

export async function upsertWarehouse(payload: {
  id?: string
  name: string
  code?: string | null
  isDefault?: boolean
  note?: string | null
}): Promise<void> {
  const client = assertClient()
  if (payload.name.trim().length < 2) throw new Error('Informe o nome do setor.')
  const row = {
    name: payload.name.trim(),
    code: payload.code?.trim().toUpperCase() || null,
    note: payload.note?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = payload.id
    ? await client.from('stock_warehouses').update(row).eq('id', payload.id).select('id').single()
    : await client.from('stock_warehouses').insert(row).select('id').single()
  if (error) throw new Error(error.message)
  if (payload.isDefault) await tornarSetorPadrao(String((data as { id: unknown }).id))
}

/**
 * Troca o setor padrão numa transação (stock_setor_tornar_padrao). Pelo navegador eram dois
 * updates: se o segundo falhasse, o polo ficava sem padrão e movimento sem setor sem destino.
 */
export async function tornarSetorPadrao(id: string): Promise<void> {
  const { error } = await assertClient().rpc('stock_setor_tornar_padrao', { p_setor: id })
  if (error) throw new Error(error.message)
}

/** Setor com saldo não se desativa: o material sumiria das listas sem sair do livro. */
export async function definirSetorAtivo(id: string, ativo: boolean): Promise<void> {
  const client = assertClient()
  if (!ativo) {
    const saldos = await listWarehouseBalances(id)
    const comSaldo = saldos.filter((s) => Math.abs(s.qty) > 0.0001).length
    if (comSaldo > 0) {
      throw new Error(`Este setor ainda tem saldo em ${comSaldo} ${comSaldo === 1 ? 'item' : 'itens'}. Transfira antes de desativar.`)
    }
  }
  const { error } = await client
    .from('stock_warehouses')
    .update({ active: ativo, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listWarehouseBalances(warehouseId?: string): Promise<Array<{ warehouseId: string; itemId: string; qty: number }>> {
  const linhas = await buscarTudo<Record<string, unknown>>(
    () => {
      let q = assertClient().from('stock_warehouse_balances').select('warehouse_id, item_id, qty')
      if (warehouseId) q = q.eq('warehouse_id', warehouseId)
      return q.order('warehouse_id').order('item_id')
    },
    { rotulo: 'stock_warehouse_balances' },
  )
  return linhas.map((r) => ({
    warehouseId: String(r.warehouse_id),
    itemId: String(r.item_id),
    qty: Number(r.qty ?? 0),
  }))
}

/**
 * Leva material de um setor para outro numa transação só (stock_transferir): sai da origem por
 * FEFO e entra no destino no mesmo lote e custo. A versão antiga gravava pelo navegador, sem
 * lote, e uma falha no meio deixava a transferência pela metade.
 */
export async function createTransfer(payload: {
  fromWarehouseId: string
  toWarehouseId: string
  note?: string
  items: Array<{ itemId: string; qty: number }>
}): Promise<{ transferId: string; movimentos: number }> {
  const items = payload.items.filter((i) => i.itemId && i.qty > 0)
  if (!payload.fromWarehouseId || !payload.toWarehouseId) throw new Error('Informe origem e destino.')
  if (payload.fromWarehouseId === payload.toWarehouseId) throw new Error('Origem e destino devem ser diferentes.')
  if (items.length === 0) throw new Error('Inclua ao menos um item.')
  const { data, error } = await assertClient().rpc('stock_transferir', {
    p_de: payload.fromWarehouseId,
    p_para: payload.toWarehouseId,
    p_itens: items.map((i) => ({ item_id: i.itemId, qty: i.qty })),
    p_obs: payload.note?.trim() || null,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { transfer_id?: string; movimentos?: number }
  return { transferId: String(r.transfer_id ?? ''), movimentos: Number(r.movimentos ?? 0) }
}

/** Devolve cada lote ao setor de onde saiu. A transferência fica no histórico como cancelada. */
export async function cancelarTransferencia(id: string, motivo: string): Promise<void> {
  if (motivo.trim().length < 3) throw new Error('Diga o motivo do cancelamento.')
  const { error } = await assertClient().rpc('stock_transferencia_cancelar', { p_id: id, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
}

export async function listTransfers(limite = 100): Promise<StockTransfer[]> {
  const client = assertClient()
  const [trs, wh] = await Promise.all([
    client
      .from('stock_transfers')
      .select('id, from_warehouse_id, to_warehouse_id, note, created_at, cancelled_at, cancel_reason')
      .order('created_at', { ascending: false })
      .limit(Math.min(limite, 1000)),
    client.from('stock_warehouses').select('id, name'),
  ])
  if (trs.error) throw new Error(trs.error.message)
  if (wh.error) throw new Error(wh.error.message)
  const ids = (trs.data ?? []).map((r) => String(r.id))
  const items =
    ids.length === 0
      ? []
      : await buscarTudo<Record<string, unknown>>(
          () => client.from('stock_transfer_items').select('id, transfer_id, item_id, qty').in('transfer_id', ids).order('id'),
          { rotulo: 'stock_transfer_items' },
        )
  const nameById = new Map((wh.data ?? []).map((w) => [String(w.id), String(w.name)] as const))
  const byTr = new Map<string, StockTransferItem[]>()
  for (const r of items) {
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
    cancelledAt: r.cancelled_at != null ? String(r.cancelled_at) : null,
    cancelReason: r.cancel_reason != null ? String(r.cancel_reason) : null,
    items: byTr.get(String(r.id)) ?? [],
  }))
}
