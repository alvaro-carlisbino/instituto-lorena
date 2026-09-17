import { buscarTudo } from '@/lib/supabasePaginate'
import { supabase } from '@/lib/supabaseClient'

// Juntar o item da nota (nome do fornecedor) no item que a equipe usa (nome da enfermagem).
// As regras moram no banco (migration 20260917200000): saldo e lote passam de um para o
// outro, modelos de kit e endereços são repontados, e tudo pode ser desfeito.

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type ItemDeNota = {
  itemId: string
  nome: string
  unidade: string
  codigo: string | null
  ativo: boolean
  notas: number
  ultimaEntrada: string | null
  fornecedores: string | null
  saldo: number
}

/** Itens que entraram por nota e não estão juntados em nenhum outro. */
export async function listarItensDeNota(): Promise<ItemDeNota[]> {
  const linhas = await buscarTudo<Record<string, unknown>>(
    () => assertClient().rpc('stock_itens_de_nota').order('nome').order('item_id'),
    { rotulo: 'stock_itens_de_nota' },
  )
  return linhas.map((r) => ({
    itemId: String(r.item_id),
    nome: String(r.nome ?? ''),
    unidade: String(r.unidade ?? 'un'),
    codigo: r.codigo != null && r.codigo !== '' ? String(r.codigo) : null,
    ativo: Boolean(r.ativo),
    notas: Number(r.notas ?? 0),
    ultimaEntrada: r.ultima_entrada != null ? String(r.ultima_entrada) : null,
    fornecedores: r.fornecedores != null ? String(r.fornecedores) : null,
    saldo: Number(r.saldo ?? 0),
  }))
}

export async function juntarItem(origemId: string, destinoId: string): Promise<{ movimentos: number; lotes: number; modelos: number }> {
  const { data, error } = await assertClient().rpc('stock_item_juntar', { p_origem: origemId, p_destino: destinoId })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { movimentos?: number; lotes?: number; modelos?: number }
  return { movimentos: Number(r.movimentos ?? 0), lotes: Number(r.lotes ?? 0), modelos: Number(r.modelos ?? 0) }
}

export type JuncaoDoItem = {
  id: string
  origemId: string
  origemNome: string
  criadaEm: string
  desfeitaEm: string | null
}

/** Itens juntados NESTE item pela tela (as junções do inventário de 14/09 foram por script e não têm registro). */
export async function listarJuncoesDoItem(destinoId: string): Promise<JuncaoDoItem[]> {
  const { data, error } = await assertClient()
    .from('stock_item_juncoes')
    .select('id, origem_id, created_at, desfeita_em, origem:stock_items!stock_item_juncoes_origem_id_fkey(name)')
    .eq('destino_id', destinoId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => {
    const origem = (r as { origem?: { name?: unknown } | null }).origem
    return {
      id: String(r.id),
      origemId: String(r.origem_id),
      origemNome: origem?.name != null ? String(origem.name) : 'Item',
      criadaEm: String(r.created_at ?? ''),
      desfeitaEm: r.desfeita_em != null ? String(r.desfeita_em) : null,
    }
  })
}

export async function desfazerJuncao(juncaoId: string): Promise<void> {
  const { error } = await assertClient().rpc('stock_item_desfazer_juncao', { p_juncao: juncaoId })
  if (error) throw new Error(error.message)
}

/** Itens já juntados neste (em cadeia), com ou sem registro de junção: nome e id. */
export async function listarItensJuntadosNele(itemId: string): Promise<Array<{ id: string; nome: string }>> {
  const client = assertClient()
  const vistos = new Set<string>([itemId])
  const resultado: Array<{ id: string; nome: string }> = []
  let fila = [itemId]
  // Cadeia curta na prática (1 ou 2 saltos); o teto evita laço se um dia houver ciclo.
  for (let salto = 0; salto < 5 && fila.length > 0; salto += 1) {
    const { data, error } = await client.from('stock_items').select('id, name').in('replaced_by', fila)
    if (error) throw new Error(error.message)
    fila = []
    for (const r of data ?? []) {
      const id = String(r.id)
      if (vistos.has(id)) continue
      vistos.add(id)
      resultado.push({ id, nome: String(r.name ?? '') })
      fila.push(id)
    }
  }
  return resultado.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}
