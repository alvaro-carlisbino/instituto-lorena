import { supabase } from '@/lib/supabaseClient'
import { type HorarioDaAgenda, type PacienteDoKit, juntarPacientes, sugestoesDaAgenda } from '@/lib/pacienteDoKit'
import { searchLeadsByName } from '@/services/clinicalNotes'

// Busca de paciente do kit: CRM (leads) + espelho do Shosp (shosp_patients / shosp_appointments).
// Só o espelho, sem chamar o Shosp ao vivo: a cota da API já estourou uma vez (429) e o espelho
// cobre quase toda a agenda (1.820 de 1.842 horários do último mês em 22/09).

/** Nome ou telefone. O Shosp falhar (RLS de quem não é da clínica, rede) não derruba a busca do CRM. */
export async function buscarPacientesDoKit(tenantId: string, termo: string): Promise<PacienteDoKit[]> {
  const q = termo.trim()
  if (!supabase || q.length < 2) return []
  const soDigitos = q.replace(/\D/g, '')
  const ehTelefone = soDigitos.length >= 4 && soDigitos === q.replace(/[\s()+-]/g, '')
  // O Shosp guarda o celular formatado, "(44) 99961-5689": os 8 últimos dígitos, com o hífen no
  // meio, casam tanto o celular de 9 dígitos quanto o fixo de 8. Com menos que isso, só o CRM.
  const buscaShosp = ehTelefone
    ? soDigitos.length >= 8
      ? supabase
          .from('shosp_patients')
          .select('prontuario, nome, lead_id, celular')
          .ilike('celular', `%${soDigitos.slice(-8, -4)}-${soDigitos.slice(-4)}%`)
          .limit(25)
          .then((r) => (r.error ? [] : ((r.data ?? []) as unknown[])))
      : Promise.resolve([] as unknown[])
    : supabase.rpc('search_shosp_patients', { q }).then((r) => (r.error ? [] : ((r.data ?? []) as unknown[])))
  const [leads, shosp] = await Promise.all([searchLeadsByName(tenantId, q, 40), buscaShosp])
  return juntarPacientes(
    leads,
    (shosp as Array<Record<string, unknown>>).map((p) => ({
      prontuario: String(p.prontuario ?? ''),
      nome: String(p.nome ?? ''),
      leadId: p.lead_id != null ? String(p.lead_id) : null,
      celular: p.celular != null ? String(p.celular) : null,
    })),
  )
}

/** Quem está na agenda do Shosp no dia: é o que aparece ao abrir a busca, antes de digitar. */
export async function agendaDoDiaParaKit(dia: string, setor: 'cirurgia' | 'spa' | null): Promise<PacienteDoKit[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('shosp_appointments')
    .select('codigo_agendamento, prontuario, lead_id, prestador, horario, status, data, paciente:payload->>paciente')
    .eq('data', dia)
    .order('horario')
    .limit(300)
  if (error) return []
  const horarios: HorarioDaAgenda[] = ((data ?? []) as Array<Record<string, unknown>>).map((h) => ({
    agendamento: h.codigo_agendamento != null ? String(h.codigo_agendamento) : null,
    prontuario: h.prontuario != null ? String(h.prontuario) : null,
    leadId: h.lead_id != null ? String(h.lead_id) : null,
    nome: String(h.paciente ?? ''),
    horario: h.horario != null ? String(h.horario) : null,
    prestador: h.prestador != null ? String(h.prestador) : null,
    status: h.status != null ? String(h.status) : null,
    data: String(h.data ?? dia),
  }))
  return sugestoesDaAgenda(horarios, setor)
}

/** Um horário da agenda do Shosp, para abrir a montagem já com o paciente (conferência do SPA). */
export async function horarioDoShosp(codigoAgendamento: string): Promise<PacienteDoKit | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('shosp_appointments')
    .select('codigo_agendamento, prontuario, lead_id, prestador, horario, status, data, paciente:payload->>paciente')
    .eq('codigo_agendamento', codigoAgendamento)
    .maybeSingle()
  if (error || !data) return null
  const h = data as Record<string, unknown>
  const [p] = sugestoesDaAgenda(
    [
      {
        agendamento: String(h.codigo_agendamento),
        prontuario: h.prontuario != null ? String(h.prontuario) : null,
        leadId: h.lead_id != null ? String(h.lead_id) : null,
        nome: String(h.paciente ?? ''),
        horario: h.horario != null ? String(h.horario) : null,
        prestador: h.prestador != null ? String(h.prestador) : null,
        status: null,
        data: String(h.data ?? ''),
      },
    ],
    null,
  )
  return p ?? null
}
