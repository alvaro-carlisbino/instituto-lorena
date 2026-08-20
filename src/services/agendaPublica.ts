import { supabase } from '@/lib/supabaseClient'
import type { AtribuicaoLanding } from '@/lib/atribuicaoLanding'
import type { Horario } from '@/lib/triagemConsulta'

/**
 * Tudo que a landing /consulta lê e escreve.
 *
 * A página roda DESLOGADA, com a chave anon. Por isso só existem aqui três leituras,
 * e as três passam por RPC `security definer` que devolve dado de clínica e nunca de
 * pessoa (ver supabase_rpc_aberta_anon: a chave anon vai no bundle, é pública por
 * definição). A escrita é uma só, pela edge function, que valida do lado de lá.
 */

export type UnidadePublica = {
  id: string
  rotulo: string
  cidade: string
  uf: string
  endereco: string
  modalidade: 'presencial' | 'online'
}

export type NumerosPublicos = {
  cirurgiasRealizadas: number
  foliculosImplantados: number
  desdeAno: number
}

export type EstimativaPublica = {
  esperado: number
  minimo: number
  maximo: number
  amostra: number
}

export type EnvioPreAgendamento = {
  nome: string
  telefone: string
  unidade: string
  slotAt: string | null
  respostas: Record<string, string>
  atribuicao: AtribuicaoLanding
  sessionId: string
  /** Campo-armadilha: fica escondido no formulário e só robô preenche. */
  sobrenome?: string
}

export type RespostaPreAgendamento = {
  ok: boolean
  leadId: string
  prebookingId: string | null
  protocolo: string
  slotAt: string | null
  profissional: string | null
  whatsappUrl: string
  estimativa: EstimativaPublica | null
}

/** Erro com a mensagem que a pessoa deve ler (a do servidor, não a genérica do SDK). */
export class ErroAgenda extends Error {
  codigo: string
  constructor(codigo: string, mensagem: string) {
    super(mensagem)
    this.codigo = codigo
  }
}

export async function carregarUnidades(): Promise<UnidadePublica[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('clinica_unidades_publicas')
  if (error) throw new ErroAgenda('unidades', error.message)
  return (data ?? []).map((u: Record<string, unknown>) => ({
    id: String(u.id),
    rotulo: String(u.rotulo),
    cidade: String(u.cidade ?? ''),
    uf: String(u.uf ?? ''),
    endereco: String(u.endereco ?? ''),
    modalidade: u.modalidade === 'online' ? 'online' : 'presencial',
  }))
}

/**
 * Horários que a clínica pode vender AGORA.
 *
 * A origem é a agenda da Shosp (espelho `shosp_agenda_slots`, atualizado de 30 em
 * 30 minutos), filtrada pelo expediente, pelo feriado e pelo que já foi reservado
 * aqui. O objetivo da triagem entra na conta porque nem todo profissional atende
 * todo caso: sobrancelha, por exemplo, é só com a Dra. Lorena.
 */
export async function carregarHorarios(unidade: string, objetivo?: string, dias = 21): Promise<Horario[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('clinica_agenda_publica', {
    p_unidade: unidade,
    p_dias: dias,
    p_objetivo: objetivo || null,
  })
  if (error) throw new ErroAgenda('agenda', error.message)
  return (data ?? []).map((h: Record<string, unknown>) => ({
    unidadeId: String(h.unidade_id),
    slotAt: new Date(String(h.slot_at)).toISOString(),
    codigoPrestador: h.codigo_prestador ? String(h.codigo_prestador) : '',
    profissional: h.profissional ? String(h.profissional) : '',
  }))
}

export async function carregarNumerosPublicos(): Promise<NumerosPublicos | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('clinica_numeros_publicos')
  if (error) return null
  const linha = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!linha) return null
  return {
    cirurgiasRealizadas: Number(linha.cirurgias_realizadas ?? 0),
    foliculosImplantados: Number(linha.foliculos_implantados ?? 0),
    desdeAno: Number(linha.desde_ano ?? 0),
  }
}

export async function carregarEstimativa(escala: string, grau: string): Promise<EstimativaPublica | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('clinica_estimativa_publica', { p_escala: escala, p_grau: grau })
  if (error) return null
  const linha = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!linha || Number(linha.esperado ?? 0) <= 0) return null
  return {
    esperado: Number(linha.esperado),
    minimo: Number(linha.minimo),
    maximo: Number(linha.maximo),
    amostra: Number(linha.amostra),
  }
}

async function invocar(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!supabase) throw new ErroAgenda('offline', 'Sistema indisponível agora.')
  const { data, error } = await supabase.functions.invoke('crm-agendar-publico', { body })
  if (error) {
    // FunctionsHttpError esconde o corpo em error.context; sem abrir, a pessoa lê
    // "Edge Function returned a non-2xx status code" no lugar de "escolha outro horário".
    let mensagem = error.message
    let codigo = 'falha'
    const ctx = (error as { context?: unknown }).context as
      | { json?: () => Promise<unknown>; clone?: () => Response }
      | undefined
    try {
      if (ctx && typeof ctx.json === 'function') {
        const corpo = (await (ctx.clone ? ctx.clone() : (ctx as unknown as Response)).json()) as {
          message?: string
          error?: string
        }
        mensagem = corpo?.message || corpo?.error || mensagem
        codigo = corpo?.error || codigo
      }
    } catch {
      // corpo ilegível: fica a mensagem do SDK
    }
    throw new ErroAgenda(codigo, mensagem)
  }
  return (data ?? {}) as Record<string, unknown>
}

export async function enviarPreAgendamento(envio: EnvioPreAgendamento): Promise<RespostaPreAgendamento> {
  const p = await invocar({
    nome: envio.nome,
    telefone: envio.telefone,
    unidade: envio.unidade,
    slotAt: envio.slotAt,
    respostas: envio.respostas,
    atribuicao: envio.atribuicao,
    sessionId: envio.sessionId,
    sobrenome: envio.sobrenome ?? '',
  })
  if (p.ok !== true) throw new ErroAgenda(String(p.error ?? 'falha'), String(p.message ?? 'Não consegui concluir.'))
  return {
    ok: true,
    leadId: String(p.leadId ?? ''),
    prebookingId: p.prebookingId ? String(p.prebookingId) : null,
    protocolo: String(p.protocolo ?? ''),
    slotAt: p.slotAt ? String(p.slotAt) : null,
    profissional: p.profissional ? String(p.profissional) : null,
    whatsappUrl: String(p.whatsappUrl ?? ''),
    estimativa: (p.estimativa as EstimativaPublica | null) ?? null,
  }
}

/**
 * Passo do funil. Silencioso de propósito: métrica que quebra a página é pior que
 * métrica que falta (ver crm_sistema_no_ar_e_morto para o caso contrário, o de achar
 * que está tudo bem porque ninguém reclamou).
 */
export function registrarEventoLanding(
  tipo: 'landing_view' | 'landing_triagem' | 'landing_horarios' | 'landing_abandono',
  dados: { sessao: string; atribuicao: AtribuicaoLanding; passo?: string },
): void {
  if (!supabase) return
  void supabase.functions
    .invoke('crm-agendar-publico', {
      body: { action: 'evento', tipo, sessionId: dados.sessao, atribuicao: dados.atribuicao, passo: dados.passo },
    })
    .catch(() => undefined)
}
