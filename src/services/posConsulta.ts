import { diaLocalComOffset, hojeLocal } from '@/lib/diaLocal'
import { supabase } from '@/lib/supabaseClient'

import { scheduleFollowup } from './leadFollowups'

/**
 * Fila de pós-consulta: quem saiu da consulta e ainda não tem destino.
 *
 * A fila NÃO espera ninguém arrastar card. Ela lê a agenda: consulta médica cujo
 * horário já passou, que não foi desmarcada nem marcada como falta, é gente que
 * esteve aqui hoje. Quem decide o que aparece é a RPC `crm_pos_consulta_fila` —
 * o front só mostra e registra o destino.
 *
 * Por que a leitura vem de RPC e não de `.from(...)`: a fila mistura três origens
 * (agenda Shosp, lead parado na etapa antiga, inclusão à mão) e depende de hora
 * local. Fazer isso em três consultas no cliente devolveria três verdades.
 */

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type OrigemItem = 'agenda' | 'funil' | 'manual'

/** Cirurgia e protocolo mudam de funil. Follow-up só marca o retorno combinado. */
export type Destino = 'cirurgia' | 'protocolo' | 'followup'

export type FilaItem = {
  itemId: string
  origem: OrigemItem
  leadId: string | null
  prontuario: string | null
  paciente: string
  telefone: string | null
  consultaEm: string | null
  horario: string | null
  prestador: string | null
  servico: string | null
  statusAgenda: string | null
  origemLead: string | null
  diasParado: number
}

const texto = (v: unknown): string | null =>
  v == null || String(v).length === 0 ? null : String(v)

export async function listFilaPosConsulta(dias = 7): Promise<FilaItem[]> {
  const { data, error } = await assertClient().rpc('crm_pos_consulta_fila', { p_dias: dias })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    itemId: String(r.item_id),
    origem: (String(r.origem ?? 'agenda') as OrigemItem),
    leadId: texto(r.lead_id),
    prontuario: texto(r.prontuario),
    paciente: String(r.paciente ?? '—'),
    telefone: texto(r.telefone),
    consultaEm: texto(r.consulta_em),
    // A Shosp devolve '10:45' na grade e '10:45:00' na agenda por paciente.
    horario: texto(r.horario)?.slice(0, 5) ?? null,
    prestador: texto(r.prestador),
    servico: texto(r.servico),
    statusAgenda: texto(r.status_agenda),
    origemLead: texto(r.origem_lead),
    diasParado: Number(r.dias_parado ?? 0),
  }))
}

export type ForaDaFilaRow = {
  itemId: string
  leadId: string | null
  paciente: string
  outcome: string
  reason: string | null
  consultaEm: string | null
  resolvedAt: string
}

/** Só os dispensados: quem foi encaminhado saiu da fila por ter destino, não por decisão de ignorar. */
export async function listForaDaFila(): Promise<ForaDaFilaRow[]> {
  const { data, error } = await assertClient()
    .from('post_consultation_resolutions')
    .select('item_id, lead_id, paciente, outcome, reason, consulta_em, resolved_at')
    .eq('outcome', 'dispensado')
    .order('resolved_at', { ascending: false })
    .limit(300)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    itemId: String(r.item_id),
    leadId: texto(r.lead_id),
    paciente: String(r.paciente ?? '—'),
    outcome: String(r.outcome),
    reason: texto(r.reason),
    consultaEm: texto(r.consulta_em),
    resolvedAt: String(r.resolved_at),
  }))
}

/**
 * Tira da fila sem dar destino.
 *
 * Serve para o que encaminhar seria pior que não fazer nada: paciente que já é
 * acompanhado, retorno que a agenda não soube separar, e contato que nunca foi
 * paciente. Ninguém é apagado — o card e o histórico ficam. Reversível por
 * `devolverParaFila`.
 */
