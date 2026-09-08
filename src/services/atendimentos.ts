import { diaLocal, hojeLocal } from '@/lib/diaLocal'
import { supabase } from '@/lib/supabaseClient'

import { scheduleFollowup } from './leadFollowups'

/**
 * O atendimento do médico como fato: consulta ou retorno em que o transplante (ou o
 * protocolo) foi indicado.
 *
 * É a primeira linha da planilha da Aline e era o que faltava no CRM. O follow-up conta o
 * TRABALHO (quantas vezes ligamos); o atendimento conta a SAFRA (quantas pessoas saíram do
 * consultório com indicação, e quantas dessas fecharam). Sem a safra não existe "quanto
 * fechou a semana" — só existe "quantas ligações estão marcadas", que é outra pergunta.
 */

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type IndicacaoAtendimento = 'cirurgia' | 'protocolo'
export type TipoAtendimento = 'consulta' | 'retorno'
/** De onde a linha veio. `venda` é histórico: só existe porque fechou. Ver `SAFRA_COMPLETA_DESDE`. */
export type FonteAtendimento = 'manual' | 'pos_consulta' | 'venda'

export type Atendimento = {
  id: string
  leadId: string | null
  paciente: string
  telefone: string | null
  cidade: string | null
  email: string | null
  origem: string | null
  tipo: TipoAtendimento
  indicacao: IndicacaoAtendimento
  atendidoEm: string
  medico: string | null
  observacao: string | null
  fonte: FonteAtendimento
  fechou: boolean
  vendaEm: string | null
  valorCents: number | null
  /** Onde o paciente está hoje no quadro de follow-up. Null = nunca entrou na fila. */
  coluna: string | null
}

/**
 * A partir de quando a safra é confiável.
 *
 * Antes da fila de pós-consulta (19/ago/2026) o CRM só guardava o atendimento que VIROU
 * VENDA — a consulta que não fechou não deixava rastro em lugar nenhum. Semana anterior a
 * isso fecha em quase 100% por construção, e a tela precisa dizer isso em vez de mostrar
 * um número bonito e falso.
 */
export const SAFRA_COMPLETA_DESDE = '2026-08-24'

const texto = (v: unknown): string | null =>
  v == null || String(v).length === 0 ? null : String(v)

const CAMPOS =
  'id, lead_id, paciente, telefone, cidade, email, origem, tipo, indicacao, atendido_em, ' +
  'medico, observacao, venda_em, valor_cents, fechou, coluna, fonte'

function mapear(row: Record<string, unknown>): Atendimento {
  return {
    id: String(row.id),
    leadId: texto(row.lead_id),
    paciente: String(row.paciente ?? '—'),
    telefone: texto(row.telefone),
    cidade: texto(row.cidade),
    email: texto(row.email),
    origem: texto(row.origem),
    tipo: (row.tipo === 'retorno' ? 'retorno' : 'consulta') as TipoAtendimento,
    indicacao: (row.indicacao === 'protocolo' ? 'protocolo' : 'cirurgia') as IndicacaoAtendimento,
    atendidoEm: String(row.atendido_em),
    medico: texto(row.medico),
    observacao: texto(row.observacao),
    fonte: (row.fonte as FonteAtendimento) ?? 'manual',
    fechou: row.fechou === true,
    vendaEm: texto(row.venda_em),
    valorCents: row.valor_cents == null ? null : Number(row.valor_cents),
    coluna: texto(row.coluna),
  }
}

export async function listAtendimentos(input: {
  indicacao: IndicacaoAtendimento
  desde: string
  ate?: string
}): Promise<Atendimento[]> {
  const { data, error } = await assertClient()
    .from('v_clinic_atendimentos')
    .select(CAMPOS)
    .eq('indicacao', input.indicacao)
    .gte('atendido_em', input.desde)
    .lte('atendido_em', input.ate ?? hojeLocal())
    .order('atendido_em', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapear)
}

// ---------------------------------------------------------------------------
// A semana
// ---------------------------------------------------------------------------

export type SemanaAtendimentos = {
  /** Segunda-feira da semana, YYYY-MM-DD. */
  inicio: string
  /** Domingo da semana, YYYY-MM-DD. */
  fim: string
  atendimentos: number
  fecharam: number
  /** null quando a semana não teve atendimento nenhum: 0/0 não é 0%. */
  pct: number | null
  receitaCents: number
  /**
   * Semana em que o CRM só conhece quem fechou. A taxa sai por cima e não vale comparar
   * com as de agora.
   */
  incompleta: boolean
}

/** Segunda-feira da semana daquele dia, no calendário local (a semana da clínica começa na segunda). */
export function segundaDaSemana(dia: string): string {
  const d = new Date(`${dia.slice(0, 10)}T12:00:00`)
  const diaDaSemana = (d.getDay() + 6) % 7 // 0 = segunda
  d.setDate(d.getDate() - diaDaSemana)
  return diaLocal(d)
}

const somaDias = (dia: string, n: number) => {
  const d = new Date(`${dia.slice(0, 10)}T12:00:00`)
  d.setDate(d.getDate() + n)
  return diaLocal(d)
}

/**
 * Agrupa a safra por semana, da mais recente para a mais antiga.
 *
 * Semana sem atendimento nenhum não vira linha: a Aline quer comparar semanas de trabalho,
 * e linha vazia no meio só empurra a semana passada para fora da tela.
 */
