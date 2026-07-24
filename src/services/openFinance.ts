import { supabase } from '@/lib/supabaseClient'

// Cliente do front pra edge crm-openfinance (Open Finance / Pluggy). As credenciais Pluggy
// ficam no backend; aqui a gente só pede o token do widget, e manda o itemId que o widget
// devolve pra ligar as contas e sincronizar as transações no razão de caixa.
// Também fala com crm-banco-mcp (Banco MCP / api.mcp.ai) quando a conexão vem por lá.

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

async function invoke<T>(fn: string, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const client = assertClient()
  const { data, error } = await client.functions.invoke(fn, { body: { action, ...body } })
  if (error) throw new Error(error.message)
  if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
    throw new Error(String((data as { message?: string; error?: string }).message ?? (data as { error?: string }).error))
  }
  return data as T
}

/** Token efêmero que o widget do Pluggy Connect usa. itemId presente = modo atualizar conexão. */
export async function getConnectToken(itemId?: string): Promise<string> {
  const { token } = await invoke<{ token: string }>('crm-openfinance', 'connect_token', itemId ? { itemId } : {})
  return token
}

/** Depois que o cliente conclui o widget: liga as contas do item e faz o 1º sync. */
export async function linkItem(itemId: string): Promise<{ bankName: string; accountsLinked: number; inserted: number }> {
  return invoke('crm-openfinance', 'link', { itemId })
}

/** Puxa as transações novas das contas ligadas (todas, ou de um item) pro razão de caixa. */
export async function syncOpenFinance(itemId?: string): Promise<{ inserted: number; accounts: number }> {
  return invoke('crm-openfinance', 'sync', itemId ? { itemId } : {})
}

export type BancoMcpStatus = {
  ok: boolean
  connections?: {
    connections?: Array<{
      connector_id?: string
      connector_name?: string
      item_id?: string
      status?: string
      reconnect_url?: string
    }>
    count?: number
    add_connection_url?: string
  }
  accounts?: {
    total?: number
    results?: unknown[]
    notice?: string
    bank?: string
  }
  status?: {
    statusDetail?: unknown
    reconnect_url?: string
  }
}

export async function getBancoMcpStatus(item?: string): Promise<BancoMcpStatus> {
  return invoke('crm-banco-mcp', 'status', item ? { item } : {})
}

export async function linkBancoMcp(item?: string): Promise<{
  ok: boolean
  bankName?: string
  accountsLinked?: number
  inserted?: number
  notice?: string
  reconnectUrl?: string | null
  addConnectionUrl?: string | null
}> {
  return invoke('crm-banco-mcp', 'link', item ? { item } : {})
}

export async function syncBancoMcp(item?: string): Promise<{ inserted: number; accounts: number }> {
  return invoke('crm-banco-mcp', 'sync', item ? { item } : {})
}
