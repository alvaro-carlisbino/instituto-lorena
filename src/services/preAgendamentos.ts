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
