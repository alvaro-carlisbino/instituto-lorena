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

/** `qty` é quanto levou para o setor; `usado`, quanto o setor gastou disso (baixa no estoque). */
export type StockTransferItem = { id: string; itemId: string; qty: number; usado: number }

export type StockTransfer = {
  id: string
  fromWarehouseId: string
  toWarehouseId: string
  fromName: string
  toName: string
  note: string | null
  /** Dia em que aconteceu (YYYY-MM-DD); pode ser antes do registro. */
  feitoEm: string | null
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

type LinhaDaTransferencia = { itemId: string; qty: number; usado: number }

const paraBanco = (items: LinhaDaTransferencia[]) =>
  items.map((i) => ({ item_id: i.itemId, qty: i.qty, usado: Math.min(i.usado, i.qty) }))

/**
 * Leva material de um setor para outro numa transação só (stock_transferir): sai da origem por
 * FEFO e entra no destino no mesmo lote e custo. O que o setor já gastou (`usado`) sai de lá na
 * mesma hora, no dia informado (`dia`, YYYY-MM-DD; vazio = agora).
 */
export async function createTransfer(payload: {
  fromWarehouseId: string
  toWarehouseId: string
  note?: string
  dia?: string | null
  items: LinhaDaTransferencia[]
}): Promise<{ transferId: string; movimentos: number }> {
  const items = payload.items.filter((i) => i.itemId && i.qty > 0)
  if (!payload.fromWarehouseId || !payload.toWarehouseId) throw new Error('Informe origem e destino.')
  if (payload.fromWarehouseId === payload.toWarehouseId) throw new Error('Origem e destino devem ser diferentes.')
  if (items.length === 0) throw new Error('Inclua ao menos um item.')
  const { data, error } = await assertClient().rpc('stock_transferir', {
    p_de: payload.fromWarehouseId,
    p_para: payload.toWarehouseId,
    p_itens: paraBanco(items),
    p_obs: payload.note?.trim() || null,
    p_dia: payload.dia || null,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { transfer_id?: string; movimentos?: number }
  return { transferId: String(r.transfer_id ?? ''), movimentos: Number(r.movimentos ?? 0) }
}

/**
 * Deixa cada item como a tela mandou (quanto levou, quanto usou): o banco grava só a diferença.
 * Usou mais = baixa no setor; usou menos = volta ao setor; levou menos = volta para a origem.
 * `dia` é o dia desta alteração (uso de ontem registrado hoje).
 */
export async function editarTransferencia(payload: {
  id: string
  dia?: string | null
  note?: string | null
  items: LinhaDaTransferencia[]
}): Promise<{ movimentos: number }> {
  const { data, error } = await assertClient().rpc('stock_transferencia_editar', {
    p_id: payload.id,
    p_itens: paraBanco(payload.items),
    p_dia: payload.dia || null,
    p_obs: payload.note === undefined ? null : (payload.note ?? '').trim(),
  })
  if (error) throw new Error(error.message)
  return { movimentos: Number((data as { movimentos?: number } | null)?.movimentos ?? 0) }
}

/** Devolve cada lote ao setor de onde saiu e desfaz o uso. Fica no histórico como cancelada. */
export async function cancelarTransferencia(id: string, motivo: string): Promise<void> {
  if (motivo.trim().length < 3) throw new Error('Diga o motivo do cancelamento.')
  const { error } = await assertClient().rpc('stock_transferencia_cancelar', { p_id: id, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
}

/** Uma transferência só, para a tela de editar e dar baixa. */
export async function buscarTransferencia(id: string): Promise<StockTransfer | null> {
  const [t] = await listTransfers(1, id)
  return t ?? null
}

export async function listTransfers(limite = 100, somenteId?: string): Promise<StockTransfer[]> {
  const client = assertClient()
  let consulta = client
    .from('stock_transfers')
    .select('id, from_warehouse_id, to_warehouse_id, note, feito_em, created_at, cancelled_at, cancel_reason')
  if (somenteId) consulta = consulta.eq('id', somenteId)
  const [trs, wh] = await Promise.all([
    consulta.order('created_at', { ascending: false }).limit(Math.min(limite, 1000)),
    client.from('stock_warehouses').select('id, name'),
  ])
  if (trs.error) throw new Error(trs.error.message)
  if (wh.error) throw new Error(wh.error.message)
  const ids = (trs.data ?? []).map((r) => String(r.id))
  const items =
    ids.length === 0
      ? []
      : await buscarTudo<Record<string, unknown>>(
          () => client.from('stock_transfer_items').select('id, transfer_id, item_id, qty, usado').in('transfer_id', ids).order('id'),
          { rotulo: 'stock_transfer_items' },
        )
  const nameById = new Map((wh.data ?? []).map((w) => [String(w.id), String(w.name)] as const))
  const byTr = new Map<string, StockTransferItem[]>()
  for (const r of items) {
    const key = String(r.transfer_id)
    const list = byTr.get(key) ?? []
    list.push({ id: String(r.id), itemId: String(r.item_id), qty: Number(r.qty ?? 0), usado: Number(r.usado ?? 0) })
    byTr.set(key, list)
  }
  return (trs.data ?? []).map((r) => ({
    id: String(r.id),
    fromWarehouseId: String(r.from_warehouse_id),
    toWarehouseId: String(r.to_warehouse_id),
    fromName: nameById.get(String(r.from_warehouse_id)) ?? '?',
    toName: nameById.get(String(r.to_warehouse_id)) ?? '?',
    note: r.note != null ? String(r.note) : null,
    feitoEm: r.feito_em != null ? String(r.feito_em) : null,
    createdAt: String(r.created_at ?? ''),
    cancelledAt: r.cancelled_at != null ? String(r.cancelled_at) : null,
    cancelReason: r.cancel_reason != null ? String(r.cancel_reason) : null,
    items: byTr.get(String(r.id)) ?? [],
  }))
}

export type EventoDaTransferencia = {
  id: string
  quando: string
  itemId: string
  /** Positivo entrou no setor de destino; negativo saiu dele. */
  qtd: number
  tipo: 'levou' | 'voltou' | 'usou' | 'desfez_uso' | 'cancelou'
  observacao: string | null
  autor: string | null
}

/**
 * O que aconteceu com a transferência, lido do lado do setor de destino: cada lançamento
 * (levou, usou, corrigiu, cancelou) com quem fez. Nada se apaga: corrigir é lançamento novo.
 */
export async function historicoDaTransferencia(t: Pick<StockTransfer, 'id' | 'toWarehouseId'>): Promise<EventoDaTransferencia[]> {
  const client = assertClient()
  const movs = await buscarTudo<Record<string, unknown>>(
    () =>
      client
        .from('stock_movements')
        .select('id, created_at, seq, item_id, qty_delta, reason, note, ref_type, created_by')
        .eq('ref_id', t.id)
        .eq('warehouse_id', t.toWarehouseId)
        .in('ref_type', ['stock_transfer', 'stock_uso', 'estorno'])
        .order('created_at', { ascending: false })
        .order('seq', { ascending: false }),
    { rotulo: 'movimentos da transferência' },
  )
  const autores = [...new Set(movs.map((m) => m.created_by).filter(Boolean).map(String))]
  const nomes = new Map<string, string>()
  if (autores.length > 0) {
    const { data } = await client.from('app_users').select('auth_user_id, name').in('auth_user_id', autores)
    for (const u of data ?? []) if (u.name) nomes.set(String(u.auth_user_id), String(u.name))
  }
  return movs.map((m) => {
    const qtd = Number(m.qty_delta ?? 0)
    const motivo = String(m.reason ?? '')
    const ref = String(m.ref_type ?? '')
    const tipo: EventoDaTransferencia['tipo'] =
      ref === 'stock_uso'
        ? 'usou'
        : ref === 'estorno'
          ? motivo === 'uso cancelado'
            ? 'cancelou'
            : 'desfez_uso'
          : motivo === 'transferência cancelada'
            ? 'cancelou'
            : qtd > 0
              ? 'levou'
              : 'voltou'
    return {
      id: String(m.id),
      quando: String(m.created_at ?? ''),
      itemId: String(m.item_id),
      qtd,
      tipo,
      observacao: m.note != null ? String(m.note) : null,
      autor: m.created_by ? (nomes.get(String(m.created_by)) ?? null) : null,
    }
  })
}
