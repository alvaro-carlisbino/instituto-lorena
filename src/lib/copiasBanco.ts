import { padraoDaRegra } from '@/lib/extratoPadrao'

/**
 * Lançamentos do banco que podem ser o MESMO pagamento gravado mais de uma vez.
 *
 * Mesmo dia e mesmo valor não bastam: a folha paga várias pessoas com o mesmo salário no mesmo
 * dia. Mas também não dá para exigir a mesma descrição: o banco manda o pendente como
 * "SISPAG FORNECEDORES" e o compensado como "BOLETO PAGO PORTO S COMP" (14/set/2026, um boleto
 * que apareceu três vezes). Vira possível cópia quando, além de dia e valor, a descrição é igual
 * OU uma das duas é só o trilho do pagamento, sem dizer quem recebeu.
 *
 * Devolve, para cada id que tem possível cópia, os ids dos outros. Quem decide é a pessoa.
 */
export function possiveisCopias<T extends { id: string; data: string; descricao: string; amountCents: number }>(
  linhas: T[],
): Map<string, T[]> {
  const grupos = new Map<string, T[]>()
  for (const l of linhas) {
    const k = `${l.data}|${l.amountCents}`
    grupos.set(k, [...(grupos.get(k) ?? []), l])
  }
  const semNome = (l: T) => padraoDaRegra(l.descricao) == null
  const out = new Map<string, T[]>()
  for (const g of grupos.values()) {
    if (g.length < 2) continue
    for (const a of g) {
      const outros = g.filter((b) => b.id !== a.id && (b.descricao === a.descricao || semNome(a) || semNome(b)))
      if (outros.length > 0) out.set(a.id, outros)
    }
  }
  return out
}
