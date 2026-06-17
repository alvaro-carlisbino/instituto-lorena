import { supabase } from '@/lib/supabaseClient'

export type AnalyticsSummary = {
  total_leads: number
  total_active: number
  total_lost: number
  total_excluded: number
  period_days: number
}

export type AnalyticsFunnelStage = {
  pipeline_id: string
  pipeline_name: string
  stage_id: string
  stage_name: string
  position: number
  count: number
}

export type AnalyticsLostReason = {
  reason: string
  count: number
}

export type AnalyticsStuckLead = {
  lead_id: string
  patient_name: string
  stage_id: string
  days_in_stage: number
}

export type AnalyticsBySdr = {
  sdr_id: string
  sdr_name: string
  total_leads: number
  lost_leads: number
  conversion_pct: number
}

export type AnalyticsPayload = {
  summary: AnalyticsSummary
  funnel: AnalyticsFunnelStage[]
  lost_reasons: AnalyticsLostReason[]
  stuck_leads: AnalyticsStuckLead[]
  by_sdr: AnalyticsBySdr[]
}

const EMPTY: AnalyticsPayload = {
  summary: { total_leads: 0, total_active: 0, total_lost: 0, total_excluded: 0, period_days: 30 },
  funnel: [],
  lost_reasons: [],
  stuck_leads: [],
  by_sdr: [],
}

/** Busca o snapshot de analytics do tenant atual via RPC tenant_analytics_summary. */
export async function fetchTenantAnalytics(periodDays = 30): Promise<AnalyticsPayload> {
  if (!supabase) return EMPTY
  const { data, error } = await supabase.rpc('tenant_analytics_summary', { p_days: periodDays })
  if (error) throw new Error(error.message)
  if (!data || typeof data !== 'object') return EMPTY
  const obj = data as Partial<AnalyticsPayload>
  return {
    summary: obj.summary ?? EMPTY.summary,
    funnel: obj.funnel ?? [],
    lost_reasons: obj.lost_reasons ?? [],
    stuck_leads: obj.stuck_leads ?? [],
    by_sdr: obj.by_sdr ?? [],
  }
}

// ---- Analytics v2 (funil real Shosp + filtros) ------------------------------

export type AnalyticsV2 = {
  range: { start: string; end: string }
  summary: { total_leads: number; ativos: number; perdidos: number; com_shosp: number; excluidos: number }
  by_source: Array<{ source: string; total: number; agendados: number; comparecidos: number; perdidos: number; conversao_pct: number | null }>
  shosp_funnel: { leads_agendados: number; leads_comparecidos: number; leads_no_show: number; leads_cancelados: number }
  by_stage: Array<{ pipeline_id: string; stage_id: string; stage_name: string; position: number; count: number }>
  by_sdr: Array<{ owner_id: string; owner_name: string; total: number; perdidos: number; agendados: number; conversao_pct: number | null }>
  lost_reasons: Array<{ reason: string; count: number }>
  time_in_stage: Array<{ stage_id: string; stage_name: string; leads: number; avg_days: number }>
}

/** Busca o analytics v2 (funil real cruzando agendamentos Shosp) com filtros.
 *  `tenant` escopa por polo — a RPC é SECURITY DEFINER e, sem isso, enxerga
 *  todos os polos (mistura Instituto Lorena + Tricopill). */
export async function fetchAnalyticsV2(params: {
  start: Date
  end: Date
  source?: string | null
  owner?: string | null
  tenant?: string | null
}): Promise<AnalyticsV2 | null> {
  if (!supabase) return null
  const base = {
    p_start: params.start.toISOString(),
    p_end: params.end.toISOString(),
    p_source: params.source ?? null,
    p_owner: params.owner ?? null,
  }
  let { data, error } = await supabase.rpc('crm_analytics_v2', { ...base, p_tenant: params.tenant ?? null })
  // Fallback enquanto a migration que adiciona p_tenant não foi aplicada: o
  // PostgREST não acha a sobrecarga de 5 args. Cai pro modo legado (sem escopo
  // de polo) em vez de quebrar a tela.
  if (error && /p_tenant|schema cache|could not find/i.test(error.message)) {
    ;({ data, error } = await supabase.rpc('crm_analytics_v2', base))
  }
  if (error) throw new Error(error.message)
  return (data as AnalyticsV2) ?? null
}

// ---- Métricas da agenda Shosp (clínica inteira) -----------------------------

export type ShospAgendaMetrics = {
  range_dias: number
  total: number
  cancelados: number
  taxa_cancelamento_pct: number | null
  por_medico: Array<{ prestador: string; total: number; cancelados: number }>
  por_plano: Array<{ plano: string; total: number }>
  por_dia: Array<{ dia: string; total: number }>
}

export async function fetchShospAgendaMetrics(days = 30): Promise<ShospAgendaMetrics | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('crm_shosp_agenda_metrics', { p_days: days })
  if (error) throw new Error(error.message)
  return (data as ShospAgendaMetrics) ?? null
}

// ---- Agenda Shosp por janela (dashboard) ------------------------------------
// Leitura direta do espelho shosp_appointments (RLS: SELECT liberado p/
// authenticated). A clínica tem UMA agenda Shosp — não há escopo de polo aqui.
// Usado pelo card "Consultas agendadas", que mede o VOLUME real da agenda (a
// clínica agenda ~280/mês) e não o funil vinculado a lead (que trava em ~9 pelo
// gargalo de vínculo lead↔Shosp). Ver [[crm_metricas_consultas_agendadas]].

export type ShospApptRow = { status: string; data: string; lead_id: string | null }

/** Agendamentos com DATA da consulta dentro de [startYmd, endYmd] (inclusive). */
export async function fetchShospAppointmentsBetween(startYmd: string, endYmd: string): Promise<ShospApptRow[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('shosp_appointments')
    .select('status, data, lead_id')
    .gte('data', startYmd)
    .lte('data', endYmd)
    .limit(5000)
  if (error) throw new Error(error.message)
  return (data as ShospApptRow[]) ?? []
}

/** IDs de leads que possuem ao menos um agendamento (qualquer data). Base do
 *  numerador da conversão lead→consulta. Tabela é pequena (~1k linhas). */
export async function fetchLeadIdsWithAppointment(): Promise<Set<string>> {
  if (!supabase) return new Set()
  const { data, error } = await supabase
    .from('shosp_appointments')
    .select('lead_id')
    .not('lead_id', 'is', null)
    .limit(5000)
  if (error) throw new Error(error.message)
  const set = new Set<string>()
  for (const row of (data as Array<{ lead_id: string | null }>) ?? []) {
    if (row.lead_id) set.add(row.lead_id)
  }
  return set
}

/** Marca um lead como perdido, com motivo. */
export async function setLeadLostReason(leadId: string, reason: string): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { error } = await supabase
    .from('leads')
    .update({ lost_reason: reason.trim() || null })
    .eq('id', leadId)
  if (error) throw new Error(error.message)
}

/** Alterna a flag excluded_from_metrics. */
export async function setLeadExcludedFromMetrics(leadId: string, excluded: boolean): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { error } = await supabase
    .from('leads')
    .update({ excluded_from_metrics: excluded })
    .eq('id', leadId)
  if (error) throw new Error(error.message)
}

/** Lista padrão de motivos de perda — clínica médica. Sugestões; texto livre permitido. */
export const DEFAULT_LOST_REASONS = [
  'Sem orçamento',
  'Achou caro',
  'Sem interesse',
  'Já fechou em outro lugar',
  'Sem retorno',
  'Distância / localização',
  'Conta errada / contato inválido',
  'Equipe / fornecedor',
  'Outro',
] as const
