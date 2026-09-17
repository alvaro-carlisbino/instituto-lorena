import { type LinhaKardex, mapearLinhaKardex } from '@/lib/kardex'
import { buscarTudo } from '@/lib/supabasePaginate'
import { supabase } from '@/lib/supabaseClient'

// Rastreio do estoque: kardex do item, baixa e estorno pelo banco, endereços dos setores.
// As regras (FEFO por setor, livro de controlados, o que pode ser estornado) moram nas funções
// do banco (migration 20260917190000); aqui só chama e traduz.

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

// ---------------------------------------------------------------- kardex

/** Histórico completo do item (inclui itens de nota consolidados nele), do mais novo ao mais antigo. */
export async function listarKardex(itemId: string): Promise<LinhaKardex[]> {
  const linhas = await buscarTudo<Record<string, unknown>>(
    () =>
      assertClient()
        .rpc('stock_kardex', { p_item_id: itemId })
        .order('created_at', { ascending: false })
        .order('seq', { ascending: false }),
    { rotulo: 'stock_kardex', maxPaginas: 20 },
  )
  return linhas.map(mapearLinhaKardex)
}

// ---------------------------------------------------------------- baixa e estorno

/**
 * Saída do estoque num setor, por FEFO, com custo do lote e livro de controlados. Controlado
 * sem paciente é recusado pelo banco. Serve para a saída manual e para a bipagem.
 */
export async function baixarEstoque(payload: {
  setorId: string | null
  itens: Array<{ itemId: string; qty: number }>
  motivo?: string
  paciente?: string
  origem: 'manual' | 'bipagem'
}): Promise<{ movimentos: number; controlados: number }> {
  const itens = payload.itens.filter((i) => i.itemId && i.qty > 0)
  if (itens.length === 0) throw new Error('Inclua ao menos um item com quantidade.')
  const { data, error } = await assertClient().rpc('stock_baixar', {
    p_setor: payload.setorId,
    p_itens: itens.map((i) => ({ item_id: i.itemId, qty: i.qty })),
    p_motivo: payload.motivo?.trim() || null,
    p_paciente: payload.paciente?.trim() || null,
    p_origem: payload.origem,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { movimentos?: number; controlados?: number }
  return { movimentos: Number(r.movimentos ?? 0), controlados: Number(r.controlados ?? 0) }
}

/** Desfaz um lançamento avulso com um lançamento contrário. O original fica no livro. */
export async function estornarMovimento(movimentoId: string, motivo: string): Promise<string> {
  if (motivo.trim().length < 3) throw new Error('Diga o motivo do estorno.')
  const { data, error } = await assertClient().rpc('stock_movimento_estornar', {
    p_movimento: movimentoId,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
  return String(data ?? '')
}

// ---------------------------------------------------------------- endereços

export type EnderecoEstoque = {
  id: string
  setorId: string
  codigo: string
  descricao: string | null
  ativo: boolean
}

export type ItemNoEndereco = { id: string; itemId: string; enderecoId: string }

function mapEndereco(r: Record<string, unknown>): EnderecoEstoque {
  return {
    id: String(r.id),
    setorId: String(r.warehouse_id),
    codigo: String(r.code ?? ''),
    descricao: r.description != null && r.description !== '' ? String(r.description) : null,
    ativo: Boolean(r.active),
  }
}

/** Ordena "A-2" antes de "A-10": código de prateleira tem número no meio. */
export const compararCodigoEndereco = (a: string, b: string) =>
  a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })

export async function listarEnderecos(incluirInativos = false): Promise<EnderecoEstoque[]> {
  const linhas = await buscarTudo<Record<string, unknown>>(
    () => {
      let q = assertClient().from('stock_locations').select('id, warehouse_id, code, description, active')
      if (!incluirInativos) q = q.eq('active', true)
      return q.order('code').order('id')
    },
    { rotulo: 'stock_locations' },
  )
  return linhas.map(mapEndereco).sort((a, b) => compararCodigoEndereco(a.codigo, b.codigo))
}

export async function salvarEndereco(payload: {
  id?: string
  setorId: string
  codigo: string
  descricao?: string | null
}): Promise<EnderecoEstoque> {
  const codigo = payload.codigo.trim().toUpperCase()
  if (!payload.setorId) throw new Error('Escolha o setor do endereço.')
  if (!codigo) throw new Error('Informe o código do endereço (ex.: A-01).')
  const row = {
    warehouse_id: payload.setorId,
    code: codigo,
    description: payload.descricao?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  const client = assertClient()
  const consulta = payload.id
    ? client.from('stock_locations').update(row).eq('id', payload.id)
    : client.from('stock_locations').insert(row)
  const { data, error } = await consulta.select('id, warehouse_id, code, description, active').single()
  if (error) {
    if (error.code === '23505') throw new Error(`Já existe o endereço ${codigo} neste setor.`)
    throw new Error(error.message)
  }
  return mapEndereco(data as Record<string, unknown>)
}

/**
 * Cria uma sequência de endereços de uma vez: prefixo "A-", de 1 a 6 → A-01 … A-06.
 * Os que já existem no setor são pulados (não dá erro no meio da série).
 */
export async function criarEnderecosEmSerie(payload: {
  setorId: string
  prefixo: string
  de: number
  ate: number
  descricao?: string | null
}): Promise<{ criados: number; pulados: number }> {
  const { setorId, de, ate } = payload
  if (!setorId) throw new Error('Escolha o setor.')
  if (!Number.isInteger(de) || !Number.isInteger(ate) || de < 0 || ate < de) throw new Error('Intervalo inválido.')
  if (ate - de > 199) throw new Error('No máximo 200 endereços por vez.')
  const casas = Math.max(2, String(ate).length)
  const prefixo = payload.prefixo.trim().toUpperCase()
  const codigos = Array.from({ length: ate - de + 1 }, (_, i) => `${prefixo}${String(de + i).padStart(casas, '0')}`)
  const existentes = new Set(
    (await listarEnderecos(true)).filter((e) => e.setorId === setorId).map((e) => e.codigo.toUpperCase()),
  )
  const novos = codigos.filter((c) => !existentes.has(c))
  if (novos.length > 0) {
    const { error } = await assertClient()
      .from('stock_locations')
      .insert(novos.map((code) => ({ warehouse_id: setorId, code, description: payload.descricao?.trim() || null })))
    if (error) throw new Error(error.message)
  }
  return { criados: novos.length, pulados: codigos.length - novos.length }
}

export async function definirEnderecoAtivo(id: string, ativo: boolean): Promise<void> {
  const { error } = await assertClient()
    .from('stock_locations')
    .update({ active: ativo, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function listarItensNosEnderecos(): Promise<ItemNoEndereco[]> {
  const linhas = await buscarTudo<Record<string, unknown>>(
    () => assertClient().from('stock_item_locations').select('id, item_id, location_id').order('id'),
    { rotulo: 'stock_item_locations' },
  )
  return linhas.map((r) => ({ id: String(r.id), itemId: String(r.item_id), enderecoId: String(r.location_id) }))
}

export async function guardarItemNoEndereco(itemId: string, enderecoId: string): Promise<void> {
  const { error } = await assertClient().from('stock_item_locations').insert({ item_id: itemId, location_id: enderecoId })
  if (error && error.code !== '23505') throw new Error(error.message)
}

export async function tirarItemDoEndereco(vinculoId: string): Promise<void> {
  const { error } = await assertClient().from('stock_item_locations').delete().eq('id', vinculoId)
  if (error) throw new Error(error.message)
}
