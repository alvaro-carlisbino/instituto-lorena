import { supabase } from '@/lib/supabaseClient'
import { buscarTudo } from '@/lib/supabasePaginate'

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
  /** Frescor do espelho da agenda Shosp. Quando a cota da API estoura, o espelho
   *  congela e os números de consulta viram foto velha — a tela precisa avisar. */
  agenda_sync?: { ultimo_sync: string | null; dias_atras: number | null }
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

// ---- Funil comercial (Centro de Resultados) ---------------------------------
// Usa SÓ dado confiável hoje: a tabela `leads` e o histórico de `interactions`.
// Nada aqui depende do vínculo com a Shosp (1,6% dos leads) nem de faturamento
// (que a clínica ainda não registra). Ver a migration crm_funil_comercial.

export type FunilComercial = {
  range: { start: string; end: string; anterior_start: string }
  resumo: {
    leads_novos: number
    leads_novos_anterior: number
    variacao_pct: number | null
    ativos: number
    perdidos: number
    respondidos: number
    sem_resposta: number
    taxa_resposta_pct: number | null
    atendidos_por_humano: number
    dias_no_periodo: number
  }
  por_dia: Array<{ dia: string; leads: number }>
  por_origem: Array<{ origem: string; leads: number; perdidos: number }>
  por_campanha: Array<{ campanha: string; leads: number }>
  por_atendente: Array<{
    atendente: string
    leads: number
    respondidos: number
    sem_resposta: number
    atendidos_por_humano: number
    /** Quantos destes leads a PRÓPRIA pessoa respondeu (o dono é rodízio automático). */
    respondidos_por_ela: number
    /** Mediana só dos leads que a própria pessoa respondeu. Nulo se ela não respondeu nenhum. */
    mediana_humano_min: number | null
    perdidos: number
  }>
  /** Quem de fato deu a primeira resposta, que é diferente de quem recebeu o lead. */
  por_quem_respondeu: Array<{ pessoa: string; respondeu: number; mediana_min: number | null }>
  sla: {
    ia: { respondidos: number; mediana_min: number | null; p90_min: number | null }
    humano: { respondidos: number; mediana_min: number | null; p90_min: number | null }
    faixas_humano: Array<{ faixa: string; leads: number }>
  }
  perdas: Array<{ motivo: string; leads: number }>
  etapas: Array<{ etapa: string; position: number; leads: number; dias_medios: number }>
  qualidade_dado: {
    com_campanha_pct: number | null
    com_motivo_perda_pct: number | null
    com_vinculo_shosp_pct: number | null
    agenda_ultimo_sync: string | null
    agenda_dias_atras: number | null
  }
}

export async function fetchFunilComercial(params: {
  start: Date
  end: Date
  tenant?: string | null
}): Promise<FunilComercial | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('crm_funil_comercial', {
    p_start: params.start.toISOString(),
    p_end: params.end.toISOString(),
    p_tenant: params.tenant ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as FunilComercial) ?? null
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
  return buscarTudo<ShospApptRow>(() =>
    supabase!
      .from('shosp_appointments')
      .select('status, data, lead_id')
      .gte('data', startYmd)
      .lte('data', endYmd)
      .order('codigo_agendamento', { ascending: true }),
    { rotulo: 'shosp_appointments (janela)' },
  )
}

export type ShospFrescor = { ultimoSync: string | null; diasAtras: number | null }

/**
 * Quando o espelho da agenda foi escrito pela última vez.
 *
 * Fonte é `max(synced_at)` da própria tabela, e NÃO `shosp_sync_state.last_appointments_sync_at`:
 * esse campo marca "tentei", não "consegui", e ficou carimbado com a data de hoje durante os
 * 20 dias em que a cota da Shosp esteve estourada e nada entrou.
 */
export async function fetchShospFrescor(): Promise<ShospFrescor> {
  if (!supabase) return { ultimoSync: null, diasAtras: null }
  const { data, error } = await supabase
    .from('shosp_appointments')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const ultimoSync = (data as { synced_at: string } | null)?.synced_at ?? null
  if (!ultimoSync) return { ultimoSync: null, diasAtras: null }
  const diasAtras = Math.floor((Date.now() - new Date(ultimoSync).getTime()) / 86_400_000)
  return { ultimoSync, diasAtras }
}

