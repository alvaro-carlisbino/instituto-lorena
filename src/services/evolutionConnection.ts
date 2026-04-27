import { supabase } from '@/lib/supabaseClient'

export type EvolutionAction = 'snapshot' | 'status' | 'qrcode' | 'connect' | 'logout' | 'restart'

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

