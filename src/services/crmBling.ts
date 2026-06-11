import { supabase } from '@/lib/supabaseClient'

export type BlingStatus = {
  connected: boolean
  connectedAt: string | null
  accountName: string | null
}

/** Lê o status de conexão do Bling do polo ativo (sem expor tokens na UI). */
export async function fetchBlingStatus(): Promise<BlingStatus> {
  if (!supabase) return { connected: false, connectedAt: null, accountName: null }
  const { data, error } = await supabase
    .from('tenant_integrations')
    .select('bling')
    .maybeSingle()
  if (error) throw new Error(error.message)
  const bling = ((data as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
  return {
    connected: typeof bling.refresh_token === 'string' && bling.refresh_token.length > 0,
    connectedAt: typeof bling.connected_at === 'string' ? bling.connected_at : null,
    accountName: typeof bling.account_name === 'string' ? bling.account_name : null,
  }
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
