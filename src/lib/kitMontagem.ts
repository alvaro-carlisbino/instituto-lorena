// Regras da bandeja: o que um bipe faz na montagem e na devolução. Sem React e sem banco,
// para dar pra testar o que a enfermagem vê quando bipa a 4ª luva de um kit que pede 4.

export type LinhaMontagem = {
  chave: string
  itemId: string
  qty: number
  /** Quantas unidades já foram bipadas (ou marcadas à mão) nesta linha. */
  conferido: number
  avulso: boolean
  cobrancaCents: number
}

export type ResultadoBipe = 'conferido' | 'a_mais' | 'novo'

let seq = 0
export const novaChave = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`

/**
 * Bipou um item na montagem:
 *  - está no kit e ainda falta conferir → confere +1;
 *  - está no kit e já está completo → a bandeja levou uma a mais, soma na quantidade;
 *  - não está no kit → entra como avulso.
 */
export function aplicarBipe(
  linhas: LinhaMontagem[],
  itemId: string,
): { linhas: LinhaMontagem[]; resultado: ResultadoBipe; chave: string } {
  const faltando = linhas.find((l) => l.itemId === itemId && l.conferido < l.qty)
  if (faltando) {
    return {
      linhas: linhas.map((l) => (l.chave === faltando.chave ? { ...l, conferido: l.conferido + 1 } : l)),
      resultado: 'conferido',
      chave: faltando.chave,
    }
  }
  const existente = linhas.find((l) => l.itemId === itemId)
  if (existente) {
    return {
      linhas: linhas.map((l) =>
        l.chave === existente.chave ? { ...l, qty: l.qty + 1, conferido: l.conferido + 1 } : l,
      ),
      resultado: 'a_mais',
      chave: existente.chave,
    }
  }
  const nova: LinhaMontagem = { chave: novaChave(), itemId, qty: 1, conferido: 1, avulso: true, cobrancaCents: 0 }
  return { linhas: [...linhas, nova], resultado: 'novo', chave: nova.chave }
}

export type ResumoMontagem = {
  linhas: number
  completas: number
  faltaConferir: number
  /** Itens cuja soma pedida no kit passa do saldo (a baixa deixaria negativo). */
  semSaldo: Set<string>
}

export function resumirMontagem(linhas: LinhaMontagem[], saldo: Map<string, number>): ResumoMontagem {
  const validas = linhas.filter((l) => l.itemId && l.qty > 0)
  const pedido = new Map<string, number>()
  for (const l of validas) pedido.set(l.itemId, (pedido.get(l.itemId) ?? 0) + l.qty)
  const semSaldo = new Set<string>()
  for (const [itemId, qty] of pedido) if (qty > (saldo.get(itemId) ?? 0)) semSaldo.add(itemId)
  const completas = validas.filter((l) => l.conferido >= l.qty).length
  return { linhas: validas.length, completas, faltaConferir: validas.length - completas, semSaldo }
}

// ---------------------------------------------------------------- devolução

export type LinhaKit = { id: string; itemId: string; qty: number; returnedQty: number }

/** Quanto ainda pode voltar desta linha (saiu menos o que já voltou). */
export const podeVoltar = (l: LinhaKit) => Math.max(0, l.qty - l.returnedQty)

/**
 * Bipou um item voltando da bandeja: soma +1 na primeira linha daquele produto que ainda
 * tem o que devolver. `fora_do_kit` e `esgotado` existem para a tela avisar em vez de
 * aceitar em silêncio uma devolução que o estoque recusaria.
 */
export function aplicarBipeDevolucao(
  linhas: LinhaKit[],
  devolucoes: Record<string, number>,
  itemId: string,
): { devolucoes: Record<string, number>; resultado: 'ok' | 'fora_do_kit' | 'esgotado'; linhaId?: string } {
  const doItem = linhas.filter((l) => l.itemId === itemId)
  if (doItem.length === 0) return { devolucoes, resultado: 'fora_do_kit' }
  const alvo = doItem.find((l) => (devolucoes[l.id] ?? 0) < podeVoltar(l))
  if (!alvo) return { devolucoes, resultado: 'esgotado', linhaId: doItem[0].id }
  return {
    devolucoes: { ...devolucoes, [alvo.id]: (devolucoes[alvo.id] ?? 0) + 1 },
    resultado: 'ok',
    linhaId: alvo.id,
  }
}

// ------------------------------------------------------------ registrar uso

/**
 * Marca de uma linha no "Registrar uso": quanto VOLTOU. Negativo é o que foi usado além do
 * que saiu (a bandeja levou 6 Ringer e a cirurgia usou 9 → -3). Um número só serve às duas
 * maneiras de marcar, "o que voltou" e "o que foi usado", sem as duas divergirem.
 */
export type MarcasDeUso = Record<string, number>

/** Usado na linha com esta marca: o que está fora menos o que voltou (a mais soma). */
export const usadoNaLinha = (l: LinhaKit, marca = 0) => Math.max(0, podeVoltar(l) - marca)

/** Marca a partir do que a enfermeira diz que usou. Passar do que saiu vira uso a mais. */
export const marcaPorUsado = (l: LinhaKit, usado: number) => podeVoltar(l) - Math.max(0, usado)

/** Marca a partir do que voltou: nunca mais do que está fora. */
export const marcaPorVoltou = (l: LinhaKit, voltou: number) => Math.min(podeVoltar(l), Math.max(0, voltou))

/** O que vai ao banco: por linha, quanto voltou ou quanto foi usado a mais (nunca os dois). */
export function registroDeUso(linhas: LinhaKit[], marcas: MarcasDeUso) {
  const itens: Array<{ kitItemId: string; voltou: number; aMais: number }> = []
  let voltam = 0
  let aMais = 0
  for (const l of linhas) {
    const marca = marcas[l.id] ?? 0
    if (marca > 0) {
      const voltou = Math.min(marca, podeVoltar(l))
      itens.push({ kitItemId: l.id, voltou, aMais: 0 })
      voltam += voltou
    } else if (marca < 0) {
      itens.push({ kitItemId: l.id, voltou: 0, aMais: -marca })
      aMais -= marca
    }
  }
  return { itens, voltam, aMais }
}
