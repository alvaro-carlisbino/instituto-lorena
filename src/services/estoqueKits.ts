import { buscarTudo } from '@/lib/supabasePaginate'
import { supabase } from '@/lib/supabaseClient'
import { valorarLinhas, htmlContaDoKit } from '@/lib/contaDoKit'
import { imprimirHtml } from '@/lib/exportar'

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
  const data = await buscarTudo<Record<string, unknown>>(() => {
    let query = client
      .from('stock_batch_balances')
      .select('batch_id, item_id, lot_code, expires_on, qty')
      .order('batch_id')
    if (itemId) query = query.eq('item_id', itemId)
    return query
  }, { rotulo: 'stock_batch_balances' })
  return data.map((r) => ({
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
  // Uma linha por item: passou de 1.000 e o teto do PostgREST deixava item sem custo no relatório.
  const data = await buscarTudo<{ item_id: unknown; unit_cost_cents: unknown }>(
    () => client.from('stock_item_last_costs').select('item_id, unit_cost_cents').order('item_id'),
    { rotulo: 'stock_item_last_costs' },
  )
  const map = new Map<string, number>()
  for (const r of data) map.set(String(r.item_id), Number(r.unit_cost_cents ?? 0))
  return map
}

/** Custo real por lote (custo da entrada valorada do lote). */
export async function listBatchCosts(): Promise<Map<string, number>> {
  const client = assertClient()
  const data = await buscarTudo<{ batch_id: unknown; unit_cost_cents: unknown }>(
    () => client.from('stock_batch_costs').select('batch_id, unit_cost_cents').order('batch_id'),
    { rotulo: 'stock_batch_costs' },
  )
  const map = new Map<string, number>()
  for (const r of data) map.set(String(r.batch_id), Number(r.unit_cost_cents ?? 0))
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
export type StockKitItem = {
  id: string
  itemId: string
  qty: number
  /** Quanto desta linha voltou para o estoque (sobra da bandeja). Usado = qty - returnedQty. */
  returnedQty: number
  isExtra: boolean
  chargeCents: number
  label: string | null
}
export type StockKit = {
  id: string
  name: string
  templateId: string | null
  leadId: string | null
  /** Venda (clinic_sales) a que o kit pertence: é o elo com o valor da cirurgia. */
  clinicSaleId: string | null
  patientName: string | null
  procedureLabel: string | null
  scheduledFor: string | null
  status: KitStatus
  note: string | null
  createdAt: string
  consumedAt: string | null
  cancelledAt: string | null
  items: StockKitItem[]
}

const COLUNAS_KIT =
  'id, name, template_id, lead_id, clinic_sale_id, patient_name, procedure_label, scheduled_for, status, note, created_at, consumed_at, cancelled_at'

/** Junta os kits com as linhas deles. Só as linhas destes kits, paginadas. */
async function comLinhas(kits: Array<Record<string, unknown>>): Promise<StockKit[]> {
  const client = assertClient()
  const kitIds = kits.map((r) => String(r.id))
  // Antes vinha a tabela inteira: um Kit Cirúrgico CC tem 90 linhas, e no 12º kit o teto de
  // 1.000 do PostgREST começava a esconder item de kit antigo.
  const linhas = kitIds.length
    ? await buscarTudo<Record<string, unknown>>(
        () =>
          client
            .from('stock_kit_items')
            .select('id, kit_id, item_id, qty, returned_qty, is_extra, charge_cents, label, created_at')
            .in('kit_id', kitIds)
            .order('created_at')
            .order('id'),
        { rotulo: 'stock_kit_items' },
      )
    : []
  const byKit = new Map<string, StockKitItem[]>()
  for (const r of linhas) {
    const key = String(r.kit_id)
    const list = byKit.get(key) ?? []
    list.push({
      id: String(r.id),
      itemId: String(r.item_id),
      qty: Number(r.qty ?? 0),
      returnedQty: Number(r.returned_qty ?? 0),
      isExtra: Boolean(r.is_extra),
      chargeCents: Number(r.charge_cents ?? 0),
      label: r.label != null ? String(r.label) : null,
    })
    byKit.set(key, list)
  }
  return kits.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    templateId: r.template_id != null ? String(r.template_id) : null,
    leadId: r.lead_id != null ? String(r.lead_id) : null,
    clinicSaleId: r.clinic_sale_id != null ? String(r.clinic_sale_id) : null,
    patientName: r.patient_name != null ? String(r.patient_name) : null,
    procedureLabel: r.procedure_label != null ? String(r.procedure_label) : null,
    scheduledFor: r.scheduled_for != null ? String(r.scheduled_for) : null,
    status: (r.status === 'consumido' || r.status === 'cancelado' ? r.status : 'montado') as KitStatus,
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at ?? ''),
    consumedAt: r.consumed_at != null ? String(r.consumed_at) : null,
    cancelledAt: r.cancelled_at != null ? String(r.cancelled_at) : null,
    items: byKit.get(String(r.id)) ?? [],
  }))
}

