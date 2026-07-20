import { supabase } from '@/lib/supabaseClient'

export type BlingStatus = {
  connected: boolean
  connectedAt: string | null
  accountName: string | null
}

/** Lê o status de conexão do Bling do polo ativo (sem expor tokens na UI). */
export async function fetchBlingStatus(): Promise<BlingStatus> {
  const empty: BlingStatus = { connected: false, connectedAt: null, accountName: null }
  if (!supabase) return empty
  // Filtra pelo polo ativo — admins enxergam mais de uma linha de tenant_integrations,
  // e sem o filtro o maybeSingle() quebra (várias linhas).
  const { data: tid } = await supabase.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return empty
  const { data, error } = await supabase
    .from('tenant_integrations')
    .select('bling')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const bling = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
  return {
    connected: typeof bling.refresh_token === 'string' && bling.refresh_token.length > 0,
    connectedAt: typeof bling.connected_at === 'string' ? bling.connected_at : null,
    accountName: typeof bling.account_name === 'string' ? bling.account_name : null,
  }
}

export type BlingCatalogItem = {
  id: string
  nome: string
  codigo: string
  preco: number
  estoque: number | null
  /** EAN/GTIN — usado p/ casar item da NF-e ao produto do Bling. */
  gtin?: string
}

/** Espelha no Bling uma entrada de estoque (compra/NF-e) para um produto vinculado. */
export async function pushBlingStockEntry(args: {
  blingProductId: string
  qty: number
  unitCostCents?: number
  note?: string
}): Promise<{ movementId: string | null }> {
  const p = await invokeBling({
    action: 'stock_entry',
    blingProductId: args.blingProductId,
    qty: args.qty,
    ...(args.unitCostCents ? { unitCostCents: args.unitCostCents } : {}),
    ...(args.note ? { note: args.note } : {}),
  })
  return { movementId: p.movementId != null ? String(p.movementId) : null }
}

/** Lista o catálogo do Bling do polo ativo (com opção de forçar atualização). */
export async function fetchBlingCatalog(refresh = false): Promise<{ items: BlingCatalogItem[]; fetchedAt: string | null }> {
  if (!supabase) return { items: [], fetchedAt: null }
  const { data, error } = await supabase.functions.invoke('crm-bling', {
    body: { action: 'list_products', refresh },
  })
  if (error) {
    const ctx = (error as { context?: { body?: unknown } }).context
    const msg = ctx && typeof ctx.body === 'string' ? ctx.body : error.message
    throw new Error(String(msg || 'Falha ao listar catálogo'))
  }
  const p = (data ?? {}) as { ok?: boolean; items?: BlingCatalogItem[]; fetchedAt?: string; message?: string }
  if (!p.ok) throw new Error(String(p.message || 'Falha ao listar catálogo'))
  return { items: Array.isArray(p.items) ? p.items : [], fetchedAt: p.fetchedAt ?? null }
}

async function invokeBling(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.functions.invoke('crm-bling', { body })
  if (error) {
    const ctx = (error as { context?: { body?: unknown } }).context
    const msg = ctx && typeof ctx.body === 'string' ? ctx.body : error.message
    throw new Error(String(msg || 'Falha na operação Bling'))
  }
  const p = (data ?? {}) as Record<string, unknown>
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha na operação Bling'))
  return p
}

export type BlingOrderConfig = {
  defaultContatoId: string
  autoOrderEnabled: boolean
  naturezaOperacaoId: string
  autoNfeTransmit: boolean
}

export async function getBlingOrderConfig(): Promise<BlingOrderConfig> {
  const p = await invokeBling({ action: 'get_order_config' })
  return {
    defaultContatoId: String(p.default_contato_id ?? ''),
    autoOrderEnabled: p.auto_order_enabled === true,
    naturezaOperacaoId: String(p.natureza_operacao_id ?? ''),
    autoNfeTransmit: p.auto_nfe_transmit === true,
  }
}

export async function setBlingOrderConfig(patch: {
  defaultContatoId?: string; autoOrderEnabled?: boolean; naturezaOperacaoId?: string; autoNfeTransmit?: boolean
}): Promise<void> {
  const body: Record<string, unknown> = { action: 'set_order_config' }
  if (patch.defaultContatoId !== undefined) body.default_contato_id = patch.defaultContatoId
  if (patch.autoOrderEnabled !== undefined) body.auto_order_enabled = patch.autoOrderEnabled
  if (patch.naturezaOperacaoId !== undefined) body.natureza_operacao_id = patch.naturezaOperacaoId
  if (patch.autoNfeTransmit !== undefined) body.auto_nfe_transmit = patch.autoNfeTransmit
  await invokeBling(body)
}

// ---- NF-e em lote --------------------------------------------------------
export type NfeRow = {
  paymentId: string
  leadId: string
  name: string
  cpf: string
  valueCents: number
  method: string
  paidAt: string | null
  blingOrderId: string
  nfeStatus: string | null
  nfeNumero: string | null
  nfeError: string | null
}

/** Vendas pagas com pedido no Bling num intervalo (pós-conciliação) + estado da NF-e. */
export async function nfeList(from: string, to: string): Promise<NfeRow[]> {
  const p = await invokeBling({ action: 'nfe_list', from, to })
  return Array.isArray(p.items) ? (p.items as NfeRow[]) : []
}

