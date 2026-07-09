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

export type BlingOrderConfig = { defaultContatoId: string; autoOrderEnabled: boolean }

export async function getBlingOrderConfig(): Promise<BlingOrderConfig> {
  const p = await invokeBling({ action: 'get_order_config' })
  return {
    defaultContatoId: String(p.default_contato_id ?? ''),
    autoOrderEnabled: p.auto_order_enabled === true,
  }
}

export async function setBlingOrderConfig(patch: { defaultContatoId?: string; autoOrderEnabled?: boolean }): Promise<void> {
  const body: Record<string, unknown> = { action: 'set_order_config' }
  if (patch.defaultContatoId !== undefined) body.default_contato_id = patch.defaultContatoId
  if (patch.autoOrderEnabled !== undefined) body.auto_order_enabled = patch.autoOrderEnabled
  await invokeBling(body)
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
