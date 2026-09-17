import { buscarTudo } from '@/lib/supabasePaginate'
import { supabase } from '@/lib/supabaseClient'

// Inventário (contagem física) de UM setor. Ao abrir, fotografa o saldo do sistema naquele
// setor; a equipe conta o físico; ao finalizar, cada divergência vira 'ajuste' no livro, a
// falta saindo dos lotes por FEFO. Abrir, incluir item e finalizar moram no banco
// (migration 20260917213000): uma transação, com setor, lote e a contagem como origem.

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
  /** Setor contado. Nulo nas contagens antigas, que valiam para o setor padrão. */
  warehouseId: string | null
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
      .select('id, label, status, note, created_at, finalized_at, warehouse_id')
      .order('created_at', { ascending: false })
      .limit(50),
    // As duas contagens de 14/09 somam mais de 1.000 linhas: sem paginar, uma delas abria pela metade.
    buscarTudo<Record<string, unknown>>(
      () => client.from('stock_count_items').select('id, count_id, item_id, system_qty, counted_qty').order('id'),
      { rotulo: 'stock_count_items' },
    ),
  ])
  if (counts.error) throw new Error(counts.error.message)
  const byCount = new Map<string, StockCountItem[]>()
  for (const r of items) {
    const key = String(r.count_id)
    const list = byCount.get(key) ?? []
    list.push(mapItem(r as Record<string, unknown>))
    byCount.set(key, list)
  }
  return (counts.data ?? []).map((r) => ({
    id: String(r.id),
    label: String(r.label ?? ''),
    warehouseId: r.warehouse_id != null ? String(r.warehouse_id) : null,
    status: (r.status === 'finalizada' || r.status === 'cancelada' ? r.status : 'aberta') as CountStatus,
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at ?? ''),
    finalizedAt: r.finalized_at != null ? String(r.finalized_at) : null,
    items: byCount.get(String(r.id)) ?? [],
  }))
}

/**
 * Abre a contagem de um setor. Sem `todos`, lista só o que o sistema diz estar no setor (ou tem
 * endereço nele); o que aparecer na prateleira e não estiver na lista se inclui bipando.
 */
export async function openCount(label: string, setorId: string | null, todos = false): Promise<string> {
  const { data, error } = await assertClient().rpc('stock_inventario_abrir', {
    p_rotulo: label.trim() || 'Contagem',
    p_setor: setorId,
    p_todos: todos,
  })
  if (error) throw new Error(error.message)
  return String(data ?? '')
}

/** Item achado na prateleira que não estava na lista da contagem. Devolve a linha (nova ou existente). */
export async function incluirNaContagem(countId: string, itemId: string): Promise<string> {
  const { data, error } = await assertClient().rpc('stock_inventario_incluir', { p_count: countId, p_item_id: itemId })
  if (error) throw new Error(error.message)
  return String(data ?? '')
}

export async function setCountedQty(countItemId: string, countedQty: number | null): Promise<void> {
  const client = assertClient()
  const { data, error } = await client
    .from('stock_count_items')
    .update({ counted_qty: countedQty })
    .eq('id', countItemId)
    .select('id')
  if (error) throw new Error(error.message)
  // A RLS que filtra a gravação devolve sucesso com zero linhas: sem isso o número "salvo" sumia.
  if (!data || data.length === 0) throw new Error('A contagem não foi salva. Recarregue a tela e tente de novo.')
}

export async function cancelCount(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('stock_counts').update({ status: 'cancelada' }).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Finaliza no banco: cada item contado vai ao número contado no setor, comparando com o saldo
 * de AGORA (não o fotografado), para não desfazer o que entrou ou saiu durante a contagem.
 */
export async function finalizeCount(count: StockCount): Promise<{ adjusted: number }> {
  const { data, error } = await assertClient().rpc('stock_inventario_finalizar', { p_count: count.id })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { ajustados?: number }
  return { adjusted: Number(r.ajustados ?? 0) }
}
