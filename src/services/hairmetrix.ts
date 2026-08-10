import { supabase } from '@/lib/supabaseClient'

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

/**
 * Tricoscopia do HairMetrix (Canfield Mirror) espelhada no CRM pelo agente que
 * roda na máquina da clínica. Ver scripts/hairmetrix/README.md.
 *
 * REGIÃO É PARTE DA CHAVE CLÍNICA. Occipital é área doadora e não rala; vertex é
 * onde a calvície avança. Somar os pontos num número só, ou comparar um com o
 * outro, dá gráfico bonito e conclusão errada. Toda comparação aqui é dentro da
 * mesma região, e é por isso que a evolução vem agrupada.
 *
 * O vínculo com o lead NUNCA é automático: em prontuário de saúde, casar por
 * semelhança é mostrar o exame de um paciente para outro.
 */

export type VinculoStatus = 'pendente' | 'vinculado' | 'ignorado'

export type PacienteTricoscopia = {
  id: string
  mirrorPatientId: string
  nomePasta: string
  totalExames: number
  primeiroExameEm: string | null
  ultimoExameEm: string | null
  vinculoStatus: VinculoStatus
  leadId: string | null
}

export type PontoEvolucao = {
  capturadoEm: string
  captureId: string
  regiao: string | null
  unidadesFoliculares: number
  fiosValidos: number
  fiosPorUf: number | null
  densidadeFiosCm2: number | null
  espessuraMediaUm: number | null
  pctFiosFinos: number | null
  deltaDensidadePct: number | null
  deltaEspessuraPct: number | null
}

export type SugestaoLead = {
  leadId: string
  patientName: string
  phone: string | null
  shospProntuario: string | null
  score: number
}

export type EstadoSync = {
  ultimaRodada: string | null
  exames: number
  medidas: number
  pacientes: number
  pendentes: number
}

type LinhaPaciente = {
  id: string
  mirror_patient_id: string
  nome_pasta: string
  total_exames: number | null
  primeiro_exame_em: string | null
  ultimo_exame_em: string | null
  vinculo_status: string | null
  lead_id: string | null
}

const mapPaciente = (r: LinhaPaciente): PacienteTricoscopia => ({
  id: r.id,
  mirrorPatientId: r.mirror_patient_id,
  nomePasta: r.nome_pasta,
  totalExames: r.total_exames ?? 0,
  primeiroExameEm: r.primeiro_exame_em,
  ultimoExameEm: r.ultimo_exame_em,
  vinculoStatus: (r.vinculo_status ?? 'pendente') as VinculoStatus,
  leadId: r.lead_id,
})

export async function listarPacientes(
  filtro: 'todos' | VinculoStatus = 'todos',
  busca = '',
  limite = 200,
): Promise<PacienteTricoscopia[]> {
  let q = assertClient()
    .from('hairmetrix_pacientes')
    .select('id, mirror_patient_id, nome_pasta, total_exames, primeiro_exame_em, ultimo_exame_em, vinculo_status, lead_id')
    .gt('total_exames', 0)
    .order('ultimo_exame_em', { ascending: false, nullsFirst: false })
    .limit(limite)

  if (filtro !== 'todos') q = q.eq('vinculo_status', filtro)

  const termo = busca.trim()
  if (termo) {
    // nome_normalizado é minúsculo e sem acento: quem digita "angela" acha "ÂNGELA".
    const alvo = termo
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    q = q.ilike('nome_normalizado', `%${alvo}%`)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return ((data ?? []) as LinhaPaciente[]).map(mapPaciente)
}

export async function evolucaoDoPaciente(pacienteId: string, regiao?: string): Promise<PontoEvolucao[]> {
  const { data, error } = await assertClient().rpc('hairmetrix_evolucao_paciente', {
    p_paciente_id: pacienteId,
    p_regiao: regiao ?? null,
  })
  if (error) throw new Error(error.message)

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    capturadoEm: String(r.capturado_em ?? ''),
    captureId: String(r.capture_id ?? ''),
    regiao: (r.regiao as string) ?? null,
    unidadesFoliculares: Number(r.unidades_foliculares ?? 0),
    fiosValidos: Number(r.fios_validos ?? 0),
    fiosPorUf: r.fios_por_uf === null ? null : Number(r.fios_por_uf),
    densidadeFiosCm2: r.densidade_fios_cm2 === null ? null : Number(r.densidade_fios_cm2),
    espessuraMediaUm: r.espessura_media_um === null ? null : Number(r.espessura_media_um),
    pctFiosFinos: r.pct_fios_finos === null ? null : Number(r.pct_fios_finos),
    deltaDensidadePct: r.delta_densidade_pct === null ? null : Number(r.delta_densidade_pct),
    deltaEspessuraPct: r.delta_espessura_pct === null ? null : Number(r.delta_espessura_pct),
  }))
}

export async function sugerirLeads(pacienteId: string, limite = 8): Promise<SugestaoLead[]> {
  const { data, error } = await assertClient().rpc('hairmetrix_sugerir_leads', {
    p_paciente_id: pacienteId,
    p_limit: limite,
  })
  if (error) throw new Error(error.message)

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    leadId: String(r.lead_id ?? ''),
    patientName: String(r.patient_name ?? ''),
    phone: (r.phone as string) ?? null,
    shospProntuario: (r.shosp_prontuario as string) ?? null,
    score: Number(r.score ?? 0),
  }))
}

export async function vincularLead(pacienteId: string, leadId: string | null): Promise<void> {
  const { error } = await assertClient()
    .from('hairmetrix_pacientes')
    .update({
      lead_id: leadId,
      vinculo_status: leadId ? 'vinculado' : 'pendente',
      vinculo_em: leadId ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pacienteId)
  if (error) throw new Error(error.message)
}

export async function ignorarPaciente(pacienteId: string): Promise<void> {
  const { error } = await assertClient()
    .from('hairmetrix_pacientes')
    .update({ vinculo_status: 'ignorado', updated_at: new Date().toISOString() })
    .eq('id', pacienteId)
  if (error) throw new Error(error.message)
}

/**
 * Estado do agente. Existe porque endpoint verde não prova nada: sem isto o sync
 * morre calado e a gente só descobre quando a recepção reclama que faltou exame.
 */
export async function estadoDoSync(): Promise<EstadoSync> {
  const db = assertClient()
  const [log, exames, medidas, pacientes, pendentes] = await Promise.all([
    db.from('hairmetrix_sync_log').select('finalizado_em').order('iniciado_em', { ascending: false }).limit(1).maybeSingle(),
    db.from('hairmetrix_exames').select('id', { count: 'exact', head: true }),
    db.from('hairmetrix_medidas').select('id', { count: 'exact', head: true }),
    db.from('hairmetrix_pacientes').select('id', { count: 'exact', head: true }).gt('total_exames', 0),
    db.from('hairmetrix_pacientes').select('id', { count: 'exact', head: true }).eq('vinculo_status', 'pendente').gt('total_exames', 0),
  ])

  return {
    ultimaRodada: (log.data?.finalizado_em as string) ?? null,
    exames: exames.count ?? 0,
    medidas: medidas.count ?? 0,
    pacientes: pacientes.count ?? 0,
    pendentes: pendentes.count ?? 0,
  }
}
