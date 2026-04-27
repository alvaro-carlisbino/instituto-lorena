import { supabase } from '@/lib/supabaseClient'

export type EvolutionAction =
  | 'snapshot'
  | 'status'
  | 'qrcode'
  | 'connect'
  | 'logout'
  | 'restart'
  | 'create_instance'
  | 'delete_instance'

export type EvolutionSnapshotResult = {
  ok: boolean
  provider: string
  instance: string
  status: string
  connected: boolean | null
  qrCode?: string
  error?: string
  message?: string
}

export async function evolutionConnectionAction(
  action: EvolutionAction,
  extra?: { instanceId?: string },
): Promise<EvolutionSnapshotResult> {
  if (!supabase) {
    return {
      ok: false,
      provider: 'evolution',
      instance: '',
      status: 'not_configured',
      connected: null,
      error: 'Sistema não configurado.',
    }
  }

  const { data, error } = await supabase.functions.invoke('crm-evolution-connection', {
    body: { action, instanceId: extra?.instanceId },
  })

  if (error) {
    return {
      ok: false,
      provider: 'evolution',
      instance: '',
      status: 'error',
      connected: null,
      error: error.message || 'Falha ao consultar Evolution.',
    }
  }

  const parsed = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return {
    ok: parsed.ok === true,
    provider: String(parsed.provider ?? 'evolution'),
    instance: String(parsed.instance ?? ''),
    status: String(parsed.status ?? 'unknown'),
    connected: typeof parsed.connected === 'boolean' ? parsed.connected : null,
    qrCode: typeof parsed.qrCode === 'string' ? parsed.qrCode : undefined,
    error: typeof parsed.error === 'string' ? parsed.error : undefined,
    message: typeof parsed.message === 'string' ? parsed.message : undefined,
  }
}

export type EvolutionInstanceLifecycleResult = {
  ok: boolean
  instance?: string
  created?: unknown
  error?: string
  message?: string
  status?: number
}

/**
 * Cria ou remove instância na API Evolution (Mutation via Edge; requer can_manage_users).
 */
export async function evolutionInstanceLifecycle(
  action: 'create_instance' | 'delete_instance',
  options: { instanceName?: string; instanceId?: string },
): Promise<EvolutionInstanceLifecycleResult> {
  if (!supabase) {
    return { ok: false, error: 'Sistema não configurado.' }
  }
  const { data, error } = await supabase.functions.invoke('crm-evolution-connection', {
    body: { action, instanceName: options.instanceName, instanceId: options.instanceId },
  })
  const p = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  if (p && p.ok === true) {
    return {
      ok: true,
      instance: typeof p.instance === 'string' ? p.instance : options.instanceName,
      created: p.created,
    }
  }
  if (p && p.ok === false) {
    return {
      ok: false,
      error: typeof p.error === 'string' ? p.error : 'Operação rejeitada',
      message: typeof p.message === 'string' ? p.message : undefined,
      status: typeof p.status === 'number' ? p.status : undefined,
    }
  }
  if (error) {
    return { ok: false, error: error.message || 'Falha ao falar com o servidor.' }
  }
  return { ok: false, error: 'resposta_inesperada' }
}

