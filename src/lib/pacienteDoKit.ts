// Quem recebe o kit. A busca de paciente da montagem só olhava o cadastro do CRM (leads), e o
// SPA atende muita gente que existe só no Shosp: em 22/09 "Humberto Mozzer" estava na agenda
// (prontuário 7097) e não aparecia de jeito nenhum, e a baixa do kit do SPA travava ali.
// Aqui junta as duas fontes numa lista só, sem repetir quem está nas duas.

export type PacienteDoKit = {
  /** Id do item na busca: `lead:<id>` quando tem cadastro no CRM, `shosp:<prontuário>` quando não. */
  chave: string
  nome: string
  leadId: string | null
  prontuario: string | null
  telefone: string | null
  /** Só nas sugestões da agenda do dia. */
  horario?: string | null
  prestador?: string | null
  data?: string | null
}

export type LeadAchado = { id: string; name: string; phone: string }
export type PacienteShospAchado = { prontuario: string; nome: string; leadId: string | null; celular: string | null }

export function juntarPacientes(leads: LeadAchado[], shosp: PacienteShospAchado[]): PacienteDoKit[] {
  const lista: PacienteDoKit[] = leads.map((l) => ({
    chave: `lead:${l.id}`,
    nome: l.name,
    leadId: l.id,
    prontuario: null,
    telefone: l.phone || null,
  }))
  const porLead = new Map(lista.map((p) => [p.leadId, p] as const))
  const prontuarios = new Set<string>()
  for (const s of shosp) {
    if (!s.prontuario || prontuarios.has(s.prontuario)) continue
    prontuarios.add(s.prontuario)
    const doCrm = s.leadId ? porLead.get(s.leadId) : undefined
    if (doCrm) {
      // Está nas duas: fica a linha do CRM, que ganha o prontuário para desempatar homônimo.
      doCrm.prontuario = s.prontuario
      continue
    }
    lista.push({
      chave: s.leadId ? `lead:${s.leadId}` : `shosp:${s.prontuario}`,
      nome: s.nome,
      leadId: s.leadId,
      prontuario: s.prontuario,
      telefone: s.celular,
    })
  }
  // Duas fichas do Shosp apontando para o mesmo lead viram uma linha só.
  const chaves = new Set<string>()
  return lista.filter((p) => !chaves.has(p.chave) && chaves.add(p.chave))
}

/** Segunda linha da busca: de onde veio e o que desempata dois nomes iguais. */
export function dicaDoPaciente(p: PacienteDoKit): string {
  const partes = [
    p.horario ? `${p.horario}${p.prestador ? ` · ${p.prestador}` : ''}` : null,
    p.leadId ? 'CRM' : 'Shosp, sem cadastro no CRM',
    p.prontuario ? `prontuário ${p.prontuario}` : null,
    p.telefone,
  ]
  return partes.filter(Boolean).join(' · ')
}

export type HorarioDaAgenda = {
  prontuario: string | null
  leadId: string | null
  nome: string
  horario: string | null
  prestador: string | null
  status: string | null
  data: string
}

/**
 * Agenda do dia virando sugestão: sem desmarcado nem falta, um paciente uma vez só (o primeiro horário),
 * por horário. No kit do SPA, os horários do Spa Capilar vêm primeiro; no da cirurgia, os demais.
 */
export function sugestoesDaAgenda(horarios: HorarioDaAgenda[], setor: 'cirurgia' | 'spa' | null): PacienteDoKit[] {
  const ehSpa = (h: HorarioDaAgenda) => /^spa\b/i.test((h.prestador ?? '').trim())
  const peso = (h: HorarioDaAgenda) => (setor === 'spa' ? (ehSpa(h) ? 0 : 1) : setor === 'cirurgia' ? (ehSpa(h) ? 1 : 0) : 0)
  const vistos = new Set<string>()
  return horarios
    .filter((h) => h.nome.trim() && !/desmarcad|cancelad|faltou/i.test(h.status ?? ''))
    .sort((a, b) => peso(a) - peso(b) || (a.horario ?? '').localeCompare(b.horario ?? ''))
    .filter((h) => {
      const chave = h.leadId ?? h.prontuario ?? h.nome.trim().toLowerCase()
      if (vistos.has(chave)) return false
      vistos.add(chave)
      return true
    })
    .map((h) => ({
      chave: h.leadId ? `lead:${h.leadId}` : h.prontuario ? `shosp:${h.prontuario}` : `agenda:${h.nome}`,
      nome: h.nome.trim(),
      leadId: h.leadId,
      prontuario: h.prontuario,
      telefone: null,
      horario: h.horario,
      prestador: h.prestador,
      data: h.data,
    }))
}
