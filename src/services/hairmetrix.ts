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
  comEvolucao: number
  vinculados: number
  primeiroExameEm: string | null
  ultimoExameEm: string | null
}

/**
 * Uma linha por (exame, região) com tudo que a máquina mediu. É a base do laudo:
 * a tela antiga mostrava 11 das 25 colunas e jogava fora justamente o histograma
 * de espessura, que é o gráfico que explica o tratamento para o paciente.
 */
export type PontoSerie = {
  exameId: string
  captureId: string
  capturadoEm: string
  regiao: string | null
  dispositivo: string | null
  serialDispositivo: string | null
  unidadesFoliculares: number
  fiosValidos: number
  fiosPorUf: number | null
  densidadeUfCm2: number | null
  densidadeFiosCm2: number | null
  espessuraMediaUm: number | null
  espessuraP10Um: number | null
  espessuraMedianaUm: number | null
  /** segmento visível do fio dentro do quadro, em mm */
  comprimentoMedioMm: number | null
  pctFiosFinos: number | null
  espessuraHist: Record<string, unknown> | null
  roiAreaMm2: number | null
  /** contra o exame anterior da MESMA região */
  deltaDensidadePct: number | null
  deltaEspessuraPct: number | null
  deltaFinosPp: number | null
  /** contra o primeiro exame da MESMA região */
  baseDensidadePct: number | null
  baseEspessuraPct: number | null
  baseFinosPp: number | null
  diasDesdeBase: number | null
}

export type CabecalhoPaciente = {
  id: string
  mirrorPatientId: string
  nomePasta: string
  totalExames: number
  primeiroExameEm: string | null
  ultimoExameEm: string | null
  vinculoStatus: VinculoStatus
  leadId: string | null
  leadNome: string | null
  leadTelefone: string | null
  shospProntuario: string | null
  /** > 1 significa que a série atravessa troca de VISIOMED: comparação fica suja. */
  aparelhos: number
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

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export async function serieDoPaciente(pacienteId: string): Promise<PontoSerie[]> {
  const { data, error } = await assertClient().rpc('hairmetrix_serie_paciente', {
    p_paciente_id: pacienteId,
  })
  if (error) throw new Error(error.message)

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    exameId: String(r.exame_id ?? ''),
    captureId: String(r.capture_id ?? ''),
    capturadoEm: String(r.capturado_em ?? ''),
    regiao: (r.regiao as string) ?? null,
    dispositivo: (r.dispositivo as string) ?? null,
    serialDispositivo: (r.serial_dispositivo as string) ?? null,
    unidadesFoliculares: Number(r.unidades_foliculares ?? 0),
    fiosValidos: Number(r.fios_validos ?? 0),
    fiosPorUf: num(r.fios_por_uf),
    densidadeUfCm2: num(r.densidade_uf_cm2),
    densidadeFiosCm2: num(r.densidade_fios_cm2),
    espessuraMediaUm: num(r.espessura_media_um),
    espessuraP10Um: num(r.espessura_p10_um),
    espessuraMedianaUm: num(r.espessura_mediana_um),
    comprimentoMedioMm: num(r.comprimento_medio_mm),
    pctFiosFinos: num(r.pct_fios_finos),
    espessuraHist: (r.espessura_hist as Record<string, unknown>) ?? null,
    roiAreaMm2: num(r.roi_area_mm2),
    deltaDensidadePct: num(r.delta_densidade_pct),
    deltaEspessuraPct: num(r.delta_espessura_pct),
    deltaFinosPp: num(r.delta_finos_pp),
    baseDensidadePct: num(r.base_densidade_pct),
    baseEspessuraPct: num(r.base_espessura_pct),
    baseFinosPp: num(r.base_finos_pp),
    diasDesdeBase: num(r.dias_desde_base),
  }))
}

/** Cabeçalho do laudo. Existe para a tela abrir por URL direta, sem passar pela lista. */
export async function cabecalhoDoPaciente(pacienteId: string): Promise<CabecalhoPaciente | null> {
  const { data, error } = await assertClient().rpc('hairmetrix_paciente_cabecalho', {
    p_paciente_id: pacienteId,
  })
  if (error) throw new Error(error.message)

  const r = ((data ?? []) as Record<string, unknown>[])[0]
  if (!r) return null

  return {
    id: String(r.id ?? ''),
    mirrorPatientId: String(r.mirror_patient_id ?? ''),
    nomePasta: String(r.nome_pasta ?? ''),
    totalExames: Number(r.total_exames ?? 0),
    primeiroExameEm: (r.primeiro_exame_em as string) ?? null,
    ultimoExameEm: (r.ultimo_exame_em as string) ?? null,
    vinculoStatus: (r.vinculo_status as VinculoStatus) ?? 'pendente',
    leadId: (r.lead_id as string) ?? null,
    leadNome: (r.lead_nome as string) ?? null,
    leadTelefone: (r.lead_telefone as string) ?? null,
    shospProntuario: (r.shosp_prontuario as string) ?? null,
    aparelhos: Number(r.aparelhos ?? 0),
  }
}

/**
 * Estado do agente. Existe porque endpoint verde não prova nada: sem isto o sync
 * morre calado e a gente só descobre quando a recepção reclama que faltou exame.
 *
 * Eram cinco consultas com `head: true`; virou uma RPC porque `com_evolucao`
 * (paciente com 2+ exames) não sai de um count simples, e é o número que diz
 * quanta evolução existe de verdade para olhar.
 */
export async function estadoDoSync(): Promise<EstadoSync> {
  const { data, error } = await assertClient().rpc('hairmetrix_panorama')
  if (error) throw new Error(error.message)

  const r = ((data ?? []) as Record<string, unknown>[])[0] ?? {}
  return {
    ultimaRodada: (r.ultima_sync_em as string) ?? null,
    exames: Number(r.exames ?? 0),
    medidas: Number(r.medidas ?? 0),
    pacientes: Number(r.pacientes ?? 0),
    pendentes: Number(r.pendentes ?? 0),
    comEvolucao: Number(r.com_evolucao ?? 0),
    vinculados: Number(r.vinculados ?? 0),
    primeiroExameEm: (r.primeiro_exame_em as string) ?? null,
    ultimoExameEm: (r.ultimo_exame_em as string) ?? null,
  }
}
