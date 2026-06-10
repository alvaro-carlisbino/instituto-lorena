import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { shospAgendaPorPaciente, shospGetAgenda } from './shosp.ts'

/**
 * Contexto Shosp para a Sofia (IA): agendamentos REAIS do paciente + (quando há
 * intenção de agendar) horários livres reais. Injetado no snapshot da
 * crm-ai-assistant para a IA responder "que horário tô marcado?" e propor
 * horários de verdade — sem inventar.
 */

const SCHEDULING_INTENT_RX =
  /agendar|marcar|marca[cç][aã]o|hor[aá]rio|consulta|quando|dispon|vaga|remarcar|desmarcar|cancelar|que dia|melhor dia|tem hor/i

// Médicos principais para propor disponibilidade (códigos Shosp).
const MAIN_PRESTADORES = [
  { codigo: 8, nome: 'Dra. Jaqueline' },
  { codigo: 5, nome: 'Dr. Matheus Amaral' },
  { codigo: 2, nome: 'Dra. Lorena' },
]

function flattenDeep(x: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(x)) x.forEach((i) => flattenDeep(i, out))
  else if (x && typeof x === 'object') out.push(x as Record<string, unknown>)
}

/** porpaciente: { dados: { "YYYY-MM-DD": [ {agendamento} ] } } */
function parsePatientAppointments(data: unknown): Array<Record<string, unknown>> {
  const dados = data && typeof data === 'object' ? (data as Record<string, unknown>).dados : null
  const out: Array<Record<string, unknown>> = []
  if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
    for (const [dateKey, list] of Object.entries(dados as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      for (const a of list as Record<string, unknown>[]) {
        out.push({
          data: String(a.data ?? dateKey),
          horario: a.horario ?? null,
          prestador: a.prestador ?? null,
          servico: a.servico ?? null,
          status: a.status ?? null,
        })
      }
    }
  }
  return out.slice(0, 12)
}

/** Agora em São Paulo: data YYYY-MM-DD + minutos desde a meia-noite. */
function nowSaoPaulo(): { ymd: string; minutesOfDay: number } {
  const now = new Date()
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return { ymd, minutesOfDay: hh * 60 + mm }
}

function hhmmToMinutes(horario: string): number {
  const m = horario.match(/(\d{1,2}):(\d{2})/)
  if (!m) return -1
  return Number(m[1]) * 60 + Number(m[2])
}

/** availability aninhada -> primeiros N horários livres FUTUROS {data, horario}. */
function freeSlots(data: unknown, max = 4): Array<{ data: string; horario: string }> {
  const flat: Record<string, unknown>[] = []
  flattenDeep(data && typeof data === 'object' ? (data as Record<string, unknown>).dados : null, flat)
  const { ymd: todayYmd, minutesOfDay: nowMin } = nowSaoPaulo()
  const BUFFER_MIN = 30 // não oferece horário que começa em menos de 30 min
  const out: Array<{ data: string; horario: string }> = []
  for (const p of flat.filter((o) => 'horarios' in o)) {
    const horarios = (p.horarios ?? {}) as Record<string, { horario?: Record<string, unknown>[] }>
    for (const [date, info] of Object.entries(horarios)) {
      if (date < todayYmd) continue
      for (const h of info.horario ?? []) {
        if (!h.codigoHorario || h.codigoAgendamento) continue
        const horario = String(h.horario ?? '')
        // Hoje: pula horários que já passaram (+ margem).
        if (date === todayYmd && hhmmToMinutes(horario) <= nowMin + BUFFER_MIN) continue
        out.push({ data: date, horario })
        if (out.length >= max) return out
      }
    }
  }
  return out
}

export async function buildShospAiContext(
  admin: SupabaseClient,
  leadId: string,
  lastUserText: string,
  opts: { includeAvailability?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const includeAvailability = opts.includeAvailability !== false
  const { data: lead } = await admin.from('leads').select('shosp_prontuario').eq('id', leadId).maybeSingle()
  const prontuario = (lead as { shosp_prontuario?: string } | null)?.shosp_prontuario
  const out: Record<string, unknown> = {}

  if (prontuario) {
    try {
      const r = await shospAgendaPorPaciente(prontuario)
      const appts = parsePatientAppointments(r.data)
      if (appts.length) {
        out.prontuario = prontuario
        out.agendamentos = appts
      }
    } catch {
      // best-effort
    }
  }

  if (includeAvailability && SCHEDULING_INTENT_RX.test(lastUserText)) {
    const results = await Promise.all(
      MAIN_PRESTADORES.map(async (p) => {
        try {
          const r = await shospGetAgenda({ codigoUnidade: 1, dataInicial: nowSaoPaulo().ymd, diasMostrar: 10, codigoPrestador: p.codigo })
          const slots = freeSlots(r.data, 4)
          return slots.length ? { prestador: p.nome, codigoPrestador: p.codigo, horarios_livres: slots } : null
        } catch {
          return null
        }
      }),
    )
    const disp = results.filter(Boolean)
    if (disp.length) out.disponibilidade = disp

    // Serviços de CONSULTA dos médicos principais — a Sofia precisa do codigoServico
    // certo (por médico + masculino/feminino) para agendar.
    try {
      const { data: servicos } = await admin
        .from('shosp_reference')
        .select('codigo, nome, payload')
        .eq('kind', 'servico')
        .ilike('nome', '%consulta%')
      const consultas = (servicos ?? [])
        .filter((s: { nome: string }) => /jaqueline|lorena|matheus/i.test(s.nome))
        .map((s: { codigo: string; nome: string; payload: { valor?: string | null } }) => ({
          codigoServico: s.codigo,
          nome: s.nome,
          valor: s.payload?.valor ?? null,
        }))
      if (consultas.length) out.servicos_consulta = consultas
    } catch {
      // best-effort
    }
  }

  return Object.keys(out).length ? out : null
}