// Linha da listagem por PEDIDO do Bling (inclui pedidos criados fora do CRM: manual/marketplace).
export type NfeOrderRow = {
  orderId: string
  orderNumero: string
  date: string
  name: string
  cpf: string
  valueCents: number
  canceled: boolean
  nfeStatus: string | null
  nfeNumero: string | null
  nfeError: string | null
}

/** TODOS os pedidos de venda do Bling no período (data do pedido) + estado da NF-e. */
export async function nfeListBling(from: string, to: string): Promise<NfeOrderRow[]> {
  const p = await invokeBling({ action: 'nfe_list_bling', from, to })
  return Array.isArray(p.items) ? (p.items as NfeOrderRow[]) : []
}

export type NfeEmitResult = {
  ok: boolean
  numero?: string | null
  status?: string
  alreadyEmitted?: boolean
  message?: string
}

/** Emite a NF-e de UMA venda (a tela chama em lote, uma por vez). Não lança em erro de
 *  negócio (SEFAZ/CPF/natureza) — devolve ok:false + message pra mostrar por linha. */
export async function nfeEmit(paymentId: string, transmit?: boolean): Promise<NfeEmitResult> {
  if (!supabase) return { ok: false, message: 'Sistema não configurado.' }
  const body: Record<string, unknown> = { action: 'nfe_emit', paymentId }
  if (transmit !== undefined) body.transmit = transmit
  const { data, error } = await supabase.functions.invoke('crm-bling', { body })
  if (error) {
    const ctx = (error as { context?: { body?: unknown } }).context
    const msg = ctx && typeof ctx.body === 'string' ? ctx.body : error.message
    return { ok: false, message: String(msg || 'Falha ao emitir NF-e') }
  }
  const p = (data ?? {}) as Record<string, unknown>
  return {
    ok: p.ok === true,
    numero: p.numero != null ? String(p.numero) : null,
    status: p.status != null ? String(p.status) : undefined,
    alreadyEmitted: p.alreadyEmitted === true,
    message: p.message != null ? String(p.message) : (p.error != null ? String(p.error) : undefined),
  }
}

/** Emite a NF-e de UM pedido do Bling pelo id do pedido (não exige venda no CRM). */
export async function nfeEmitOrder(orderId: string, transmit?: boolean): Promise<NfeEmitResult> {
  if (!supabase) return { ok: false, message: 'Sistema não configurado.' }
  const body: Record<string, unknown> = { action: 'nfe_emit_order', orderId }
  if (transmit !== undefined) body.transmit = transmit
  const { data, error } = await supabase.functions.invoke('crm-bling', { body })
  if (error) {
    const ctx = (error as { context?: { body?: unknown } }).context
    const msg = ctx && typeof ctx.body === 'string' ? ctx.body : error.message
    return { ok: false, message: String(msg || 'Falha ao emitir NF-e') }
  }
  const p = (data ?? {}) as Record<string, unknown>
  return {
    ok: p.ok === true,
    numero: p.numero != null ? String(p.numero) : null,
    status: p.status != null ? String(p.status) : undefined,
    alreadyEmitted: p.alreadyEmitted === true,
    message: p.message != null ? String(p.message) : (p.error != null ? String(p.error) : undefined),
  }
}

export async function createBlingTestOrder(kit: string): Promise<{ orderId: string | null; bottles: number }> {
  const p = await invokeBling({ action: 'create_test_order', kit })
  return { orderId: p.orderId != null ? String(p.orderId) : null, bottles: Number(p.bottles ?? 0) }
}

/** Relança no Bling uma venda PAGA que não entrou (lead de outro canal, bug, etc.). */
export async function retryBlingOrder(leadId: string, kit?: string): Promise<{ orderId: string | null; bottles: number }> {
  const p = await invokeBling({ action: 'retry_bling', leadId, ...(kit ? { kit } : {}) })
  return { orderId: p.orderId != null ? String(p.orderId) : null, bottles: Number(p.bottles ?? 0) }
}

/** Cria/atualiza o contato do cliente no Bling a partir do cadastro/endereço do lead
 *  e, se houver pedido vinculado, corrige o contato dele. */
export async function syncLeadContato(leadId: string): Promise<{ contatoId: string | null; orderUpdated: boolean }> {
  const p = await invokeBling({ action: 'sync_contato', leadId })
  return { contatoId: p.contatoId != null ? String(p.contatoId) : null, orderUpdated: p.orderUpdated === true }
}

/** Inicia o OAuth: pede a URL de autorização do Bling e redireciona o navegador. */
export async function startBlingConnect(returnUrl: string): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.functions.invoke('crm-bling-oauth', {
    body: { action: 'authorize_url', returnUrl },
  })
  if (error) {
    const ctx = (error as { context?: { body?: unknown } }).context
    const msg = ctx && typeof ctx.body === 'string' ? ctx.body : error.message
    throw new Error(String(msg || 'Falha ao iniciar conexão Bling'))
  }
  const p = (data ?? {}) as { ok?: boolean; authorizeUrl?: string; error?: string }
  if (!p.ok || !p.authorizeUrl) throw new Error(String(p.error || 'Falha ao iniciar conexão Bling'))
  window.location.assign(p.authorizeUrl)
}

/** Desconecta o Bling (limpa os tokens do polo). */
export async function disconnectBling(): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data: tid } = await supabase.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid : ''
  if (!tenantId) throw new Error('Polo não resolvido.')
  const { error } = await supabase
    .from('tenant_integrations')
    .update({ bling: {} })
    .eq('tenant_id', tenantId)
  if (error) throw new Error(error.message)
}