/** IDs de leads que possuem ao menos um agendamento (qualquer data). Base do
 *  numerador da conversão lead→consulta. */
export async function fetchLeadIdsWithAppointment(): Promise<Set<string>> {
  if (!supabase) return new Set()
  const linhas = await buscarTudo<{ lead_id: string | null }>(() =>
    supabase!
      .from('shosp_appointments')
      .select('lead_id')
      .not('lead_id', 'is', null)
      .order('codigo_agendamento', { ascending: true }),
    { rotulo: 'shosp_appointments (lead_id)' },
  )
  const set = new Set<string>()
  for (const row of linhas) {
    if (row.lead_id) set.add(row.lead_id)
  }
  return set
}

/** IDs de leads vinculados a paciente Shosp (prontuário preenchido). Base da métrica de
 *  COBERTURA do funil real: a conversão lead→consulta só enxerga leads vinculados, então
 *  cobertura baixa = conversão subestimada (gargalo de vínculo, não de venda). */
export async function fetchLeadIdsWithShospLink(): Promise<Set<string>> {
  if (!supabase) return new Set()
  const { data, error } = await supabase
    .from('leads')
    .select('id')
    .not('shosp_prontuario', 'is', null)
    .is('deleted_at', null)
    .limit(10000)
  if (error) throw new Error(error.message)
  return new Set(((data as Array<{ id: string }>) ?? []).map((r) => r.id))
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

// ---- Conversão comercial: do lead ao dinheiro -------------------------------
// A /resultados contava lead, resposta e SLA e parava aí — origem que traz 400
// leads e vende zero aparecia como a melhor da tabela. Isto responde "quantos
// viraram venda, por quanto, vindos de onde".
//
// Duas contagens diferentes, de propósito:
//   • conversão de SAFRA (`convertidos`): dos leads criados na janela, quantos
//     compraram alguma vez. É o número que avalia a ENTRADA de lead.
//   • caixa da janela (`vendas_no_periodo`): vendas que aconteceram no período,
//     de qualquer safra. É o número que casa com o financeiro.
// Misturar os dois é o erro clássico ("vendas do mês / leads do mês"), que sobe
// sozinho quando o mês tem pouca entrada.

export type ConversaoResumo = {
  leads: number
  convertidos: number
  taxa_conversao_pct: number | null
  receita_cents: number
  ticket_medio_cents: number | null
  dias_ate_venda_mediana: number | null
  /** Conversão no mesmo dia costuma ser cadastro criado pela própria venda. */
  convertidos_mesmo_dia: number
  convertidos_anterior: number
  leads_anterior: number
  vendas_no_periodo: number
  receita_no_periodo_cents: number
}

export type ConversaoPorChave = {
  leads: number
  convertidos: number
  conversao_pct: number | null
  receita_cents: number
}

export type ConversaoComercial = {
  range: { start: string; end: string; anterior_start: string }
  resumo: ConversaoResumo
  por_origem: Array<ConversaoPorChave & { origem: string }>
  por_campanha: Array<ConversaoPorChave & { campanha: string }>
  por_atendente: Array<ConversaoPorChave & { atendente: string }>
  por_mes: Array<Omit<ConversaoPorChave, 'receita_cents'> & { mes: string; receita_cents: number }>
  qualidade: {
    /** Venda registrada sem lead: conversão que existiu e não credita origem nenhuma. */
    vendas_sem_lead: number
    pagamentos_sem_lead: number
  }
}

export async function fetchConversaoComercial(params: {
  start: Date
  end: Date
  tenant?: string | null
}): Promise<ConversaoComercial | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('crm_conversao_comercial', {
    p_start: params.start.toISOString(),
    p_end: params.end.toISOString(),
    p_tenant: params.tenant ?? null,
  })
  if (error) throw new Error(error.message)
  return (data as ConversaoComercial) ?? null
}
