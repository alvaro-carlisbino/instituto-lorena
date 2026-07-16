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

// ------------------------------------------------------------------- custos

/** Último custo de compra conhecido por item (entradas valoradas + linhas de OC). */
export async function listItemLastCosts(): Promise<Map<string, number>> {
  const client = assertClient()
  const { data, error } = await client
    .from('stock_item_last_costs')
    .select('item_id, unit_cost_cents')
  if (error) throw new Error(error.message)
  const map = new Map<string, number>()
  for (const r of data ?? []) map.set(String(r.item_id), Number(r.unit_cost_cents ?? 0))
  return map
}

/** Custo real por lote (custo da entrada valorada do lote). */
export async function listBatchCosts(): Promise<Map<string, number>> {
  const client = assertClient()
  const { data, error } = await client
    .from('stock_batch_costs')
    .select('batch_id, unit_cost_cents')
  if (error) throw new Error(error.message)
  const map = new Map<string, number>()
  for (const r of data ?? []) map.set(String(r.batch_id), Number(r.unit_cost_cents ?? 0))
  return map
}

export type KitCost = { kitId: string; totalCostCents: number; fullyCosted: boolean }

/** Custo em materiais dos kits consumidos. fullyCosted=false ⇒ total parcial (item sem custo). */
export async function listKitCosts(leadId?: string): Promise<Map<string, KitCost>> {
  const client = assertClient()
  let query = client.from('stock_kit_costs').select('kit_id, lead_id, total_cost_cents, fully_costed')
  if (leadId) query = query.eq('lead_id', leadId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const map = new Map<string, KitCost>()
  for (const r of data ?? []) {
    map.set(String(r.kit_id), {
      kitId: String(r.kit_id),
      totalCostCents: Number(r.total_cost_cents ?? 0),
      fullyCosted: Boolean(r.fully_costed),
    })
  }
  return map
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

export async function listKits(leadId?: string): Promise<StockKit[]> {
  const client = assertClient()
  let kitsQuery = client
    .from('stock_kits')
    .select('id, name, template_id, lead_id, patient_name, procedure_label, scheduled_for, status, note, created_at, consumed_at')
    .order('created_at', { ascending: false })
  kitsQuery = leadId ? kitsQuery.eq('lead_id', leadId) : kitsQuery.limit(100)
  const [kits, items] = await Promise.all([
    kitsQuery,
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

/**
 * Monta o kit do paciente E JÁ BAIXA o material do estoque (decisão da operação, 16/jul):
 * quem monta a bandeja é quem tira o material da prateleira, então é nesse instante que o
 * estoque some de verdade. Um momento, uma pessoa — é o que a equipe sustenta no dia a dia.
 *
 * Baixa por FEFO (vence primeiro sai primeiro) e registra controlados no livro, igual à
 * conferência fazia antes. Depois disso:
 *   • "consumido" = a enfermeira confirma que usou (NÃO mexe no estoque de novo)
 *   • "cancelado" = cirurgia caiu → cancelKit ESTORNA tudo pro estoque
 * Sobra de bandeja volta por ajuste manual, que é o caso raro.
 */
export async function createKit(payload: {
  templateId?: string | null
  name: string
  leadId?: string | null
  patientName?: string
  procedureLabel?: string
  scheduledFor?: string | null
  items: Array<{ itemId: string; qty: number }>
  /** ids dos itens controlados — vão pro livro na baixa (Portaria 344). */
  controlledItemIds?: Set<string>
}): Promise<{ kitId: string; movements: number; controlled: number }> {
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

  // Baixa o material. Se falhar no meio, o kit fica registrado e a tela avisa — não apagamos
  // o kit, senão perderíamos o rastro das baixas que já saíram.
  const out = await deductKitStock(
    { id: kitId, name: payload.name.trim() || 'Kit', patientName: payload.patientName?.trim() || null, procedureLabel: payload.procedureLabel?.trim() || null, items },
    payload.controlledItemIds ?? new Set<string>(),
    'kit montado',
  )
  return { kitId, ...out }
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
 * Baixa o material de um kit: FEFO por item + livro de controlados. Usada na MONTAGEM
 * (createKit) — é o único ponto que tira material do estoque.
 */
async function deductKitStock(
  kit: { id: string; name: string; patientName: string | null; procedureLabel: string | null; items: Array<{ itemId: string; qty: number }> },
  controlledItemIds: Set<string>,
  reason: string,
): Promise<{ movements: number; controlled: number }> {
  const client = assertClient()
  // Valoração da saída: custo real do lote; sem lote (ou lote sem custo),
  // último custo de compra do item. null = fica sem custo (total vira "parcial").
  const [batchCosts, lastCosts] = await Promise.all([listBatchCosts(), listItemLastCosts()])
  let movements = 0
  let controlled = 0
  for (const item of kit.items) {
    const batches = await listBatchBalances(item.itemId)
    const allocation = allocateFefo(batches, item.qty)
    for (const slice of allocation) {
      const unitCostCents =
        (slice.batchId ? batchCosts.get(slice.batchId) : undefined) ??
        lastCosts.get(item.itemId) ??
        null
      const movementId = await registerMovement({
        itemId: item.itemId,
        kind: 'saida',
        qty: slice.qty,
        reason,
        note: `${kit.name}${kit.patientName ? ` — ${kit.patientName}` : ''}`,
        refType: 'stock_kit',
        refId: kit.id,
        batchId: slice.batchId,
        unitCostCents,
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
  return { movements, controlled }
}

/**
 * Conferência da enfermeira: confirma que o kit foi usado no paciente. NÃO mexe no estoque —
 * o material já saiu na montagem (createKit). É o carimbo de "cirurgia aconteceu", que fecha
 * o custo do procedimento e serve de trilha pra auditoria.
 */
export async function consumeKit(kit: StockKit): Promise<void> {
  const client = assertClient()
  const { error } = await client
    .from('stock_kits')
    .update({ status: 'consumido', consumed_at: new Date().toISOString() })
    .eq('id', kit.id)
  if (error) throw new Error(error.message)
}

/**
 * Cancela o kit e ESTORNA o material pro estoque (entrada de volta), porque a baixa
 * aconteceu lá na montagem. Sem isso, cirurgia cancelada sumiria com o material pra sempre.
 * Idempotente na prática: a tela só oferece cancelar kit 'montado'.
 */
export async function cancelKit(kit: StockKit): Promise<{ restored: number }> {
  const client = assertClient()
  const lastCosts = await listItemLastCosts()
  let restored = 0
  // Devolve exatamente o que saiu, lote a lote (o movimento de saída guarda o batch_id).
  // A coluna é qty_delta e vem NEGATIVA na saída — registerMovement quer qty positivo.
  const { data: movs } = await client
    .from('stock_movements')
    .select('item_id, qty_delta, batch_id, unit_cost_cents')
    .eq('ref_type', 'stock_kit')
    .eq('ref_id', kit.id)
    .eq('kind', 'saida')
  for (const m of ((movs ?? []) as Array<{ item_id: string; qty_delta: number; batch_id: string | null; unit_cost_cents: number | null }>)) {
    await registerMovement({
      itemId: String(m.item_id),
      kind: 'entrada',
      qty: Math.abs(Number(m.qty_delta)),
      reason: 'kit cancelado (estorno)',
      note: `${kit.name}${kit.patientName ? ` — ${kit.patientName}` : ''}`,
      refType: 'stock_kit',
      refId: kit.id,
      batchId: m.batch_id,
      unitCostCents: m.unit_cost_cents ?? lastCosts.get(String(m.item_id)) ?? null,
    })
    restored += 1
  }
  const { error } = await client.from('stock_kits').update({ status: 'cancelado' }).eq('id', kit.id)
  if (error) throw new Error(error.message)
  return { restored }
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

/** Saída de controlado fora de kit (ex.: bipagem) — mesmo livro do consumeKit. */
export async function logControlledExit(payload: {
  itemId: string
  batchId?: string | null
  movementId?: string | null
  qty: number
  patientName?: string | null
  note?: string | null
}): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('controlled_substance_log').insert({
    item_id: payload.itemId,
    batch_id: payload.batchId ?? null,
    movement_id: payload.movementId ?? null,
    action: 'saida',
    qty: payload.qty,
    patient_name: payload.patientName?.trim() || null,
    note: payload.note?.trim() || null,
  })
  if (error) throw new Error(error.message)
}
