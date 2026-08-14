import { supabase } from '@/lib/supabaseClient'

/**
 * Follow-up com data, dono e histórico.
 *
 * Substitui as colunas "1º Contato / 2º Contato / 3º Contato" das planilhas. Na
 * da Aline elas pararam de ser preenchidas em 2022; na da Ingrid o número da
 * tentativa é registrado mas a data do próximo contato não. Regra que resolve
 * as duas: follow-up sem data agendada não existe, e só pode haver UM aberto por
 * paciente (o banco garante com índice único parcial).
 */

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type FollowupBucket = 'atrasado' | 'hoje' | 'semana' | 'futuro'

export type FollowupAgendaRow = {
  id: string
  leadId: string
  patientName: string
  phone: string | null
  attemptNo: number
  scheduledFor: string
  ownerId: string | null
  channel: string | null
  note: string | null
  pipelineId: string | null
  stageId: string | null
  source: string | null
  bucket: FollowupBucket
  diasAtraso: number
}

export type FollowupHistoryRow = {
  id: string
  leadId: string
  attemptNo: number
  scheduledFor: string
  doneAt: string | null
  channel: string | null
  outcome: string | null
  note: string | null
}

export const FOLLOWUP_CHANNELS = ['WhatsApp', 'Ligação', 'E-mail', 'Presencial']

/** Resultados que aparecem escritos nas planilhas, virados em opção. */
export const FOLLOWUP_OUTCOMES = [
  'Sem resposta',
  'Vai pensar',
  'Pediu para chamar depois',
  'Sem condições agora',
  'Quer remarcar a consulta',
  'Fechou',
  'Não fechou',
]

export async function listFollowupAgenda(): Promise<FollowupAgendaRow[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('v_followup_agenda')
    .select(
      'id, lead_id, patient_name, phone, attempt_no, scheduled_for, owner_id, channel, note, pipeline_id, stage_id, source, bucket, dias_atraso',
    )
    .order('scheduled_for', { ascending: true })
    .limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    const str = (v: unknown) => (v == null || String(v).length === 0 ? null : String(v))
    return {
      id: String(row.id),
      leadId: String(row.lead_id),
      patientName: String(row.patient_name ?? ''),
      phone: str(row.phone),
      attemptNo: Number(row.attempt_no ?? 1),
      scheduledFor: String(row.scheduled_for),
      ownerId: str(row.owner_id),
      channel: str(row.channel),
      note: str(row.note),
      pipelineId: str(row.pipeline_id),
      stageId: str(row.stage_id),
      source: str(row.source),
      bucket: (row.bucket as FollowupBucket) ?? 'futuro',
      diasAtraso: Number(row.dias_atraso ?? 0),
    }
  })
}

/**
 * O follow-up em colunas, do jeito que a gerente desenhou: 1º, 2º e 3º contato,
 * não convertido e encerrado.
 *
 * A coluna é do PACIENTE, não da tentativa — por isso vem da view, que já reduz o
 * histórico a uma linha por lead. Ninguém arrasta card aqui: registrar o contato
 * move para a coluna seguinte, e é o registro que interessa. Card que anda porque
 * alguém arrastou é a planilha de novo, com o mesmo problema de 2022 (a coluna
 * "2º contato" preenchida sem que ligação nenhuma tenha acontecido).
 */
export type KanbanColuna = 'contato_1' | 'contato_2' | 'contato_3' | 'nao_convertido' | 'encerrado'

export const KANBAN_COLUNAS: Array<{ id: KanbanColuna; label: string; hint: string }> = [
  { id: 'contato_1', label: '1º contato', hint: 'Primeira tentativa marcada' },
  { id: 'contato_2', label: '2º contato', hint: 'Já teve uma tentativa' },
  { id: 'contato_3', label: '3º contato', hint: 'Terceira tentativa ou mais' },
  {
    id: 'nao_convertido',
    label: 'Não convertido · potencial futuro',
    hint: 'Saiu da fila sem fechar. Volta quando for a hora',
  },
  {
    id: 'encerrado',
    label: 'Encerrado · cirurgia do mês seguinte',
    hint: 'Fechou ou o atendimento terminou',
  },
]

