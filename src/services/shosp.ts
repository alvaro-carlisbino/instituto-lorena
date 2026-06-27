import { supabase } from '@/lib/supabaseClient'

export type ShospSlot = {
  codigoHorario?: number
  horario: string
  paciente?: string
  status?: string
  codigoAgendamento?: number
  planoSaude?: string
  servico?: string
}
export type ShospDay = { data: string; diaSemana: string; slots: ShospSlot[] }
export type ShospPrestadorAgenda = { codigoPrestador: number; nomePrestador: string; days: ShospDay[] }

/** Agenda real da Shosp (grade de um prestador: livres + ocupados) via edge function. */
export async function fetchShospAgenda(params: {
  codigoPrestador: number
  dataInicial?: string
  diasMostrar?: number
}): Promise<ShospPrestadorAgenda[]> {
  if (!supabase) return []
  const { data, error } = await supabase.functions.invoke('crm-shosp', {
    body: {
      mode: 'availability',
      codigoPrestador: params.codigoPrestador,
      codigoUnidade: 1,
      dataInicial: params.dataInicial,
      diasMostrar: params.diasMostrar ?? 15,
    },
  })
  if (error) throw new Error(error.message)
  const dados = (data as { data?: { dados?: unknown } })?.data?.dados
  // `dados` vem aninhado da Shosp (ex.: [[{prestador}]]). Achata recursivamente
  // e fica só com objetos de prestador (que têm `horarios`).
  const flat: Record<string, unknown>[] = []
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk)
    else if (x && typeof x === 'object') flat.push(x as Record<string, unknown>)
  }
  walk(dados)
  const arr = flat.filter((o) => 'horarios' in o)
  return arr.map((p) => {
    const horarios = (p.horarios ?? {}) as Record<string, { data: string; diaSemana: string; horario?: Record<string, unknown>[] }>
    return {
      codigoPrestador: Number(p.codigoPrestador),
      nomePrestador: String(p.nomePrestador ?? ''),
      days: Object.values(horarios).map((d) => ({
        data: d.data,
        diaSemana: d.diaSemana,
        slots: (d.horario ?? []).map((h) => ({
          codigoHorario: h.codigoHorario as number | undefined,
          horario: String(h.horario ?? ''),
          paciente: h.paciente as string | undefined,
          status: h.status as string | undefined,
          codigoAgendamento: h.codigoAgendamento as number | undefined,
          planoSaude: h.planoSaude as string | undefined,
          servico: h.servico as string | undefined,
        })),
      })),
    }
  })
}

/** Lista de prestadores Shosp (da tabela espelho). */
export async function fetchShospPrestadores(): Promise<Array<{ codigo: string; nome: string }>> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('shosp_reference')
    .select('codigo, nome')
    .eq('kind', 'prestador')
    .order('nome')
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ codigo: string; nome: string }>
}

/** Lista de serviços Shosp (da tabela espelho). */
export async function fetchShospServicos(): Promise<Array<{ codigo: string; nome: string; valor: string | null }>> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('shosp_reference')
    .select('codigo, nome, payload')
    .eq('kind', 'servico')
    .order('nome')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ codigo: string; nome: string; payload: { valor?: string | null } }>).map((s) => ({
    codigo: s.codigo,
    nome: s.nome,
    valor: s.payload?.valor ?? null,
  }))
}

export type ScheduleInput = {
  codigoPrestador: number
  codigoUnidade: number
  codigoServico: number
  codigoPlanoSaude: number
  data: string
  horario: string
  codigoHorario: number
  nome: string
  telefone: string
  email: string
  dataNascimento: string
  sexo: string
  codigoPaciente?: number | string
}

/** Agenda na Shosp (POST /agenda/). Devolve codigoAgendamento + codigoPaciente. */
export async function scheduleShospAppointment(
  input: ScheduleInput,
): Promise<{ ok: boolean; codigoAgendamento?: number; codigoPaciente?: string; error?: string }> {
  if (!supabase) return { ok: false, error: 'Sistema não configurado.' }
  const { data, error } = await supabase.functions.invoke('crm-shosp', {
    body: { mode: 'schedule', agendamento: input },
  })
  if (error) return { ok: false, error: error.message }
  const res = data as { ok?: boolean; data?: { ret?: string; dados?: { codigoAgendamento?: number; codigoPaciente?: string }; error?: string } }
  const dados = res?.data?.dados
  if (!res?.ok || !dados?.codigoAgendamento) {
    return { ok: false, error: res?.data?.error || 'Falha ao agendar na Shosp.' }
  }
  return { ok: true, codigoAgendamento: dados.codigoAgendamento, codigoPaciente: dados.codigoPaciente }
}

