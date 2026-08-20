import { supabase } from '@/lib/supabaseClient'
import { poloDaTela } from '@/lib/poloDaTela'

/**
 * A fila do que a landing /consulta reservou.
 *
 * Cada linha é uma pessoa que respondeu a triagem inteira e escolheu um horário
 * sozinha. O trabalho da equipe aqui é curto de propósito: confirmar (a vaga vira
 * consulta de verdade na Shosp), cancelar (a vaga volta para a landing na hora) ou
 * carimbar quem veio e quem faltou.
 *
 * Confirmar e carimbar TAMBÉM mexem no card do lead: quem confirma leva o lead para
 * "Consulta agendada" e quem compareceu leva para "Consulta Realizada". Sem isso o
 * funil da clínica continuaria mentindo, com a pessoa parada em "Ligar" depois de
 * já ter sentado na cadeira.
 */

export type StatusPreAgendamento = 'pendente' | 'confirmado' | 'cancelado' | 'compareceu' | 'faltou'

export type PreAgendamento = {
  id: string
  protocolo: string
  prestador: string
  leadId: string | null
  nome: string
  telefone: string
  unidadeId: string
  slotAt: string
  status: StatusPreAgendamento
  objetivo: string
  grau: string
  urgencia: string
  cidade: string
  score: number
  temperatura: 'cold' | 'warm' | 'hot'
  estimativaMin: number | null
  estimativaMax: number | null
  respostas: Record<string, unknown>
  atribuicao: Record<string, unknown> | null
  observacao: string
  criadoEm: string
  confirmadoEm: string | null
  canceladoMotivo: string | null
}

export type UnidadeAgenda = { id: string; rotulo: string; endereco: string; ativa: boolean }

export const STATUS_LABEL: Record<StatusPreAgendamento, string> = {
  pendente: 'Aguardando confirmação',
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
  compareceu: 'Compareceu',
  faltou: 'Faltou',
}

export const OBJETIVO_LABEL: Record<string, string> = {
  transplante_masculino: 'Transplante masculino',
  transplante_feminino: 'Transplante feminino',
  sobrancelha: 'Sobrancelhas',
  barba: 'Barba',
  tratamento: 'Tratamento sem cirurgia',
  nao_sei: 'Não sabe ainda',
}

export const URGENCIA_LABEL: Record<string, string> = {
  este_mes: 'Este mês',
  ate_3_meses: 'Até 3 meses',
  esse_ano: 'Este ano',
  pesquisando: 'Só pesquisando',
}

export const TEMPO_LABEL: Record<string, string> = {
  menos_1_ano: 'Menos de 1 ano',
  de_1_a_3_anos: 'De 1 a 3 anos',
  mais_3_anos: 'Mais de 3 anos',
}

export const JA_FEZ_LABEL: Record<string, string> = {
  nao: 'Nunca fez',
  sim_outro_lugar: 'Fez em outro lugar',
  sim_aqui: 'Fez aqui',
}

export function grauLegivel(grau: string): string {
  if (!grau) return ''
  if (grau.startsWith('ludwig_')) return `Ludwig ${grau.replace('ludwig_', '')}`
  if (grau === '3v') return 'Norwood III vertex'
  return `Norwood ${grau}`
}

function linha(row: Record<string, unknown>): PreAgendamento {
  return {
    id: String(row.id),
    protocolo: String(row.protocolo ?? ''),
    prestador: String(row.prestador ?? ''),
    leadId: row.lead_id ? String(row.lead_id) : null,
    nome: String(row.nome ?? ''),
    telefone: String(row.telefone ?? ''),
    unidadeId: String(row.unidade_id ?? ''),
    slotAt: String(row.slot_at ?? ''),
    status: (String(row.status ?? 'pendente') as StatusPreAgendamento) ?? 'pendente',
    objetivo: String(row.objetivo ?? ''),
    grau: String(row.grau ?? ''),
    urgencia: String(row.urgencia ?? ''),
    cidade: String(row.cidade ?? ''),
    score: Number(row.score ?? 0),
    temperatura: (row.temperatura as PreAgendamento['temperatura']) ?? 'warm',
    estimativaMin: row.estimativa_min == null ? null : Number(row.estimativa_min),
    estimativaMax: row.estimativa_max == null ? null : Number(row.estimativa_max),
    respostas: (row.respostas as Record<string, unknown>) ?? {},
    atribuicao: (row.atribuicao as Record<string, unknown>) ?? null,
    observacao: String(row.observacao ?? ''),
    criadoEm: String(row.created_at ?? ''),
    confirmadoEm: row.confirmado_em ? String(row.confirmado_em) : null,
    canceladoMotivo: row.cancelado_motivo ? String(row.cancelado_motivo) : null,
  }
}