export type KanbanCard = {
  followupId: string
  leadId: string
  patientName: string
  phone: string | null
  attemptNo: number
  scheduledFor: string
  doneAt: string | null
  outcome: string | null
  note: string | null
  coluna: KanbanColuna
  diasAtraso: number
  vendaId: string | null
  cirurgiaEm: string | null
}

export async function listFollowupKanban(): Promise<KanbanCard[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('v_followup_kanban')
    .select(
      'followup_id, lead_id, patient_name, phone, attempt_no, scheduled_for, done_at, outcome, note, ' +
        'coluna, dias_atraso, venda_id, cirurgia_em',
    )
    .order('scheduled_for', { ascending: true })
    .limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>
    const str = (v: unknown) => (v == null || String(v).length === 0 ? null : String(v))
    return {
      followupId: String(row.followup_id),
      leadId: String(row.lead_id),
      patientName: String(row.patient_name ?? ''),
      phone: str(row.phone),
      attemptNo: Number(row.attempt_no ?? 1),
      scheduledFor: String(row.scheduled_for),
      doneAt: str(row.done_at),
      outcome: str(row.outcome),
      note: str(row.note),
      coluna: (row.coluna as KanbanColuna) ?? 'contato_1',
      diasAtraso: Number(row.dias_atraso ?? 0),
      vendaId: str(row.venda_id),
      cirurgiaEm: str(row.cirurgia_em),
    }
  })
}

/**
 * Traz de volta para a fila quem estava em "não convertido".
 *
 * É o "potencial futuro" da coluna virando ação: a paciente que disse "ano que
 * vem" precisa de uma data, senão o card vira lápide.
 */
export async function reabrirFollowup(leadId: string, scheduledFor: string, note?: string | null) {
  await scheduleFollowup({ leadId, scheduledFor, note: note ?? 'Reaberto do potencial futuro' })
}

export async function listLeadFollowups(leadId: string): Promise<FollowupHistoryRow[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('lead_followups')
    .select('id, lead_id, attempt_no, scheduled_for, done_at, channel, outcome, note')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: String(row.id),
      leadId: String(row.lead_id),
      attemptNo: Number(row.attempt_no ?? 1),
      scheduledFor: String(row.scheduled_for),
      doneAt: row.done_at != null ? String(row.done_at) : null,
      channel: row.channel != null ? String(row.channel) : null,
      outcome: row.outcome != null ? String(row.outcome) : null,
      note: row.note != null ? String(row.note) : null,
    }
  })
}

/**
 * Agenda o próximo contato. Se já existe um em aberto, ele é reagendado em vez
 * de criar um segundo: duas datas em aberto para o mesmo paciente é a bagunça da
 * planilha de volta.
 */
export async function scheduleFollowup(payload: {
  leadId: string
  scheduledFor: string
  channel?: string | null
  note?: string | null
  ownerId?: string | null
}): Promise<void> {
  const client = assertClient()
  if (!payload.scheduledFor) throw new Error('Escolha a data do próximo contato.')

  const { data: aberto, error: abertoErr } = await client
    .from('lead_followups')
    .select('id')
    .eq('lead_id', payload.leadId)
    .is('done_at', null)
    .maybeSingle()
  if (abertoErr) throw new Error(abertoErr.message)

  if (aberto) {
    const { error } = await client
      .from('lead_followups')
      .update({
        scheduled_for: payload.scheduledFor,
        channel: payload.channel || null,
        note: payload.note?.trim() || null,
        owner_id: payload.ownerId || null,
      })
      .eq('id', String((aberto as { id: unknown }).id))
    if (error) throw new Error(error.message)
    return
  }

  const { count, error: countErr } = await client
    .from('lead_followups')
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', payload.leadId)
  if (countErr) throw new Error(countErr.message)

  const { error } = await client.from('lead_followups').insert({
    lead_id: payload.leadId,
    attempt_no: (count ?? 0) + 1,
    scheduled_for: payload.scheduledFor,
    channel: payload.channel || null,
    note: payload.note?.trim() || null,
    owner_id: payload.ownerId || null,
  })
  if (error) throw new Error(error.message)
}

