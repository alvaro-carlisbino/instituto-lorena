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
  const arr = Array.isArray(dados) ? (dados as Record<string, unknown>[]) : []
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
