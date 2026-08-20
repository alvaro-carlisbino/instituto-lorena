import { supabase } from '@/lib/supabaseClient'

/**
 * Conexão e guarda das linhas W-API. Tudo o que fala com o painel da W-API passa pela edge
 * function `crm-wapi-connection` — o token da instância NUNCA sai do servidor, e o navegador
 * só vê o resultado.
 */

export type WapiAction =
  | 'status'
  | 'qrcode'
  | 'pairing_code'
  | 'restart'
  | 'disconnect'
  | 'configure_webhooks'
  | 'apply_settings'
  | 'webhook_logs'
  | 'queue'
  | 'check_number'
  | 'pause'
  | 'resume'

export type WapiActionResult = {
  ok: boolean
  action?: string
  connected?: boolean | null
  status?: string
  phone?: string | null
  qrCode?: string
  code?: string
  exists?: boolean | null
  pendentes?: number | null
  message?: string
  error?: string
  urls?: { recebidas: string; eventos: string }
  resultados?: Array<{ nome: string; ok: boolean; status?: number; detail?: string }>
  data?: unknown
}

export async function wapiConnectionAction(
  action: WapiAction,
  extra?: {
    instanceId: string
    phone?: string
    settings?: Record<string, unknown>
    minutes?: number
    reason?: string
  },
): Promise<WapiActionResult> {
  if (!supabase) return { ok: false, error: 'not_configured', message: 'Sistema não configurado.' }

  const { data, error } = await supabase.functions.invoke('crm-wapi-connection', {
    body: { action, ...extra },
  })

  const parsed = (data && typeof data === 'object' ? (data as WapiActionResult) : null) ?? null
  if (parsed && 'ok' in parsed) return parsed
  if (error) {
    return {
      ok: false,
      error: 'edge_error',
      message:
        /non-2xx|502|bad gateway/i.test(String(error.message ?? ''))
          ? 'A função crm-wapi-connection não respondeu. Confirme o deploy dela e veja os logs.'
          : error.message || 'Não foi possível falar com a W-API.',
    }
  }
  return { ok: false, error: 'unknown', message: 'Resposta inesperada do servidor.' }
}

// ── Guarda anti-ban: política e contadores ────────────────────────────────────

export type WapiLinePolicy = {
  instance_id: string
  tenant_id: string | null
  enabled: boolean
  janela_inicio: number
  janela_fim: number
  permite_domingo: boolean
  cap_frio_dia: number
  cap_proativo_dia: number
  cap_proativo_hora: number
  gap_min_segundos: number
  gap_jitter_segundos: number
  cap_proativo_semana_por_lead: number
  frio_max_tentativas: number
  frio_espera_dias: number
  aquecimento_inicio: string | null
  aquecimento_dias: number
  aquecimento_cap_inicial: number
  bloqueia_link_primeiro_contato: boolean
  cap_texto_repetido_hora: number
  pausado_ate: string | null
  pausa_motivo: string | null
}

export type WapiLineGuardRow = {
  instance_id: string
  tenant_id: string
  label: string
  channel_provider: string
  bot_kind: string
  active: boolean
  health_status: string
  connected: boolean | null
  last_event_at: string | null
  last_disconnected_at: string | null
  pausado_ate: string | null
  pausa_motivo: string | null
  guard_enabled: boolean
  cap_frio_dia: number
  cap_proativo_dia: number
  cap_proativo_hora: number
  aquecimento_inicio: string | null
  aquecimento_dias: number
  enviados_hoje: number
  proativos_hoje: number
  frios_hoje: number
  respostas_hoje: number
  bloqueados_hoje: number
  proativos_1h: number
  ultimo_proativo_at: string | null
}

export async function fetchLineGuard(instanceId: string): Promise<WapiLineGuardRow | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('v_whatsapp_line_guard')
    .select('*')
    .eq('instance_id', instanceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as WapiLineGuardRow | null) ?? null
}

export async function fetchLinePolicy(instanceId: string): Promise<WapiLinePolicy | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('whatsapp_line_policy')
    .select('*')
    .eq('instance_id', instanceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as WapiLinePolicy | null) ?? null
}

export async function saveLinePolicy(policy: Partial<WapiLinePolicy> & { instance_id: string }): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { error } = await supabase
    .from('whatsapp_line_policy')
    .upsert({ ...policy, updated_at: new Date().toISOString() }, { onConflict: 'instance_id' })
  if (error) throw new Error(error.message)
}

export type WapiOutboundLogRow = {
  id: string
  lead_id: string | null
  phone: string
  kind: string
  decision: string
  reason: string | null
  source: string | null
  created_at: string
}

/** Últimos bloqueios da linha: é aqui que se vê a guarda a trabalhar. */
export async function fetchBlockedRecent(instanceId: string, limit = 12): Promise<WapiOutboundLogRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('whatsapp_outbound_log')
    .select('id, lead_id, phone, kind, decision, reason, source, created_at')
    .eq('instance_id', instanceId)
    .eq('decision', 'blocked')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data as WapiOutboundLogRow[] | null) ?? []
}
