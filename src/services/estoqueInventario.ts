import { supabase } from '@/lib/supabaseClient'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'

// Inventário (contagem física). Ao abrir, fotografa o saldo do sistema de cada item;
// a enfermeira conta o físico; ao finalizar, cada divergência vira um movimento de
// 'ajuste' (livro-razão único — não zera nem sobrescreve, só corrige a diferença).

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type CountStatus = 'aberta' | 'finalizada' | 'cancelada'

export type StockCountItem = {
  id: string
  itemId: string
  systemQty: number
  countedQty: number | null
}

export type StockCount = {
  id: string
  label: string
  status: CountStatus
  note: string | null
  createdAt: string
  finalizedAt: string | null
  items: StockCountItem[]
}

function mapItem(r: Record<string, unknown>): StockCountItem {
  return {
    id: String(r.id),
    itemId: String(r.item_id),
    systemQty: Number(r.system_qty ?? 0),
    countedQty: r.counted_qty != null ? Number(r.counted_qty) : null,
  }
}

export async function listCounts(): Promise<StockCount[]> {
  const client = assertClient()
  const [counts, items] = await Promise.all([
    client
      .from('stock_counts')
      .select('id, label, status, note, created_at, finalized_at')
      .order('created_at', { ascending: false })
      .limit(50),
    client.from('stock_count_items').select('id, count_id, item_id, system_qty, counted_qty'),
  ])
  if (counts.error) throw new Error(counts.error.message)
  if (items.error) throw new Error(items.error.message)
  const byCount = new Map<string, StockCountItem[]>()
  for (const r of items.data ?? []) {
    const key = String(r.count_id)
    const list = byCount.get(key) ?? []
    list.push(mapItem(r as Record<string, unknown>))
    byCount.set(key, list)
  }
  return (counts.data ?? []).map((r) => ({
    id: String(r.id),
    label: String(r.label ?? ''),
    status: (r.status === 'finalizada' || r.status === 'cancelada' ? r.status : 'aberta') as CountStatus,
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at ?? ''),
    finalizedAt: r.finalized_at != null ? String(r.finalized_at) : null,
    items: byCount.get(String(r.id)) ?? [],
  }))
}

/** Abre uma contagem fotografando o saldo atual de todos os itens ativos. */
export async function openCount(label: string): Promise<string> {
  const client = assertClient()
  const stock = await listStockItems()
  const { data, error } = await client
    .from('stock_counts')
    .insert({ label: label.trim() || 'Contagem' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const countId = String((data as { id: unknown }).id)
  if (stock.length > 0) {
    const { error: itemsErr } = await client.from('stock_count_items').insert(
      stock.map((s) => ({ count_id: countId, item_id: s.id, system_qty: s.qty })),
    )
    if (itemsErr) {
      await client.from('stock_counts').delete().eq('id', countId)
      throw new Error(itemsErr.message)
    }
  }
  return countId
}

export async function setCountedQty(countItemId: string, countedQty: number | null): Promise<void> {
  const client = assertClient()
  const { error } = await client
    .from('stock_count_items')
    .update({ counted_qty: countedQty })
    .eq('id', countItemId)
  if (error) throw new Error(error.message)
}

export async function cancelCount(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('stock_counts').update({ status: 'cancelada' }).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Finaliza: para cada item CONTADO com divergência vs. o saldo ATUAL, gera um ajuste.
 * Usa o saldo atual (não o fotografado) pra não desfazer entradas/saídas ocorridas
 * durante a contagem; a diferença aplicada leva o sistema ao valor físico contado.
 */
export async function finalizeCount(
  count: StockCount,
  currentStock: StockItem[],
): Promise<{ adjusted: number }> {
  const client = assertClient()
  const qtyById = new Map(currentStock.map((s) => [s.id, s.qty] as const))
  // Ajuste pode ser negativo (contou menos que o sistema) — gravamos o delta COM sinal
  // direto no livro-razão (registerMovement força positivo, não serve aqui).
  const adjustments = count.items
    .filter((item) => item.countedQty != null)
    .map((item) => {
      const current = qtyById.get(item.itemId) ?? item.systemQty
      return { item, current, diff: item.countedQty! - current }
    })
    .filter((a) => a.diff !== 0)

  if (adjustments.length > 0) {
    const { error: movErr } = await client.from('stock_movements').insert(
      adjustments.map((a) => ({
        item_id: a.item.itemId,
        kind: 'ajuste',
        qty_delta: a.diff,
        reason: 'inventário',
        note: `${count.label}: sistema ${a.current} → contado ${a.item.countedQty}`,
      })),
    )
    if (movErr) throw new Error(movErr.message)
  }
  const adjusted = adjustments.length
  const { error } = await client
    .from('stock_counts')
    .update({ status: 'finalizada', finalized_at: new Date().toISOString() })
    .eq('id', count.id)
  if (error) throw new Error(error.message)
  return { adjusted }
}