export function resumoPorSemana(linhas: Atendimento[], quantas = 6): SemanaAtendimentos[] {
  const mapa = new Map<string, Atendimento[]>()
  for (const a of linhas) {
    const inicio = segundaDaSemana(a.atendidoEm)
    const lista = mapa.get(inicio)
    if (lista) lista.push(a)
    else mapa.set(inicio, [a])
  }
  return [...mapa.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, quantas)
    .map(([inicio, itens]) => {
      const fecharam = itens.filter((i) => i.fechou)
      return {
        inicio,
        fim: somaDias(inicio, 6),
        atendimentos: itens.length,
        fecharam: fecharam.length,
        pct: itens.length === 0 ? null : Math.round((fecharam.length / itens.length) * 100),
        receitaCents: fecharam.reduce((t, i) => t + (i.valorCents ?? 0), 0),
        // Basta UM atendimento que só existe por ter virado venda para a semana estar
        // torta: o que não fechou naquela semana nunca foi registrado.
        incompleta: inicio < SAFRA_COMPLETA_DESDE || itens.some((i) => i.fonte === 'venda'),
      }
    })
}

// ---------------------------------------------------------------------------
// Registrar à mão
// ---------------------------------------------------------------------------

const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')

/** Telefone no formato em que o CRM grava: dígitos com 55 na frente. */
function telefoneCrm(bruto: string | null | undefined): string {
  const d = soDigitos(bruto)
  if (!d) return ''
  if (d.startsWith('55') && d.length >= 12) return d
  if (d.length === 10 || d.length === 11) return `55${d}`
  return d
}

const DESTINO = {
  cirurgia: { pipeline: 'pipeline-processo-cirurgico', stage: 'cir-consulta-realizada' },
  protocolo: { pipeline: 'pipeline-protocolos', stage: 'pro-consulta-realizada' },
} as const

/**
 * Acha o paciente que já existe pelo telefone, dentro do polo.
 *
 * Os oito últimos dígitos, e não o número inteiro: o mesmo telefone está gravado com e sem
 * o 9, com e sem o 55. E o `tenant_id` explícito não é redundância com a RLS — em 04/set a
 * landing casou telefone em QUALQUER polo e fundiu a triagem da clínica no lead da loja.
 */
async function acharPaciente(telefone: string, tenantId: string): Promise<string | null> {
  const fone8 = soDigitos(telefone).slice(-8)
  if (fone8.length < 8) return null
  const { data, error } = await assertClient()
    .from('leads')
    .select('id, created_at')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .ilike('phone', `%${fone8}%`)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const achado = (data ?? [])[0] as { id?: unknown } | undefined
  return achado?.id ? String(achado.id) : null
}

export type NovoAtendimento = {
  tenantId: string
  ownerId: string
  paciente: string
  telefone?: string | null
  cidade?: string | null
  email?: string | null
  origem?: string | null
  tipo: TipoAtendimento
  indicacao: IndicacaoAtendimento
  atendidoEm: string
  medico?: string | null
  observacao?: string | null
  /** Quando ela vai fazer o primeiro contato. Sem data o card não entra na fila de ninguém. */
  primeiroContatoEm: string
  usuarioId?: string | null
}

/**
 * Registra o atendimento e coloca o paciente na coluna "Atendimentos".
 *
 * Faz três coisas de uma vez porque na cabeça dela é uma só ("anotei o atendimento"):
 * garante o card do paciente, grava o fato na safra e abre o primeiro contato com data.
 * O card do paciente que já existe NÃO muda de funil aqui — mudar funil é decisão de
 * triagem, e ela tem o "Passar para..." no card para isso.
 */
export async function registrarAtendimento(
  input: NovoAtendimento,
): Promise<{ leadId: string; pacienteNovo: boolean }> {
  const client = assertClient()
  const nome = input.paciente.trim()
  if (!nome) throw new Error('Escreva o nome do paciente.')

  const fone = telefoneCrm(input.telefone)
  const existente = fone ? await acharPaciente(fone, input.tenantId) : null
  const pacienteNovo = !existente
  let leadId = existente ?? ''

  if (!leadId) {
    const alvo = DESTINO[input.indicacao]
    const agora = new Date().toISOString()
    leadId = `lead-atendimento-${Date.now()}`
    const { error } = await client.from('leads').insert({
      id: leadId,
      patient_name: nome,
      phone: fone,
      source: 'consulta_presencial',
      created_at: agora,
      position: 1,
      score: 0,
      temperature: 'hot',
      owner_id: input.ownerId,
      pipeline_id: alvo.pipeline,
      stage_id: alvo.stage,
      summary: [
        `Atendimento registrado à mão (${input.tipo}) em ${input.atendidoEm}.`,
        input.medico ? `Médico: ${input.medico}.` : null,
        input.origem ? `Origem: ${input.origem}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
      custom_fields: {},
      conversation_status: 'new',
      last_interaction_at: agora,
      tenant_id: input.tenantId,
    })
    if (error) throw new Error(error.message)
  }

  const { error: atErr } = await client.from('clinic_atendimentos').insert({
    tenant_id: input.tenantId,
    lead_id: leadId,
    paciente: nome,
    telefone: fone || null,
    cidade: input.cidade?.trim() || null,
    email: input.email?.trim() || null,
    origem: input.origem?.trim() || null,
    tipo: input.tipo,
    indicacao: input.indicacao,
    atendido_em: input.atendidoEm,
    medico: input.medico?.trim() || null,
    observacao: input.observacao?.trim() || null,
    fonte: 'manual',
    created_by: input.usuarioId ?? null,
  })
  if (atErr) throw new Error(atErr.message)

  await scheduleFollowup({
    leadId,
    scheduledFor: input.primeiroContatoEm,
    channel: 'WhatsApp',
    note:
      input.observacao?.trim() ||
      `Atendimento ${input.tipo === 'retorno' ? 'de retorno' : 'de consulta'} com indicação de ${
        input.indicacao === 'protocolo' ? 'protocolo' : 'transplante'
      }`,
    ownerId: input.ownerId,
  })

  return { leadId, pacienteNovo }
}
