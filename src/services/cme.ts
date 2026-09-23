import type { PacoteParaEtiqueta } from '@/lib/etiquetaCme'
import { buscarTudo } from '@/lib/supabasePaginate'
import { supabase } from '@/lib/supabaseClient'

// CME: autoclaves, colaboradores, materiais, ciclos e pacotes. As regras (número do ciclo, código
// do pacote, validade, o que pode entrar num kit) moram no banco (migration 20260923180000).

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type Autoclave = { id: string; nome: string; codigo: string; metodo: string }
export type Colaborador = { id: string; nome: string }
export type MaterialCme = { id: string; nome: string; embalagem: string | null; validadeDias: number; ativo: boolean }
export type StatusCiclo = 'aberto' | 'aprovado' | 'reprovado'
export type CicloCme = {
  id: string
  autoclaveId: string
  autoclave: string
  numero: number
  lote: string
  metodo: string
  iniciadoEm: string
  responsavel: string
  status: StatusCiclo
  indicadorQuimico: string | null
  indicadorBiologico: string | null
  resultadoPor: string | null
  resultadoEm: string | null
  observacao: string | null
  pacotes: number
}
export type SituacaoPacote = 'ok' | 'ciclo_aberto' | 'reprovado' | 'vencido' | 'usado' | 'descartado'
export type PacoteCme = PacoteParaEtiqueta & {
  id: string
  cicloId: string
  kitId: string | null
  paciente: string | null
  usadoEm: string | null
  descartadoEm: string | null
  situacao: SituacaoPacote
}

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })

export async function listarAutoclaves(): Promise<Autoclave[]> {
  const { data, error } = await assertClient().from('cme_autoclaves').select('id, nome, codigo, metodo').eq('ativo', true).order('codigo')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({ id: String(r.id), nome: String(r.nome), codigo: String(r.codigo), metodo: String(r.metodo) }))
}

export async function listarColaboradores(): Promise<Colaborador[]> {
  const { data, error } = await assertClient().from('cme_colaboradores').select('id, nome').eq('ativo', true).order('nome')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({ id: String(r.id), nome: String(r.nome) }))
}

export async function adicionarColaborador(nome: string): Promise<void> {
  const limpo = nome.trim().replace(/\s+/g, ' ')
  if (limpo.length < 2) throw new Error('Escreva o nome do colaborador.')
  const client = assertClient()
  // Quem já existiu e foi retirado volta, em vez de dar erro de nome repetido.
  const { data: antigo } = await client.from('cme_colaboradores').select('id').ilike('nome', limpo).maybeSingle()
  const { error } = antigo
    ? await client.from('cme_colaboradores').update({ ativo: true }).eq('id', (antigo as { id: string }).id)
    : await client.from('cme_colaboradores').insert({ nome: limpo })
  if (error) throw new Error(error.message)
}

export async function retirarColaborador(id: string): Promise<void> {
  const { error } = await assertClient().from('cme_colaboradores').update({ ativo: false }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listarMateriais(incluirInativos = false): Promise<MaterialCme[]> {
  let q = assertClient().from('cme_materiais').select('id, nome, embalagem, validade_dias, ativo')
  if (!incluirInativos) q = q.eq('ativo', true)
  const { data, error } = await q.order('nome')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: String(r.id),
    nome: String(r.nome),
    embalagem: r.embalagem != null ? String(r.embalagem) : null,
    validadeDias: Number(r.validade_dias),
    ativo: Boolean(r.ativo),
  }))
}

export async function salvarMaterial(m: { id?: string; nome: string; embalagem: string; validadeDias: number; ativo?: boolean }): Promise<void> {
  const nome = m.nome.trim().replace(/\s+/g, ' ')
  if (nome.length < 2) throw new Error('Escreva o nome do material.')
  if (!Number.isInteger(m.validadeDias) || m.validadeDias < 1) throw new Error('A validade é em dias, um número inteiro maior que zero.')
  const row = {
    nome,
    embalagem: m.embalagem.trim() || null,
    validade_dias: m.validadeDias,
    ativo: m.ativo ?? true,
    updated_at: new Date().toISOString(),
  }
  const client = assertClient()
  const { error } = m.id ? await client.from('cme_materiais').update(row).eq('id', m.id) : await client.from('cme_materiais').insert(row)
  if (error) {
    if (error.code === '23505') throw new Error(`Já existe um material chamado ${nome}.`)
    throw new Error(error.message)
  }
}

