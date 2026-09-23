// Conferência do SPA: a agenda do Spa Capilar no Shosp × os kits montados. O SPA marca o mesmo
// paciente em vários horários seguidos (12h, 13h, 14h com profissionais diferentes), e um kit
// cobre o dia: a conferência é por paciente e dia, não por horário.

export type LinhaConferenciaSpa = {
  tipo: 'atendimento' | 'kit_sem_agenda'
  codigoAgendamento: string | null
  data: string
  horario: string | null
  prestador: string | null
  paciente: string
  prontuario: string | null
  leadId: string | null
  status: string | null
  semMaterial: boolean
  kitId: string | null
  kitNome: string | null
  kitStatus: string | null
}

export type SituacaoSpa = 'com_kit' | 'sem_material' | 'pendente'

export type AtendimentoSpa = {
  chave: string
  data: string
  paciente: string
  prontuario: string | null
  horarios: string[]
  profissionais: string[]
  /** Todos os horários do paciente no dia: "não usa material" vale para todos. */
  agendamentos: string[]
  /** O primeiro horário: é por ele que o atalho abre a montagem. */
  primeiroAgendamento: string | null
  kits: Array<{ id: string; nome: string; status: string | null }>
  situacao: SituacaoSpa
}

const profissional = (prestador: string | null) =>
  (prestador ?? '').replace(/^\s*spa\s+capilar\s*-?\s*/i, '').trim() || (prestador ?? '')

const titulo = (s: string) =>
  s
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|\s)(\p{L})/gu, (_, sep: string, l: string) => sep + l.toLocaleUpperCase('pt-BR'))

export function agruparAtendimentos(linhas: LinhaConferenciaSpa[]): AtendimentoSpa[] {
  const grupos = new Map<string, AtendimentoSpa>()
  // Marca "sem material" de cada horário: um horário marcado não esconde outro do mesmo dia.
  const semMaterial = new Map<string, boolean[]>()
  const doDia = linhas
    .filter((l) => l.tipo === 'atendimento')
    .sort((a, b) => (a.horario ?? '').localeCompare(b.horario ?? ''))
  for (const l of doDia) {
    const quem = l.prontuario ?? l.leadId ?? l.paciente.trim().toLowerCase()
    const chave = `${l.data}|${quem}`
    let g = grupos.get(chave)
    if (!g) {
      g = {
        chave,
        data: l.data,
        paciente: titulo(l.paciente.trim()),
        prontuario: l.prontuario,
        horarios: [],
        profissionais: [],
        agendamentos: [],
        primeiroAgendamento: l.codigoAgendamento,
        kits: [],
        situacao: 'pendente',
      }
      grupos.set(chave, g)
    }
    // O Shosp manda "08:00" ou "12:00:00" conforme a sincronização que gravou o horário.
    const hora = l.horario?.slice(0, 5)
    if (hora && !g.horarios.includes(hora)) g.horarios.push(hora)
    const prof = titulo(profissional(l.prestador))
    if (prof && !g.profissionais.includes(prof)) g.profissionais.push(prof)
    if (l.codigoAgendamento) g.agendamentos.push(l.codigoAgendamento)
    if (l.kitId && !g.kits.some((k) => k.id === l.kitId)) g.kits.push({ id: l.kitId, nome: l.kitNome ?? 'Kit', status: l.kitStatus })
    semMaterial.set(chave, [...(semMaterial.get(chave) ?? []), l.semMaterial])
  }
  for (const g of grupos.values()) {
    g.horarios.sort()
    const marcas = semMaterial.get(g.chave) ?? []
    g.situacao = g.kits.length > 0 ? 'com_kit' : marcas.length > 0 && marcas.every(Boolean) ? 'sem_material' : 'pendente'
  }
  return [...grupos.values()].sort((a, b) => b.data.localeCompare(a.data) || (a.horarios[0] ?? '').localeCompare(b.horarios[0] ?? ''))
}

export function resumoSpa(atendimentos: AtendimentoSpa[]) {
  return {
    total: atendimentos.length,
    comKit: atendimentos.filter((a) => a.situacao === 'com_kit').length,
    semMaterial: atendimentos.filter((a) => a.situacao === 'sem_material').length,
    pendentes: atendimentos.filter((a) => a.situacao === 'pendente').length,
  }
}