/** Cancela um agendamento na Shosp (POST /agenda/cancelaragendamento). */
export async function cancelShospAppointment(codigoAgendamento: number): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Sistema não configurado.' }
  const { data, error } = await supabase.functions.invoke('crm-shosp', {
    body: { mode: 'cancel', codigoAgendamento },
  })
  if (error) return { ok: false, error: error.message }
  const res = data as { ok?: boolean; data?: { ret?: string } }
  return { ok: Boolean(res?.ok && res?.data?.ret === '1') }
}

/** Grava o vínculo lead→paciente Shosp (prontuário) após agendar pelo CRM. */
export async function linkLeadToShospPatient(leadId: string, prontuario: string | number): Promise<void> {
  if (!supabase) return
  await supabase.from('leads').update({ shosp_prontuario: String(prontuario) }).eq('id', leadId)
}

/** Remove o vínculo lead→paciente Shosp. */
export async function unlinkLeadShospPatient(leadId: string): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('leads').update({ shosp_prontuario: null }).eq('id', leadId)
  if (error) throw new Error(error.message)
}

/** Prontuário Shosp atualmente vinculado ao lead (null se não vinculado). */
export async function getLeadShospProntuario(leadId: string): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('leads').select('shosp_prontuario').eq('id', leadId).maybeSingle()
  if (error) return null
  return (data as { shosp_prontuario?: string | null } | null)?.shosp_prontuario ?? null
}

export type ShospPatientCandidate = {
  prontuario: string
  nome: string
  celular?: string
  telefone?: string
  cpf?: string
  dataNascimento?: string
}

/** Extrai a lista de pacientes da resposta Shosp (array OU objeto-por-código em `dados`). */
function shospDadosArray(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return []
  const dados = (data as Record<string, unknown>).dados
  if (Array.isArray(dados)) return dados as Record<string, unknown>[]
  if (dados && typeof dados === 'object') return Object.values(dados as Record<string, unknown>) as Record<string, unknown>[]
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  return []
}

function mapShospCandidate(c: Record<string, unknown>): ShospPatientCandidate | null {
  const prontuario = String(c.prontuario ?? c.codigo ?? '').trim()
  if (!prontuario) return null
  const payload = (c.payload && typeof c.payload === 'object' ? c.payload : {}) as Record<string, unknown>
  return {
    prontuario,
    nome: String(c.nome ?? payload.nome ?? ''),
    celular: c.celular != null ? String(c.celular) : undefined,
    telefone: c.telefone != null ? String(c.telefone) : undefined,
    cpf: c.cpf != null ? String(c.cpf) : undefined,
    dataNascimento:
      c.dataNascimento != null
        ? String(c.dataNascimento)
        : c.nascimento != null
          ? String(c.nascimento)
          : payload.nascimento != null
            ? String(payload.nascimento)
            : undefined,
  }
}

/**
 * Busca pacientes para vincular um lead. Primeiro no ESPELHO local (`shosp_patients`), que é
 * tolerante: casa por CPF ou por CADA palavra do nome (ordem/parcial não importam) — resolve o
 * caso em que a busca por nome exato na Shosp não achava ninguém (ex.: Wagner Quiuli Diniz). Se o
 * espelho não trouxer nada (paciente recém-cadastrado, ainda não sincronizado), cai na Shosp ao vivo.
 */
export async function searchShospPatients(params: { nome: string; cpf?: string }): Promise<ShospPatientCandidate[]> {
  if (!supabase) return []
  const raw = String(params.nome ?? '').trim()
  const digits = String(params.cpf ?? raw).replace(/\D/g, '')

  // 1) Espelho local (confiável e tolerante a nome parcial/fora de ordem)
  let q = supabase.from('shosp_patients').select('prontuario, nome, cpf, celular, telefone, payload').limit(25)
  if (digits.length >= 6) {
    q = q.ilike('cpf', `%${digits}%`)
  } else {
    const tokens = raw.split(/\s+/).filter((t) => t.length >= 2).slice(0, 6)
    for (const t of tokens) q = q.ilike('nome', `%${t}%`)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const fromMirror = ((data ?? []) as Record<string, unknown>[])
    .map(mapShospCandidate)
    .filter((x): x is ShospPatientCandidate => x !== null)
  if (fromMirror.length) return fromMirror

  // 2) Fallback: Shosp ao vivo (nome como cadastrado lá). Erro aqui não derruba a busca.
  const { data: live, error: liveErr } = await supabase.functions.invoke('crm-shosp', {
    body: { mode: 'find_patient', nome: raw, cpf: params.cpf },
  })
  if (liveErr) return []
  const res = live as { ok?: boolean; data?: unknown }
  return shospDadosArray(res?.data)
    .map(mapShospCandidate)
    .filter((x): x is ShospPatientCandidate => x !== null)
}