function mapCiclo(r: Record<string, unknown>, pacotes: number): CicloCme {
  const ac = (r.cme_autoclaves ?? {}) as Record<string, unknown>
  return {
    id: String(r.id),
    autoclaveId: String(r.autoclave_id),
    autoclave: String(ac.nome ?? ''),
    numero: Number(r.numero),
    lote: String(r.lote),
    metodo: String(r.metodo),
    iniciadoEm: String(r.iniciado_em),
    responsavel: String(r.responsavel),
    status: (r.status === 'aprovado' || r.status === 'reprovado' ? r.status : 'aberto') as StatusCiclo,
    indicadorQuimico: r.indicador_quimico != null ? String(r.indicador_quimico) : null,
    indicadorBiologico: r.indicador_biologico != null ? String(r.indicador_biologico) : null,
    resultadoPor: r.resultado_por != null ? String(r.resultado_por) : null,
    resultadoEm: r.resultado_em != null ? String(r.resultado_em) : null,
    observacao: r.observacao != null ? String(r.observacao) : null,
    pacotes,
  }
}

export async function listarCiclos(limite = 60): Promise<CicloCme[]> {
  const client = assertClient()
  const { data, error } = await client
    .from('cme_ciclos')
    .select('*, cme_autoclaves(nome)')
    .order('iniciado_em', { ascending: false })
    .limit(limite)
  if (error) throw new Error(error.message)
  const ids = (data ?? []).map((r) => String(r.id))
  const contagem = new Map<string, number>()
  if (ids.length > 0) {
    const pacotes = await buscarTudo<{ ciclo_id: unknown }>(
      () => client.from('cme_pacotes').select('ciclo_id').in('ciclo_id', ids).order('id'),
      { rotulo: 'cme_pacotes (contagem)' },
    )
    for (const p of pacotes) contagem.set(String(p.ciclo_id), (contagem.get(String(p.ciclo_id)) ?? 0) + 1)
  }
  return (data ?? []).map((r) => mapCiclo(r as Record<string, unknown>, contagem.get(String(r.id)) ?? 0))
}

