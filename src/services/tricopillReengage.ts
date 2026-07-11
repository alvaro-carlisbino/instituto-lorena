import { supabase } from '@/lib/supabaseClient'

// Reengajamento "sem fim" do Tricopill — lê a RPC tricopill_reengage_overview
// (SECURITY DEFINER) alimentada pela edge crm-reengage-scheduler.

export type ReengageMetrics = {
  total_leads: number
  conversaram: number
  silenciosos: number
  silenciosos_7d: number
  silenciosos_30d: number
  compradores: number
  opt_out: number
  em_reativacao: number
  em_recompra: number
  reativados_convertidos: number
}

export type ReengageAtivo = {
  patient_name: string | null
  track: 'reactivation' | 'recompra' | string
  step: number
  status: string
  last_sent_at: string | null
}

export type ReengageFila = {
  patient_name: string | null
  situacao: string
  dias_silencio: number | null
  last_kit: string | null
  reactivation_status: string | null
  recompra_status: string | null
}

export type ReengageOverview = {
  metrics: ReengageMetrics | null
  ativos: ReengageAtivo[]
  fila: ReengageFila[]
}

export async function fetchTricopillReengage(): Promise<ReengageOverview> {
  if (!supabase) return { metrics: null, ativos: [], fila: [] }
  const { data, error } = await supabase.rpc('tricopill_reengage_overview')
  if (error) throw new Error(error.message || 'Falha ao carregar o reengajamento')
  const p = (data ?? {}) as Partial<ReengageOverview>
  return {
    metrics: (p.metrics ?? null) as ReengageMetrics | null,
    ativos: Array.isArray(p.ativos) ? (p.ativos as ReengageAtivo[]) : [],
    fila: Array.isArray(p.fila) ? (p.fila as ReengageFila[]) : [],
  }
}

export const TRACK_LABEL: Record<string, string> = {
  reactivation: 'Reativação',
  recompra: 'Recompra',
}
export const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo',
  stopped: 'Parou (opt-out)',
  converted: 'Convertido',
  paused: 'Pausado',
}
