import { supabase } from '@/lib/supabaseClient'
import { definicaoDaLista, padraoDaLista, type ChaveLista } from '@/config/listas'

/**
 * LISTAS CONFIGURÁVEIS — o vocabulário que antes era `const` no fonte.
 *
 * Ver `src/config/listas.ts` (catálogo) e a migration 20260918200000. Tabela única
 * `app_list_options`, um registro por opção, isolada por tenant pela RLS.
 *
 * O texto escolhido é gravado NO REGISTRO (venda, lead, follow-up), sem FK. Por isso renomear
 * não é um update na opção: passa por `crm_renomear_opcao`, que arrasta o histórico junto e
 * devolve quantos registros foram atrás. Sem isso, renomear parte o relatório em duas linhas
 * para a mesma coisa.
 */

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type OpcaoLista = {
  id: string
  chave: ChaveLista
  label: string
  /** Código gravado no registro quando ele difere do rótulo. Nulo = vale o próprio rótulo. */
  value: string | null
  active: boolean
  sortOrder: number
}

/** O que o formulário precisa: o que mostrar e o que gravar. */
export type OpcaoEscolhivel = { label: string; value: string }

const mapear = (r: Record<string, unknown>): OpcaoLista => ({
  id: String(r.id),
  chave: String(r.list_key) as ChaveLista,
  label: String(r.label ?? ''),
  value: (r.value as string | null) ?? null,
  active: Boolean(r.active),
  sortOrder: Number(r.sort_order ?? 100),
})

/** Todas as opções de uma lista, inativas incluídas quando pedido (a tela de configuração pede). */
export async function listarOpcoes(chave: ChaveLista, incluirInativas = false): Promise<OpcaoLista[]> {
  const client = assertClient()
  let q = client
    .from('app_list_options')
    .select('id, list_key, label, value, active, sort_order')
    .eq('list_key', chave)
  if (!incluirInativas) q = q.eq('active', true)
  const { data, error } = await q.order('sort_order').order('label')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapear(r as Record<string, unknown>))
}

/** Tudo de uma vez — a tela de configuração mostra a contagem de cada lista no menu lateral. */
export async function listarTodasAsOpcoes(): Promise<Map<ChaveLista, OpcaoLista[]>> {
  const client = assertClient()
  const { data, error } = await client
    .from('app_list_options')
    .select('id, list_key, label, value, active, sort_order')
    .order('sort_order')
    .order('label')
  if (error) throw new Error(error.message)
  const m = new Map<ChaveLista, OpcaoLista[]>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const o = mapear(r)
    const atual = m.get(o.chave)
    if (atual) atual.push(o)
    else m.set(o.chave, [o])
  }
  return m
}

/** Código a partir do rótulo, para lista que guarda código: "Plano / conduta" vira "plano_conduta". */
export function codigoDoRotulo(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

export async function criarOpcao(chave: ChaveLista, label: string): Promise<void> {
  const client = assertClient()
  const comCodigo = definicaoDaLista(chave).comCodigo === true
  const { error } = await client.from('app_list_options').insert({
    list_key: chave,
    label: label.trim(),
    value: comCodigo ? codigoDoRotulo(label) : null,
    sort_order: 500,
  })
  if (error) {
    // 23505 = índice único. A mensagem crua ("duplicate key value violates…") não ajuda ninguém.
    throw new Error(error.code === '23505' ? 'Essa opção já está na lista.' : error.message)
  }
}

export async function atualizarOpcao(
  id: string,
  patch: { label?: string; active?: boolean; sortOrder?: number },
): Promise<void> {
  const client = assertClient()
  const row: Record<string, unknown> = {}
  if (patch.label !== undefined) row.label = patch.label.trim()
  if (patch.active !== undefined) row.active = patch.active
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder
  if (Object.keys(row).length === 0) return
  const { error } = await client.from('app_list_options').update(row).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function apagarOpcao(id: string): Promise<void> {
  const client = assertClient()
  const { error } = await client.from('app_list_options').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Renomeia a opção e todo registro que já usava o nome antigo. Devolve quantos foram arrastados.
 *
 * Também serve para MESCLAR: renomear "CRED 2X" para "Cartão de crédito" quando este já existe
 * junta as duas — o histórico vai junto e a grafia antiga sai da lista.
 */
export async function renomearOpcao(chave: ChaveLista, de: string, para: string): Promise<number> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_renomear_opcao', {
    p_list_key: chave,
    p_de: de,
    p_para: para,
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

/**
 * Quantos registros usam cada texto — inclusive os que NÃO estão cadastrados na lista.
 *
 * A segunda metade é o que denuncia a grafia que entrou por importação: "CRED 10X" com 23 vendas
 * atrás não aparece em lugar nenhum da tela hoje, e é exatamente o que precisa ser mesclado.
 */
export async function usoDaLista(chave: ChaveLista): Promise<Map<string, number>> {
  const client = assertClient()
  const { data, error } = await client.rpc('crm_opcoes_uso', { p_list_key: chave })
  if (error) throw new Error(error.message)
  const m = new Map<string, number>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    m.set(String(r.label ?? ''), Number(r.usos ?? 0))
  }
  return m
}

// ──────────────────────────────────────────────── leitura em cache, para os formulários
//
// Um dialog não pode pagar uma ida ao banco por abertura, nem abrir vazio se a rede falhar:
// o campo sumir é pior do que o campo estar desatualizado por um minuto. Cache por chave na
// memória do módulo, e a tela de configuração limpa depois de salvar.

const cache = new Map<ChaveLista, Promise<OpcaoEscolhivel[]>>()

/** Rótulo e valor de cada opção ativa, com o padrão do fonte como rede de segurança. */
export async function opcoesEscolhiveis(chave: ChaveLista): Promise<OpcaoEscolhivel[]> {
  const emCache = cache.get(chave)
  if (emCache) return emCache
  const padrao = () => padraoDaLista(chave).map((l) => ({ label: l, value: l }))
  const p = listarOpcoes(chave)
    .then((rows) =>
      rows.length > 0 ? rows.map((r) => ({ label: r.label, value: r.value ?? r.label })) : padrao(),
    )
    .catch(() => {
      // Falhou: não guarda a promessa quebrada, para a próxima abertura tentar de novo.
      cache.delete(chave)
      return padrao()
    })
  cache.set(chave, p)
  return p
}

export async function opcoesAtivas(chave: ChaveLista): Promise<string[]> {
  return (await opcoesEscolhiveis(chave)).map((o) => o.label)
}

export function limparCacheDeOpcoes(chave?: ChaveLista): void {
  if (chave) cache.delete(chave)
  else cache.clear()
}