export async function dispensarItens(
  itens: FilaItem[],
  reason: string,
  ctx: { tenantId: string; usuarioId?: string | null },
): Promise<number> {
  if (itens.length === 0) return 0
  const { data, error } = await assertClient()
    .from('post_consultation_resolutions')
    .upsert(
      itens.map((i) => ({
        item_id: i.itemId,
        tenant_id: ctx.tenantId,
        lead_id: i.leadId,
        prontuario: i.prontuario,
        paciente: i.paciente,
        consulta_em: i.consultaEm,
        outcome: 'dispensado',
        reason: reason.trim() || null,
        resolved_by: ctx.usuarioId ?? null,
      })),
      { onConflict: 'item_id' },
    )
    .select('item_id')
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

export async function devolverParaFila(itemId: string): Promise<void> {
  const { error } = await assertClient()
    .from('post_consultation_resolutions')
    .delete()
    .eq('item_id', itemId)
  if (error) throw new Error(error.message)
}

/** Inclusão à mão: consulta encaixada, ou paciente que a agenda não pegou. */
export async function adicionarNaFila(input: {
  tenantId: string
  paciente: string
  leadId?: string | null
  prontuario?: string | null
  telefone?: string | null
  consultaEm?: string | null
  nota?: string | null
  usuarioId?: string | null
}): Promise<void> {
  const { error } = await assertClient().from('post_consultation_manual_items').insert({
    tenant_id: input.tenantId,
    lead_id: input.leadId || null,
    prontuario: input.prontuario || null,
    paciente: input.paciente.trim(),
    telefone: input.telefone || null,
    consulta_em: input.consultaEm || hojeLocal(),
    nota: input.nota?.trim() || null,
    created_by: input.usuarioId ?? null,
  })
  if (error) throw new Error(error.message)
}

const DESTINOS = {
  cirurgia: {
    pipeline: 'pipeline-processo-cirurgico',
    stage: 'cir-consulta-realizada',
    nota: 'Primeiro contato pós-consulta (cirúrgico)',
  },
  protocolo: {
    pipeline: 'pipeline-protocolos',
    stage: 'pro-consulta-realizada',
    nota: 'Primeiro contato pós-consulta (protocolo)',
  },
  // Ainda não é venda nenhuma: o paciente saiu dizendo que dá retorno. O card não
  // muda de funil, só ganha data de contato — é o que a Aline pediu para não ter
  // de registrar venda que não aconteceu.
  followup: {
    pipeline: null,
    stage: null,
    nota: 'Primeiro contato pós-consulta (vai dar retorno)',
  },
} as const

export const DESTINO_LABEL: Record<Destino, string> = {
  cirurgia: 'funil cirúrgico',
  protocolo: 'funil de protocolos',
  followup: 'follow-up',
}

const soDigitos = (v: string) => v.replace(/\D/g, '')

/** Telefone no formato em que o CRM grava: dígitos com 55 na frente. */
function telefoneCrm(bruto: string | null): string {
  const d = soDigitos(bruto ?? '')
  if (!d) return ''
  if (d.startsWith('55') && d.length >= 12) return d
  if (d.length === 10 || d.length === 11) return `55${d}`
  return d
}

/**
 * Paciente que veio da agenda pode não ter card (Shosp tem ~3.200 pessoas, o
 * kanban não). O card nasce só aqui, no clique que diz "vou falar com ele" — é o
 * momento em que ele deixa de ser cadastro e passa a ser negociação.
 */
async function criarCardDoPaciente(
  item: FilaItem,
  destino: Destino,
  ctx: { tenantId: string; ownerId: string },
): Promise<string> {
  const client = assertClient()
  const alvo = DESTINOS[destino]
  const agora = new Date().toISOString()
  const id = `lead-pos-consulta-${Date.now()}`
  const { error } = await client.from('leads').insert({
    id,
    patient_name: item.paciente,
    phone: telefoneCrm(item.telefone),
    source: 'consulta_presencial',
    created_at: agora,
    position: 1,
    score: 0,
    temperature: 'hot',
    owner_id: ctx.ownerId,
    pipeline_id: alvo.pipeline ?? 'pipeline-clinica',
    stage_id: alvo.stage ?? 'stage-1777902160674',
    summary: [
      'Card criado na fila de pós-consulta.',
      item.consultaEm ? `Consulta em ${item.consultaEm}` : null,
      item.prestador ? `com ${item.prestador}` : null,
      item.servico ? `· ${item.servico}` : null,
    ]
      .filter(Boolean)
      .join(' '),
    custom_fields: {},
    conversation_status: 'new',
    last_interaction_at: agora,
    tenant_id: ctx.tenantId,
    ...(item.prontuario ? { shosp_prontuario: item.prontuario } : {}),
  })
  if (error) throw new Error(error.message)
  return id
}

/**
 * Dá destino ao item da fila: manda para o funil cirúrgico, para o de protocolos
 * ou só marca o retorno combinado — e em todos os casos deixa o primeiro contato
 * com DATA. Sem data o card entra no funil novo e repete o que acontecia antes:
 * fica parado esperando alguém lembrar dele.
 */
export async function encaminharItem(
  item: FilaItem,
  destino: Destino,
  ctx: {
    tenantId: string
    ownerId: string
    contatoEm?: string
    canal?: string
    nota?: string | null
    usuarioId?: string | null
  },
): Promise<{ leadId: string; cardCriado: boolean }> {
  const client = assertClient()
  const alvo = DESTINOS[destino]

  const cardCriado = !item.leadId
  const leadId = item.leadId ?? (await criarCardDoPaciente(item, destino, ctx))

  // Card que já existia muda de funil; o que acabou de nascer já nasceu no lugar.
  //
  // O `.select('id')` não é enfeite: card de paciente que também compra cápsula
  // mora no polo do Tricopill, e a RLS devolve ZERO LINHA sem erro nenhum. Em
  // 18/08/2026 o Robson José saiu da fila com o toast "foi para o funil de
  // protocolos" e o card dele continuou, intacto, no funil de vendas do outro
  // polo. Sem linha de volta, o encaminhamento falha aqui — antes de criar
  // follow-up e antes de tirar o paciente da fila.
  if (!cardCriado && alvo.pipeline && alvo.stage) {
    const { data: movidos, error } = await client
      .from('leads')
      .update({
        pipeline_id: alvo.pipeline,
        stage_id: alvo.stage,
        stage_entered_at: new Date().toISOString(),
      })
      .eq('id', leadId)
      .select('id')
    if (error) throw new Error(error.message)
    if ((movidos ?? []).length === 0) {
      throw new Error(
        `O card de ${item.paciente} não pôde ser movido para o ${DESTINO_LABEL[destino]}: ele está fora do alcance deste polo. ` +
          'Marque o retorno pelo Follow-up ou fale com quem administra o card.',
      )
    }
  }

  await scheduleFollowup({
    leadId,
    scheduledFor: ctx.contatoEm ?? diaLocalComOffset(1),
    channel: ctx.canal ?? 'WhatsApp',
    note: ctx.nota?.trim() || alvo.nota,
    ownerId: ctx.ownerId,
  })

  const { error: resErr } = await client.from('post_consultation_resolutions').upsert(
    {
      item_id: item.itemId,
      tenant_id: ctx.tenantId,
      lead_id: leadId,
      prontuario: item.prontuario,
      paciente: item.paciente,
      consulta_em: item.consultaEm,
      outcome: destino,
      reason: ctx.nota?.trim() || null,
      resolved_by: ctx.usuarioId ?? null,
    },
    { onConflict: 'item_id' },
  )
  if (resErr) throw new Error(resErr.message)

  return { leadId, cardCriado }
}
