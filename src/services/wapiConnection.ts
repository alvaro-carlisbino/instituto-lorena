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
  | 'check_number'
  | 'pause'
  | 'resume'
  | 'profile'
  | 'device'
  | 'queue'
  | 'queue_delete'
  | 'queue_clear'
  | 'block_contact'
  | 'check_numbers'
  | 'contact_picture'
  | 'groups'
  | 'proxy'

export type WapiActionResult = {
  ok: boolean
  action?: string
  connected?: boolean | null
  status?: string
  phone?: string | null
  qrCode?: string
  code?: string
  exists?: boolean | null
  message?: string
  error?: string
  urls?: { recebidas: string; eventos: string }
  resultados?: Array<{ nome: string; ok: boolean; status?: number; detail?: string }>
  /** device: aparelho que está com a sessão. */
  nome?: string | null
  plataforma?: string | null
  isBusiness?: boolean | null
  /** check_numbers: número → tem WhatsApp (null = a W-API não respondeu). */
  resultado?: Record<string, boolean | null>
  /** contact_picture: URL do avatar. */
  url?: string | null
  blocked?: boolean
  proxy?: string | null
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
    profile?: Record<string, unknown>
    proxy?: string
    messageId?: string
    block?: boolean
    phones?: string[]
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
  /** Teto de PRIMEIRO CONTATO com quem pediu contato (formulário, site). */
  cap_optin_dia: number
  optin_max_idade_horas: number
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

// ── Fila de primeiro contato ──────────────────────────────────────────────────

export type OutreachFila = {
  instance_id: string
  na_fila: number
  prontos_agora: number
  enviados_hoje: number
  recusados_hoje: number
  proximo_em: string | null
}

export type LeadformOutreachConfig = {
  enabled: boolean
  message: string
  max_age_hours: number
}

export async function fetchOutreachFila(instanceId: string): Promise<OutreachFila | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('v_whatsapp_outreach_fila')
    .select('*')
    .eq('instance_id', instanceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as OutreachFila | null) ?? null
}

export async function fetchLeadformConfig(tenantId: string): Promise<LeadformOutreachConfig> {
  const vazio: LeadformOutreachConfig = { enabled: false, message: '', max_age_hours: 48 }
  if (!supabase) return vazio
  const { data, error } = await supabase
    .from('tenant_integrations')
    .select('outreach')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const out = ((data as { outreach?: Record<string, unknown> } | null)?.outreach ?? {}) as Record<string, unknown>
  const lf = (out.leadform ?? {}) as Partial<LeadformOutreachConfig>
  return {
    enabled: lf.enabled === true,
    message: String(lf.message ?? ''),
    max_age_hours: Number(lf.max_age_hours) > 0 ? Number(lf.max_age_hours) : 48,
  }
}

export async function saveLeadformConfig(tenantId: string, cfg: LeadformOutreachConfig): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  // Lê o `outreach` inteiro antes de gravar: escrever a chave `leadform` sozinha apagaria
  // qualquer outra automação guardada no mesmo objeto.
  const { data } = await supabase.from('tenant_integrations').select('outreach').eq('tenant_id', tenantId).maybeSingle()
  const atual = ((data as { outreach?: Record<string, unknown> } | null)?.outreach ?? {}) as Record<string, unknown>
  const { error } = await supabase
    .from('tenant_integrations')
    .update({ outreach: { ...atual, leadform: cfg } })
    .eq('tenant_id', tenantId)
  if (error) throw new Error(error.message)
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