export async function listKits(leadId?: string): Promise<StockKit[]> {
  const client = assertClient()
  let kitsQuery = client.from('stock_kits').select(COLUNAS_KIT).order('created_at', { ascending: false })
  kitsQuery = leadId ? kitsQuery.eq('lead_id', leadId) : kitsQuery.limit(100)
  const kits = await kitsQuery
  if (kits.error) throw new Error(kits.error.message)
  return comLinhas((kits.data ?? []) as Array<Record<string, unknown>>)
}

/** Um kit só, para as telas de registrar uso e editar. null = não existe ou é de outro polo. */
export async function buscarKit(kitId: string): Promise<StockKit | null> {
  const { data, error } = await assertClient().from('stock_kits').select(COLUNAS_KIT).eq('id', kitId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const [kit] = await comLinhas([data as Record<string, unknown>])
  return kit ?? null
}

/**
 * Monta o kit do paciente E JÁ BAIXA o material do estoque (decisão da operação, 16/jul):
 * quem monta a bandeja é quem tira o material da prateleira, então é nesse instante que o
 * estoque some de verdade. Um momento, uma pessoa — é o que a equipe sustenta no dia a dia.
 *
 * Baixa por FEFO (vence primeiro sai primeiro) e registra controlados no livro. Depois disso:
 *   • "consumido" = a enfermeira registra o uso; a sobra da bandeja volta por devolverSobraKit
 *   • "cancelado" = cirurgia caiu ou kit errado → cancelKit estorna o que ainda está fora
 *
 * Tudo numa chamada (stock_kit_montar). A baixa pelo navegador ia item por item, e um Kit
 * Cirúrgico CC de 90 linhas levava 38 s para salvar; no banco leva menos de 1 s, e uma falha
 * no meio não deixa kit meio baixado.
 */
export async function createKit(payload: {
  templateId?: string | null
  name: string
  leadId?: string | null
  clinicSaleId?: string | null
  patientName?: string
  procedureLabel?: string
  scheduledFor?: string | null
  items: Array<{
    itemId: string
    qty: number
    isExtra?: boolean
    chargeCents?: number
    label?: string | null
  }>
}): Promise<{ kitId: string; movements: number; controlled: number }> {
  const client = assertClient()
  const items = payload.items.filter((i) => i.itemId && i.qty > 0)
  if (items.length === 0) throw new Error('O kit precisa de ao menos um item.')
  const { data, error } = await client.rpc('stock_kit_montar', {
    p_kit: {
      template_id: payload.templateId || null,
      name: payload.name.trim() || 'Kit',
      lead_id: payload.leadId || null,
      clinic_sale_id: payload.clinicSaleId || null,
      patient_name: payload.patientName?.trim() || null,
      procedure_label: payload.procedureLabel?.trim() || null,
      scheduled_for: payload.scheduledFor || null,
    },
    p_itens: items.map((i) => ({
      item_id: i.itemId,
      qty: i.qty,
      is_extra: Boolean(i.isExtra),
      charge_cents: Math.max(0, Math.round(i.chargeCents ?? 0)),
      label: i.label?.trim() || null,
    })),
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { kit_id?: string; movimentos?: number; controlados?: number }
  return { kitId: String(r.kit_id ?? ''), movements: Number(r.movimentos ?? 0), controlled: Number(r.controlados ?? 0) }
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
 * Registra o uso do kit e devolve a sobra da bandeja ao estoque.
 *
 * `devolucoes` é por LINHA do kit (o mesmo produto pode estar no modelo e como avulso). A
 * função do banco devolve para os lotes de onde saiu, grava o livro de controlados e soma
 * em `returned_qty`, tudo numa transação. Com `fechar`, o kit montado passa a "consumido".
 * Kit já consumido aceita devolução depois (a caixa voltou no dia seguinte).
 */
export async function devolverSobraKit(
  kitId: string,
  devolucoes: Array<{ kitItemId: string; qty: number }>,
  fechar = true,
): Promise<{ movimentos: number; unidades: number; controlados: number }> {
  const client = assertClient()
  const { data, error } = await client.rpc('stock_kit_devolver', {
    p_kit_id: kitId,
    p_devolucoes: devolucoes
      .filter((d) => d.qty > 0)
      .map((d) => ({ kit_item_id: d.kitItemId, qty: d.qty })),
    p_fechar: fechar,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { movimentos?: number; unidades?: number; controlados?: number }
  return { movimentos: Number(r.movimentos ?? 0), unidades: Number(r.unidades ?? 0), controlados: Number(r.controlados ?? 0) }
}

/**
 * Registrar (ou corrigir) uso numa transação: o que voltou segue por stock_kit_devolver; a
 * devolução marcada por engano se desfaz (a unidade sai de novo); uso além do que saiu baixa a
 * diferença e sobe a quantidade. `fechar` passa o kit montado a usado.
 */
export async function registrarUsoKit(
  kitId: string,
  linhas: Array<{ kitItemId: string; voltou: number; desfazer?: number; aMais: number }>,
  fechar = true,
): Promise<{ movimentos: number; unidades: number; controlados: number; aMais: number; desfeito: number }> {
  const client = assertClient()
  const { data, error } = await client.rpc('stock_kit_registrar_uso', {
    p_kit_id: kitId,
    p_linhas: linhas
      .filter((l) => l.voltou > 0 || (l.desfazer ?? 0) > 0 || l.aMais > 0)
      .map((l) => ({ kit_item_id: l.kitItemId, voltou: l.voltou, desfazer: l.desfazer ?? 0, a_mais: l.aMais })),
    p_fechar: fechar,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { movimentos?: number; unidades?: number; controlados?: number; a_mais?: number; desfeito?: number }
  return {
    movimentos: Number(r.movimentos ?? 0),
    unidades: Number(r.unidades ?? 0),
    controlados: Number(r.controlados ?? 0),
    aMais: Number(r.a_mais ?? 0),
    desfeito: Number(r.desfeito ?? 0),
  }
}

/**
 * Muda o TOTAL que voltou de uma linha (sobra da bandeja), para mais ou para menos, sem fechar o
 * kit. A diferença sai do banco na hora de gravar, não da tela: com dois toques e uma gravação no
 * meio, a tela ainda teria o valor antigo e aplicaria a diferença duas vezes.
 */
export async function alterarVoltouLinhaKit(kitId: string, kitItemId: string, voltouTotal: number) {
  const { data, error } = await assertClient().from('stock_kit_items').select('returned_qty').eq('id', kitItemId).single()
  if (error) throw new Error(error.message)
  const dif = voltouTotal - Number((data as { returned_qty: unknown }).returned_qty ?? 0)
  if (dif === 0) return
  await registrarUsoKit(kitId, [{ kitItemId, voltou: Math.max(0, dif), desfazer: Math.max(0, -dif), aMais: 0 }], false)
}

/** Confirma o uso sem sobra. Mantido para quem só quer o carimbo. */
export async function consumeKit(kit: StockKit): Promise<void> {
  await devolverSobraKit(kit.id, [], true)
}

/**
 * Cancela o kit, montado ou já usado, e devolve ao estoque tudo que ainda está fora (saída
 * menos o que já voltou por sobra), lote a lote e com o livro de controlados. Antes só dava
 * para cancelar kit montado, e o estorno não passava pelo livro.
 */
export async function cancelKit(kit: StockKit): Promise<{ restored: number }> {
  const client = assertClient()
  const { data, error } = await client.rpc('stock_kit_cancelar', { p_kit_id: kit.id })
  if (error) throw new Error(error.message)
  return { restored: Number((data as { movimentos?: number } | null)?.movimentos ?? 0) }
}

// ------------------------------------------------------------ editar kit montado
// Cada ação mexe no estoque na hora, pelas funções do banco (FEFO, custo do lote, livro de
// controlados, tudo numa transação). A tela não calcula baixa nenhuma.

const rpcKit = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await assertClient().rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

/** Põe um item no kit (a cirurgia pediu mais). Baixa na hora. */
export async function adicionarItemKit(payload: {
  kitId: string
  itemId: string
  qty: number
  avulso?: boolean
  cobrancaCents?: number
}): Promise<string> {
  return String(
    await rpcKit('stock_kit_adicionar_item', {
      p_kit_id: payload.kitId,
      p_item_id: payload.itemId,
      p_qty: payload.qty,
      p_avulso: payload.avulso ?? true,
      p_cobranca_cents: Math.max(0, Math.round(payload.cobrancaCents ?? 0)),
    }),
  )
}

/** Muda quantidade (baixa ou devolve a diferença), cobrança e avulso de uma linha. */
export async function alterarLinhaKit(payload: {
  kitItemId: string
  qty: number
  cobrancaCents?: number | null
  avulso?: boolean | null
}): Promise<void> {
  await rpcKit('stock_kit_alterar_linha', {
    p_kit_item_id: payload.kitItemId,
    p_qty: payload.qty,
    p_cobranca_cents: payload.cobrancaCents == null ? null : Math.max(0, Math.round(payload.cobrancaCents)),
    p_avulso: payload.avulso ?? null,
  })
}

/** Tira a linha do kit; o que ainda estava fora volta ao estoque. */
export async function removerLinhaKit(kitItemId: string): Promise<void> {
  await rpcKit('stock_kit_remover_linha', { p_kit_item_id: kitItemId })
}

/** Exclui o kit lançado errado: devolve o que estiver fora e apaga o registro. */
export async function excluirKit(kitId: string): Promise<void> {
  await rpcKit('stock_kit_excluir', { p_kit_id: kitId })
}

/** Paciente, procedimento e data do kit. Não mexe no estoque. */
export async function atualizarKit(payload: {
  id: string
  leadId: string | null
  clinicSaleId?: string | null
  patientName: string | null
  procedureLabel: string | null
  scheduledFor: string | null
}): Promise<void> {
  const { error } = await assertClient()
    .from('stock_kits')
    .update({
      ...(payload.clinicSaleId !== undefined ? { clinic_sale_id: payload.clinicSaleId } : {}),
      lead_id: payload.leadId,
      patient_name: payload.patientName?.trim() || null,
      procedure_label: payload.procedureLabel?.trim() || null,
      scheduled_for: payload.scheduledFor || null,
    })
    .eq('id', payload.id)
  if (error) throw new Error(error.message)
}

/** Troca nome e itens do modelo. Kits já montados guardam as próprias linhas e não mudam. */
export async function updateKitTemplate(payload: {
  id: string
  name: string
  items: Array<{ itemId: string; qty: number }>
}): Promise<void> {
  const client = assertClient()
  const items = payload.items.filter((i) => i.itemId && i.qty > 0)
  if (payload.name.trim().length < 2) throw new Error('Informe o nome do modelo.')
  if (items.length === 0) throw new Error('O modelo precisa de ao menos um item.')
  const { data: antigos, error: readErr } = await client
    .from('kit_template_items')
    .select('item_id, qty')
    .eq('template_id', payload.id)
  if (readErr) throw new Error(readErr.message)
  const { error } = await client
    .from('kit_templates')
    .update({ name: payload.name.trim(), updated_at: new Date().toISOString() })
    .eq('id', payload.id)
  if (error) throw new Error(error.message)
  const { error: delErr } = await client.from('kit_template_items').delete().eq('template_id', payload.id)
  if (delErr) throw new Error(delErr.message)
  const { error: insErr } = await client
    .from('kit_template_items')
    .insert(items.map((i) => ({ template_id: payload.id, item_id: i.itemId, qty: i.qty })))
  if (insErr) {
    // Sem as linhas o modelo ficaria vazio: recoloca as de antes.
    await client
      .from('kit_template_items')
      .insert((antigos ?? []).map((a) => ({ template_id: payload.id, item_id: a.item_id, qty: a.qty })))
    throw new Error(insErr.message)
  }
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

/**
 * Conta do paciente em PDF (pela impressão do navegador): itens usados com valor, cobrança
 * quando houver. O valor vem dos movimentos do próprio kit, a custo da baixa.
 */
export async function imprimirContaDoKit(
  kit: StockKit,
  itens: Map<string, { name: string; controlled: boolean }>,
  ultimoCusto: Map<string, number>,
): Promise<void> {
  const movs = await buscarTudo<{ item_id: unknown; qty_delta: unknown; unit_cost_cents: unknown }>(
    () =>
      assertClient()
        .from('stock_movements')
        .select('item_id, qty_delta, unit_cost_cents')
        .eq('ref_type', 'stock_kit')
        .eq('ref_id', kit.id)
        .order('id'),
    { rotulo: 'stock_movements do kit' },
  )
  const linhas = valorarLinhas(
    kit.items.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      nome: l.label || itens.get(l.itemId)?.name || 'Item',
      qty: l.qty,
      returnedQty: l.returnedQty,
      avulso: l.isExtra,
      controlado: Boolean(itens.get(l.itemId)?.controlled),
      cobrancaCents: l.chargeCents,
    })),
    movs.map((m) => ({
      itemId: String(m.item_id),
      qtyDelta: Number(m.qty_delta ?? 0),
      custoCents: m.unit_cost_cents == null ? null : Number(m.unit_cost_cents),
    })),
    ultimoCusto,
  )
  const { html } = htmlContaDoKit({
    paciente: kit.patientName,
    procedimento: kit.procedureLabel,
    data: kit.scheduledFor ?? kit.createdAt.slice(0, 10),
    kitNome: kit.name,
    status: kit.status,
    linhas,
  })
  imprimirHtml(html)
}