/** Próximo número de ciclo de cada autoclave (o último + 1). */
export async function proximosNumeros(): Promise<Map<string, number>> {
  const { data, error } = await assertClient().from('cme_ciclos').select('autoclave_id, numero').order('numero', { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  const m = new Map<string, number>()
  for (const r of data ?? []) if (!m.has(String(r.autoclave_id))) m.set(String(r.autoclave_id), Number(r.numero) + 1)
  return m
}

export async function abrirCiclo(p: {
  autoclaveId: string
  numero: number | null
  responsavel: string
  itens: Array<{ materialId: string; qtd: number }>
}): Promise<string> {
  const itens = p.itens.filter((i) => i.qtd > 0)
  if (itens.length === 0) throw new Error('Coloque ao menos um pacote no ciclo.')
  const { data, error } = await assertClient().rpc('cme_ciclo_abrir', {
    p_autoclave: p.autoclaveId,
    p_numero: p.numero,
    p_responsavel: p.responsavel,
    p_itens: itens.map((i) => ({ material_id: i.materialId, qtd: i.qtd })),
  })
  if (error) throw new Error(error.message)
  return String(data)
}

export async function registrarResultado(p: {
  cicloId: string
  aprovado: boolean
  quimico: string
  biologico: string
  por: string
  observacao: string
}): Promise<void> {
  const { error } = await assertClient().rpc('cme_ciclo_resultado', {
    p_ciclo: p.cicloId,
    p_aprovado: p.aprovado,
    p_quimico: p.quimico,
    p_biologico: p.biologico,
    p_por: p.por,
    p_obs: p.observacao,
  })
  if (error) throw new Error(error.message)
}

const SELECT_PACOTE =
  'id, ciclo_id, codigo, material_nome, esterilizado_em, validade, responsavel, kit_id, paciente, usado_em, descartado_em, cme_ciclos(lote, metodo, status, cme_autoclaves(nome))'

function situacaoDo(r: Record<string, unknown>, statusCiclo: string): SituacaoPacote {
  if (r.descartado_em) return 'descartado'
  if (r.usado_em) return 'usado'
  if (statusCiclo === 'reprovado') return 'reprovado'
  if (String(r.validade) < hoje()) return 'vencido'
  if (statusCiclo === 'aberto') return 'ciclo_aberto'
  return 'ok'
}

function mapPacote(r: Record<string, unknown>): PacoteCme {
  const c = (r.cme_ciclos ?? {}) as Record<string, unknown>
  const ac = (c.cme_autoclaves ?? {}) as Record<string, unknown>
  return {
    id: String(r.id),
    cicloId: String(r.ciclo_id),
    codigo: String(r.codigo),
    materialNome: String(r.material_nome),
    lote: String(c.lote ?? ''),
    autoclave: String(ac.nome ?? ''),
    metodo: String(c.metodo ?? ''),
    esterilizadoEm: String(r.esterilizado_em),
    validade: String(r.validade),
    responsavel: String(r.responsavel),
    kitId: r.kit_id != null ? String(r.kit_id) : null,
    paciente: r.paciente != null ? String(r.paciente) : null,
    usadoEm: r.usado_em != null ? String(r.usado_em) : null,
    descartadoEm: r.descartado_em != null ? String(r.descartado_em) : null,
    situacao: situacaoDo(r, String(c.status ?? 'aberto')),
  }
}

export async function listarPacotesDoCiclo(cicloId: string): Promise<PacoteCme[]> {
  const { data, error } = await assertClient().from('cme_pacotes').select(SELECT_PACOTE).eq('ciclo_id', cicloId).order('codigo')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapPacote(r as Record<string, unknown>))
}

export async function acharPacote(codigo: string): Promise<PacoteCme | null> {
  const { data, error } = await assertClient().from('cme_pacotes').select(SELECT_PACOTE).eq('codigo', codigo.trim()).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapPacote(data as Record<string, unknown>) : null
}

/** Pacotes na prateleira (sem uso, sem retirada) que vencem até `dias` daqui (ou já venceram). */
export async function listarPacotesVencendo(dias: number): Promise<PacoteCme[]> {
  const limite = new Date()
  limite.setDate(limite.getDate() + dias)
  const { data, error } = await assertClient()
    .from('cme_pacotes')
    .select(SELECT_PACOTE)
    .is('usado_em', null)
    .is('descartado_em', null)
    .lte('validade', limite.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }))
    .order('validade')
    .limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapPacote(r as Record<string, unknown>))
}

export async function usarPacotesNoKit(codigos: string[], kitId: string): Promise<number> {
  if (codigos.length === 0) return 0
  const { data, error } = await assertClient().rpc('cme_pacotes_usar', { p_codigos: codigos, p_kit: kitId })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export async function retirarPacote(codigo: string, motivo: string): Promise<void> {
  const { error } = await assertClient().rpc('cme_pacote_descartar', { p_codigo: codigo, p_motivo: motivo })
  if (error) throw new Error(error.message)
}

export const SITUACAO_PACOTE: Record<SituacaoPacote, { rotulo: string; bom: boolean }> = {
  ok: { rotulo: 'Liberado para uso', bom: true },
  ciclo_aberto: { rotulo: 'Aguardando resultado do ciclo', bom: false },
  reprovado: { rotulo: 'Ciclo reprovado: não usar', bom: false },
  vencido: { rotulo: 'Vencido: reprocessar', bom: false },
  usado: { rotulo: 'Já usado', bom: false },
  descartado: { rotulo: 'Retirado para reprocessar', bom: false },
}