/**
 * Fecha a tentativa e já agenda a próxima quando houver. Sem `nextDate`, o
 * paciente sai da fila: usar só quando fechou, não fechou de vez, ou virou venda.
 */
export async function completeFollowup(payload: {
  id: string
  leadId: string
  outcome: string
  note?: string | null
  channel?: string | null
  nextDate?: string | null
}): Promise<void> {
  const client = assertClient()
  const { error } = await client
    .from('lead_followups')
    .update({
      done_at: new Date().toISOString(),
      outcome: payload.outcome,
      note: payload.note?.trim() || null,
      channel: payload.channel || null,
    })
    .eq('id', payload.id)
  if (error) throw new Error(error.message)

  if (payload.nextDate) {
    await scheduleFollowup({ leadId: payload.leadId, scheduledFor: payload.nextDate })
  }
}

/** Pacientes parados em "Consulta Realizada" no funil da Dandara, esperando dono. */
export type PostConsultationLead = {
  id: string
  patientName: string
  phone: string | null
  source: string | null
  stageEnteredAt: string | null
  diasParado: number
}

export async function listPostConsultation(): Promise<PostConsultationLead[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('leads')
    .select('id, patient_name, phone, source, stage_entered_at, created_at')
    .eq('pipeline_id', 'pipeline-clinica')
    .eq('stage_id', 'stage-1777902160674')
    .is('deleted_at', null)
    .order('stage_entered_at', { ascending: true })
    .limit(300)
  if (error) throw new Error(error.message)
  const hoje = Date.now()
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    const entrou = row.stage_entered_at != null ? String(row.stage_entered_at) : null
    const base = entrou ?? (row.created_at != null ? String(row.created_at) : null)
    return {
      id: String(row.id),
      patientName: String(row.patient_name ?? ''),
      phone: row.phone != null ? String(row.phone) : null,
      source: row.source != null ? String(row.source) : null,
      stageEnteredAt: entrou,
      diasParado: base ? Math.floor((hoje - new Date(base).getTime()) / 86400000) : 0,
    }
  })
}

const DESTINOS = {
  cirurgia: { pipeline: 'pipeline-processo-cirurgico', stage: 'cir-consulta-realizada' },
  protocolo: { pipeline: 'pipeline-protocolos', stage: 'pro-consulta-realizada' },
} as const

/**
 * Manda o paciente da consulta para o funil da Aline ou da Ingrid e já deixa o
 * primeiro follow-up agendado. Sem essa data o card entra no funil novo e repete
 * o que acontece hoje: fica parado esperando alguém lembrar dele.
 */
export async function routeAfterConsultation(
  leadId: string,
  destino: keyof typeof DESTINOS,
  opts?: { ownerId?: string | null; primeiroContatoEm?: string },
): Promise<void> {
  const client = assertClient()
  const alvo = DESTINOS[destino]
  const { error } = await client
    .from('leads')
    .update({
      pipeline_id: alvo.pipeline,
      stage_id: alvo.stage,
      stage_entered_at: new Date().toISOString(),
      owner_id: opts?.ownerId || undefined,
    })
    .eq('id', leadId)
  if (error) throw new Error(error.message)

  const amanha = opts?.primeiroContatoEm ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  await scheduleFollowup({
    leadId,
    scheduledFor: amanha,
    channel: 'WhatsApp',
    note: destino === 'cirurgia' ? 'Primeiro contato pós-consulta (cirúrgico)' : 'Primeiro contato pós-consulta (protocolo)',
    ownerId: opts?.ownerId ?? null,
  })
}