export async function listarPreAgendamentos(desdeDias = 30): Promise<PreAgendamento[]> {
  if (!supabase) return []
  const desde = new Date(Date.now() - desdeDias * 86_400_000).toISOString()
  let q = supabase
    .from('clinic_prebookings')
    .select('*')
    .gte('created_at', desde)
    .order('slot_at', { ascending: true })
    .limit(500)
  const polo = poloDaTela()
  if (polo) q = q.eq('tenant_id', polo)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => linha(r as Record<string, unknown>))
}

export async function listarUnidadesAgenda(): Promise<UnidadeAgenda[]> {
  if (!supabase) return []
  let q = supabase.from('clinic_booking_units').select('id, rotulo, endereco, active').order('sort_order')
  const polo = poloDaTela()
  if (polo) q = q.eq('tenant_id', polo)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((u) => ({
    id: String(u.id),
    rotulo: String(u.rotulo),
    endereco: String(u.endereco ?? ''),
    ativa: u.active === true,
  }))
}

async function moverLead(leadId: string | null, stageId: string): Promise<void> {
  if (!supabase || !leadId) return
  await supabase
    .from('leads')
    .update({ stage_id: stageId, pipeline_id: 'pipeline-clinica', stage_entered_at: new Date().toISOString() })
    .eq('id', leadId)
}

export async function confirmarPreAgendamento(pre: PreAgendamento): Promise<void> {
  if (!supabase) return
  const { data: sessao } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('clinic_prebookings')
    .update({
      status: 'confirmado',
      confirmado_em: new Date().toISOString(),
      confirmado_por: sessao?.user?.id ?? null,
    })
    .eq('id', pre.id)
  if (error) throw new Error(error.message)
  // Consulta agendada no funil da clínica.
  await moverLead(pre.leadId, 'consulta')
}

export async function cancelarPreAgendamento(pre: PreAgendamento, motivo: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase
    .from('clinic_prebookings')
    .update({
      status: 'cancelado',
      cancelado_em: new Date().toISOString(),
      cancelado_motivo: motivo.trim().slice(0, 200),
    })
    .eq('id', pre.id)
  if (error) throw new Error(error.message)
}

export async function carimbarComparecimento(pre: PreAgendamento, veio: boolean): Promise<void> {
  if (!supabase) return
  const { error } = await supabase
    .from('clinic_prebookings')
    .update({ status: veio ? 'compareceu' : 'faltou' })
    .eq('id', pre.id)
  if (error) throw new Error(error.message)
  if (veio) await moverLead(pre.leadId, 'stage-1777902160674') // Consulta Realizada
}

export async function salvarObservacao(pre: PreAgendamento, observacao: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase
    .from('clinic_prebookings')
    .update({ observacao: observacao.slice(0, 500) })
    .eq('id', pre.id)
  if (error) throw new Error(error.message)
}

// ── Configuração da agenda que a landing oferece ────────────────────────────

export type JanelaAgenda = {
  id: string
  unidadeId: string
  weekday: number
  horaInicio: string
  horaFim: string
  slotMinutes: number
  ativa: boolean
}

export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export async function listarJanelas(): Promise<JanelaAgenda[]> {
  if (!supabase) return []
  let q = supabase
    .from('clinic_booking_windows')
    .select('id, unidade_id, weekday, hora_inicio, hora_fim, slot_minutes, active')
    .order('weekday')
  const polo = poloDaTela()
  if (polo) q = q.eq('tenant_id', polo)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((j) => ({
    id: String(j.id),
    unidadeId: String(j.unidade_id),
    weekday: Number(j.weekday),
    horaInicio: String(j.hora_inicio ?? '').slice(0, 5),
    horaFim: String(j.hora_fim ?? '').slice(0, 5),
    slotMinutes: Number(j.slot_minutes ?? 30),
    ativa: j.active === true,
  }))
}

export async function alternarJanela(janela: JanelaAgenda): Promise<void> {
  if (!supabase) return
  const { error } = await supabase
    .from('clinic_booking_windows')
    .update({ active: !janela.ativa })
    .eq('id', janela.id)
  if (error) throw new Error(error.message)
}

export async function fecharDia(dia: string, motivo: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('clinic_booking_blackouts').insert({
    tenant_id: poloDaTela() ?? 'instituto-lorena',
    dia,
    motivo: motivo.trim().slice(0, 120),
  })
  if (error) throw new Error(error.message)
}

export type DiaFechado = { id: string; dia: string; motivo: string }

export async function listarDiasFechados(): Promise<DiaFechado[]> {
  if (!supabase) return []
  let q = supabase
    .from('clinic_booking_blackouts')
    .select('id, dia, motivo')
    .gte('dia', new Date().toISOString().slice(0, 10))
    .order('dia')
    .limit(60)
  const polo = poloDaTela()
  if (polo) q = q.eq('tenant_id', polo)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((b) => ({ id: String(b.id), dia: String(b.dia), motivo: String(b.motivo ?? '') }))
}

