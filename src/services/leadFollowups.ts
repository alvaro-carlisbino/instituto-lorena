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
 * O follow-up em colunas: 1º, 2º e 3º contato, em acompanhamento, não convertido
 * e encerrado.
 *
 * A coluna é do PACIENTE, não da tentativa — por isso vem da view, que já reduz o
 * histórico a uma linha por lead. Ninguém arrasta card aqui: registrar o contato
 * move para a coluna seguinte, e é o registro que interessa. Card que anda porque
 * alguém arrastou é a planilha de novo, com o mesmo problema de 2022 (a coluna
 * "2º contato" preenchida sem que ligação nenhuma tenha acontecido).
 */
export type KanbanColuna =
  | 'contato_1'
  | 'contato_2'
  | 'contato_3'
  | 'em_acompanhamento'
  | 'nao_convertido'
  | 'encerrado'

export const KANBAN_COLUNAS: Array<{ id: KanbanColuna; label: string; hint: string }> = [
  { id: 'contato_1', label: '1º contato', hint: 'Primeira tentativa marcada' },
  { id: 'contato_2', label: '2º contato', hint: 'Já teve uma tentativa' },
  { id: 'contato_3', label: '3º contato', hint: 'Terceira tentativa' },
  {
    // Antes esta gente ficava dentro do "3º contato", que era "terceira tentativa
    // OU MAIS": quem estava na sexta ligação e ainda negociando aparecia colado em
    // quem tinha acabado de chegar na terceira. Empurrar para "não convertido"
    // seria pior — não é perdido, tem proposta viva.
    id: 'em_acompanhamento',
    label: 'Em acompanhamento',
    hint: 'Passou dos 3 contatos e segue em negociação',
  },
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
  /** Em qual funil o paciente está: é o que separa a fila da Aline da da Ingrid. */
  pipelineId: string | null
}

export async function listFollowupKanban(): Promise<KanbanCard[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('v_followup_kanban')
    .select(
      'followup_id, lead_id, patient_name, phone, attempt_no, scheduled_for, done_at, outcome, note, ' +
        'coluna, dias_atraso, venda_id, cirurgia_em, pipeline_id',
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
      pipelineId: str(row.pipeline_id),
    }
  })
}

export const FUNIL_CIRURGICO = 'pipeline-processo-cirurgico'
export const FUNIL_PROTOCOLOS = 'pipeline-protocolos'
/** O funil da recepção, antes de a triagem decidir transplante ou protocolo. */
export const FUNIL_TRIAGEM = 'pipeline-clinica'
/**
 * O funil velho do transplante. Não é lixo de migração: tem 183 pacientes e
 * continua recebendo gente pela triagem antiga.
 */
export const FUNIL_TRANSPLANTE_ANTIGO = 'pipeline-tratamento-capilar'

/** As duas filas de transplante: a nova e a que nunca foi migrada. */
export const FUNIS_CIRURGICOS = [FUNIL_CIRURGICO, FUNIL_TRANSPLANTE_ANTIGO]

/**
 * Em qual das duas filas o card aparece.
 *
 * `ambas` é a regra que impede o quadro de comer paciente. Antes a tela partia de
 * uma lista fixa de três funis e escondia o que não estivesse nela: em 19/08/2026
 * o Paulo Cesar recebeu follow-up com data e nota ("Pediu 2 dias para fechar"),
 * sumiu da fila de pós-consulta e não apareceu em lugar nenhum, porque o card
 * dele mora no `pipeline-tratamento-capilar`. Funil que a tela não conhece agora
 * aparece nas duas filas, como já era com a triagem — mostrar duas vezes é ruim,
 * sumir é inaceitável.
 */
export function filaDoFunil(pipelineId: string | null): 'cirurgia' | 'protocolo' | 'ambas' {
  if (pipelineId === FUNIL_PROTOCOLOS) return 'protocolo'
  if (pipelineId != null && FUNIS_CIRURGICOS.includes(pipelineId)) return 'cirurgia'
  return 'ambas'
}

