import { supabase } from '@/lib/supabaseClient'

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

/**
 * Vínculo entre a cirurgia (espelho do sistema PHP, tabelas srg_*) e o paciente
 * do CRM. O casamento automático só grava quando o nome bate EXATO — num app de
 * saúde, casar por semelhança é mostrar a cirurgia de um paciente para outro.
 * Sobra o que precisa de olho humano, e é isso que esta tela resolve.
 */

export type MatchStatus = 'pendente' | 'auto' | 'manual' | 'sem_match' | 'ignorado'

export type CirurgiaVinculo = {
  id: number
  pacienteNome: string
  dia: string | null
  status: string
  meta: number
  totalImplantados: number
  matchStatus: MatchStatus
  shospProntuario: string | null
  leadId: string | null
}

export type SugestaoPaciente = {
  prontuario: string
  nome: string
  cpf: string | null
  celular: string | null
  leadId: string | null
  score: number
}

type LinhaCirurgia = {
  id: number
  paciente_nome: string | null
  dia: string | null
  status: string | null
  meta: number | null
  total_implantados: number | null
  match_status: string | null
  shosp_prontuario: string | null
  lead_id: string | null
}

export async function listarCirurgias(filtro: 'todas' | MatchStatus = 'todas'): Promise<CirurgiaVinculo[]> {
  let q = assertClient()
    .from('srg_surgeries')
    .select('id, paciente_nome, dia, status, meta, total_implantados, match_status, shosp_prontuario, lead_id')
    .is('deleted_at', null)
    .order('dia', { ascending: false })
    .limit(1000)

  if (filtro !== 'todas') q = q.eq('match_status', filtro)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  return ((data ?? []) as LinhaCirurgia[]).map((r) => ({
    id: r.id,
    pacienteNome: r.paciente_nome ?? '—',
    dia: r.dia,
    status: r.status ?? '',
    meta: r.meta ?? 0,
    totalImplantados: r.total_implantados ?? 0,
    matchStatus: (r.match_status ?? 'pendente') as MatchStatus,
    shospProntuario: r.shosp_prontuario,
    leadId: r.lead_id,
  }))
}

export async function sugerirPacientes(surgeryId: number, limite = 8): Promise<SugestaoPaciente[]> {
  const { data, error } = await assertClient().rpc('srg_suggest_patients', {
    p_surgery_id: surgeryId,
    p_limit: limite,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    prontuario: String(r.prontuario ?? ''),
    nome: String(r.nome ?? ''),
    cpf: (r.cpf as string | null) ?? null,
    celular: (r.celular as string | null) ?? null,
    leadId: (r.lead_id as string | null) ?? null,
    score: Number(r.score ?? 0),
  }))
}

/** Passar `null` no prontuário marca a cirurgia como "ignorado" (sem paciente). */
export async function vincularPaciente(surgeryId: number, prontuario: string | null): Promise<void> {
  const { error } = await assertClient().rpc('srg_link_patient', {
    p_surgery_id: surgeryId,
    p_prontuario: prontuario,
  })
  if (error) throw new Error(error.message)
}

export async function rodarCasamentoAutomatico(): Promise<{ casadas: number; ambiguas: number; semMatch: number }> {
  const { data, error } = await assertClient().rpc('srg_match_patients', { p_only_pending: true })
  if (error) throw new Error(error.message)
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
  return {
    casadas: Number(r?.matched ?? 0),
    ambiguas: Number(r?.ambiguous ?? 0),
    semMatch: Number(r?.unmatched ?? 0),
  }
}

/** Última rodada do sync, para a tela dizer se o espelho está fresco ou parado. */
export async function estadoDoSync(): Promise<{ ultimaRodada: string | null; ok: boolean }> {
  const { data, error } = await assertClient()
    .from('srg_sync_state')
    .select('last_run_at, ok')
    .order('last_run_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const r = (data ?? [])[0] as { last_run_at: string | null; ok: boolean } | undefined
  return { ultimaRodada: r?.last_run_at ?? null, ok: r?.ok ?? true }
}
