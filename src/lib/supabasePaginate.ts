/**
 * Busca paginada no PostgREST.
 *
 * O PostgREST deste projeto está com `max_rows = 1000` (confirmado na API de configuração
 * em 29/jul/2026). Isso significa que TODO `.limit(n)` com n maior que 1000 é ficção: o
 * servidor devolve 1000 linhas, sem erro, sem cabeçalho de aviso, sem nada. O código pede
 * 5.000, recebe 1.000 e soma como se fossem todas.
 *
 * O estrago medido antes desta correção:
 *   - /loja-analytics pedia 50.000 eventos e mostrava entre 13% e 44% do real (a receita
 *     de 30 dias aparecia como R$ 4.616 quando eram R$ 10.453).
 *   - O card "Consultas agendadas" em 30 dias mostrava 409 onde havia 1.000.
 *   - O boot do chat pedia 1.500 interações de 30.358 e recebia 1.000, que é a razão de
 *     conversa antiga abrir vazia (o `.limit(1500)` foi registrado como correção desse
 *     bug e nunca teve efeito).
 *
 * Duas regras que esta função existe para garantir:
 *
 * 1. ORDEM DETERMINÍSTICA é obrigatória. Sem `ORDER BY`, o Postgres não promete
 *    estabilidade entre páginas: a mesma linha pode vir em duas e outra sumir. O total
 *    mudaria entre dois carregamentos sem nada mudar no banco.
 * 2. TRUNCAR EM SILÊNCIO NUNCA. Se o teto de páginas for atingido, avisa no console em
 *    vez de devolver um número menor com cara de completo, que é o bug original.
 */

const TAMANHO_PAGINA = 1000

type RespostaPostgrest = { data: unknown; error: { message: string } | null }
type ConsultaPaginavel = { range: (de: number, ate: number) => PromiseLike<RespostaPostgrest> }

export type OpcoesPaginacao = {
  /** Teto de páginas, para uma consulta mal filtrada não varrer a tabela inteira. */
  maxPaginas?: number
  /** Nome usado na mensagem de aviso quando o teto é atingido. */
  rotulo?: string
}

/**
 * Percorre todas as páginas de uma consulta PostgREST.
 *
 * `montarConsulta` precisa devolver uma consulta NOVA a cada chamada (os builders do
 * supabase-js não podem ser reexecutados) e JÁ COM `.order()` aplicado.
 *
 * @example
 * const linhas = await buscarTudo<Evento>(
 *   () => supabase.from('storefront_events').select('*').gte('created_at', desde).order('id'),
 *   { rotulo: 'storefront_events' },
 * )
 */
export async function buscarTudo<T>(
  montarConsulta: () => ConsultaPaginavel,
  opcoes: OpcoesPaginacao = {},
): Promise<T[]> {
  const maxPaginas = opcoes.maxPaginas ?? 30
  const tudo: T[] = []

  for (let pagina = 0; pagina < maxPaginas; pagina += 1) {
    const de = pagina * TAMANHO_PAGINA
    const { data, error } = await montarConsulta().range(de, de + TAMANHO_PAGINA - 1)
    if (error) throw new Error(error.message)
    const lote = (data as T[]) ?? []
    tudo.push(...lote)
    // Página incompleta significa fim do conjunto.
    if (lote.length < TAMANHO_PAGINA) return tudo
  }

  console.warn(
    `[paginacao] ${opcoes.rotulo ?? 'consulta'}: teto de ${maxPaginas * TAMANHO_PAGINA} linhas atingido. ` +
      'O resultado pode estar truncado; aumente maxPaginas ou agregue no banco.',
  )
  return tudo
}