/**
 * Troca o paciente de funil sem perder o follow-up.
 *
 * O caso que pediu isto: paciente passou em consulta de transplante, o médico
 * indicou protocolo, e ele continuava na fila de transplante da Aline. Ela
 * conseguia mover pela ficha do paciente (Encaminhar de funil), mas eram quatro
 * cliques em outra tela, e o follow-up dela ficava para trás.
 *
 * O follow-up em aberto NÃO é tocado de propósito: quem vai virar protocolo
 * continua precisando de contato, na mesma data combinada. Só a fila muda.
 */
export async function moverLeadDeFunil(
  leadId: string,
  destino: 'cirurgia' | 'protocolo',
): Promise<void> {
  const client = assertClient()
  const alvo =
    destino === 'cirurgia'
      ? { pipeline: FUNIL_CIRURGICO, stage: 'cir-follow-up' }
      : { pipeline: FUNIL_PROTOCOLOS, stage: 'pro-follow-up' }
  const { error } = await client
    .from('leads')
    .update({
      pipeline_id: alvo.pipeline,
      stage_id: alvo.stage,
      stage_entered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId)
  if (error) throw new Error(error.message)
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

/** Um card que saiu do quadro: continua no histórico do paciente, só não aparece. */
export type FollowupDispensado = {
  followupId: string
  leadId: string
  patientName: string
  dismissedAt: string
  dismissedReason: string | null
  outcome: string | null
}

/**
 * Tira o paciente do quadro de follow-up.
 *
 * O caso que pediu isto: a coluna "Encerrado" acumula quem fechou, e fechar quase
 * sempre quer dizer que a cirurgia já aconteceu. Em 19/08/2026 eram 28 cards, 24
 * com a cirurgia feita: atendimento terminado, sem contato para marcar, e o card
 * parado ali para sempre.
 *
 * Não fecha follow-up, não muda desfecho, não apaga nota. O histórico continua
 * inteiro na ficha do paciente. Marcar um contato novo devolve o paciente ao
 * quadro sozinho, porque a linha nova nasce sem dispensa.
 */
export async function dispensarFollowups(ids: string[], motivo: string): Promise<number> {
  if (ids.length === 0) return 0
  const client = assertClient()
  const { data: user } = await client.auth.getUser()
  const { data, error } = await client
    .from('lead_followups')
    .update({
      dismissed_at: new Date().toISOString(),
      dismissed_by: user.user?.id ?? null,
      dismissed_reason: motivo.trim() || null,
    })
    .in('id', ids)
    .is('dismissed_at', null)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

/** Devolve ao quadro quem foi tirado. A coluna volta a ser a que a regra disser. */
export async function devolverFollowupAoQuadro(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client
    .from('lead_followups')
    .update({ dismissed_at: null, dismissed_by: null, dismissed_reason: null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Quem está fora do quadro hoje.
 *
 * A view do kanban não devolve estes de propósito, então a lista vem da tabela
 * com o nome do paciente junto: fila zerada sem lugar para conferir o que saiu é
 * exatamente o que faz ninguém confiar no botão de zerar.
 */
export async function listFollowupsDispensados(): Promise<FollowupDispensado[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('lead_followups')
    .select('id, lead_id, dismissed_at, dismissed_reason, outcome, leads!inner(patient_name)')
    .not('dismissed_at', 'is', null)
    .order('dismissed_at', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>
    const lead = (row.leads ?? {}) as Record<string, unknown>
    const str = (v: unknown) => (v == null || String(v).length === 0 ? null : String(v))
    return {
      followupId: String(row.id),
      leadId: String(row.lead_id),
      patientName: String(lead.patient_name ?? ''),
      dismissedAt: String(row.dismissed_at ?? ''),
      dismissedReason: str(row.dismissed_reason),
      outcome: str(row.outcome),
    }
  })
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
        // Reaproveitar a linha em aberto é o que impede duas datas para o mesmo
        // paciente, mas ela pode ter sido tirada do quadro. Marcar contato novo é
        // decidir que ele voltou para a fila, então a dispensa cai aqui: sem isto,
        // o paciente ficaria com data marcada e sem card nenhum na tela.
        dismissed_at: null,
        dismissed_by: null,
        dismissed_reason: null,
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