export async function reabrirDia(id: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('clinic_booking_blackouts').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Saúde do espelho da agenda ──────────────────────────────────────────────

export type EstadoAgendaShosp = {
  horariosLivres: number
  ultimaSincronia: string | null
  minutosDesde: number | null
}

/**
 * Quando a landing leu a agenda da Shosp pela última vez.
 *
 * Existe porque "no ar" não é o mesmo que "vivo": se o cron parar, a página segue
 * bonita oferecendo horário de duas semanas atrás. Aqui a equipe vê o relógio.
 */
export async function estadoDaAgendaShosp(): Promise<EstadoAgendaShosp> {
  if (!supabase) return { horariosLivres: 0, ultimaSincronia: null, minutosDesde: null }
  const { count } = await supabase
    .from('shosp_agenda_slots')
    .select('dia', { count: 'exact', head: true })
    .gte('dia', new Date().toISOString().slice(0, 10))
  const { data } = await supabase
    .from('shosp_agenda_slots')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
  const ultima = data?.[0]?.synced_at ? String(data[0].synced_at) : null
  return {
    horariosLivres: count ?? 0,
    ultimaSincronia: ultima,
    minutosDesde: ultima ? Math.round((Date.now() - new Date(ultima).getTime()) / 60000) : null,
  }
}

// ── Quem atende o quê, e em que turno ───────────────────────────────────────

export type PrestadorAgenda = {
  id: string
  unidadeId: string
  codigoPrestador: string
  rotuloPublico: string
  objetivos: string[]
  horaInicio: string
  horaFim: string
  horaInicioCirurgia: string | null
  horaFimCirurgia: string | null
  maxPorDia: number
  ativo: boolean
}

/**
 * O turno de consulta de cada médico, e o que muda em dia de cirurgia.
 *
 * Existe porque a agenda da Shosp abre a grade inteira do profissional, mas
 * consulta não é o dia todo: a Dra. Lorena atende de manhã, o Dr. Matheus e a
 * Dra. Jaqueline à tarde, e em dia de cirurgia a janela encolhe. Cirurgia não
 * aparece na Shosp (é o sistema do centro cirúrgico), então é aqui que a regra vive.
 */
export async function listarPrestadoresAgenda(): Promise<PrestadorAgenda[]> {
  if (!supabase) return []
  let q = supabase
    .from('clinic_booking_prestadores')
    .select('id, unidade_id, codigo_prestador, rotulo_publico, objetivos, hora_inicio, hora_fim, hora_inicio_cirurgia, hora_fim_cirurgia, max_por_dia, active')
    .order('sort_order')
  const polo = poloDaTela()
  if (polo) q = q.eq('tenant_id', polo)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map((p) => ({
    id: String(p.id),
    unidadeId: String(p.unidade_id),
    codigoPrestador: String(p.codigo_prestador),
    rotuloPublico: String(p.rotulo_publico),
    objetivos: (p.objetivos as string[]) ?? [],
    horaInicio: String(p.hora_inicio ?? '').slice(0, 5),
    horaFim: String(p.hora_fim ?? '').slice(0, 5),
    horaInicioCirurgia: p.hora_inicio_cirurgia ? String(p.hora_inicio_cirurgia).slice(0, 5) : null,
    horaFimCirurgia: p.hora_fim_cirurgia ? String(p.hora_fim_cirurgia).slice(0, 5) : null,
    maxPorDia: Number(p.max_por_dia ?? 3),
    ativo: p.active === true,
  }))
}

export async function salvarPrestadorAgenda(
  id: string,
  patch: Partial<{
    hora_inicio: string
    hora_fim: string
    hora_inicio_cirurgia: string | null
    hora_fim_cirurgia: string | null
    max_por_dia: number
    active: boolean
  }>,
): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('clinic_booking_prestadores').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Dias em que algum médico está no centro cirúrgico, para a equipe ver o porquê da agenda curta. */
export async function listarDiasDeCirurgia(dias = 30): Promise<Array<{ dia: string; medicoId: number }>> {
  if (!supabase) return []
  const hoje = new Date().toISOString().slice(0, 10)
  const fim = new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('srg_surgeries')
    .select('dia, medico_id, status, deleted_at')
    .gte('dia', hoje)
    .lte('dia', fim)
    .in('status', ['AGUARDANDO', 'EM_PROCESSO'])
    .is('deleted_at', null)
  if (error) return []
  return (data ?? []).map((s) => ({ dia: String(s.dia), medicoId: Number(s.medico_id) }))
}
