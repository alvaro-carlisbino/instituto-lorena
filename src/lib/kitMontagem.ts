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

// ------------------------------------------------------- bandeja × modelo

// A bandeja em montagem mora no navegador (rascunho) e sobrevive a recarregar a página. Em
// 22/09 a enfermagem tirou itens do Kit Cirúrgico CC, voltou para Montar e a bandeja antiga
// continuava lá: tocar no modelo não fazia nada (já era o escolhido) e recarregar não mudava
// nada. Estas regras dizem quando a bandeja ficou para trás e como trazê-la para o modelo atual.

export type ItemDoModelo = { itemId: string; qty: number }

/** Retrato do modelo (itens e quantidades, sem ordem): muda quando alguém edita o modelo. */
export function assinaturaDoModelo(itens: ItemDoModelo[]): string {
  return itens
    .map((i) => `${i.itemId}:${i.qty}`)
    .sort()
    .join('|')
}

/**
 * Compara os itens da bandeja que vieram do modelo (avulsos ficam de fora) com o modelo de agora.
 * Serve para rascunho antigo, de antes de a bandeja guardar a assinatura do modelo.
 */
export function diferencaDoModelo(linhas: LinhaMontagem[], itens: ItemDoModelo[]): { sairam: number; entraram: number } {
  const naBandeja = new Set(linhas.filter((l) => !l.avulso && l.itemId).map((l) => l.itemId))
  const noModelo = new Set(itens.map((i) => i.itemId))
  let sairam = 0
  let entraram = 0
  for (const id of naBandeja) if (!noModelo.has(id)) sairam += 1
  for (const id of noModelo) if (!naBandeja.has(id)) entraram += 1
  return { sairam, entraram }
}

/**
 * Refaz a bandeja pelo modelo atual sem jogar fora o trabalho: item que continua no modelo
 * mantém o que já foi conferido (até a quantidade nova) e a cobrança; item que saiu do modelo
 * sai da bandeja; avulso bipado à parte fica.
 */
export function atualizarPeloModelo(linhas: LinhaMontagem[], itens: ItemDoModelo[]): LinhaMontagem[] {
  // Linha do modelo tem preferência; na falta dela, o avulso do mesmo produto empresta o conferido.
  const antigas = new Map<string, LinhaMontagem>()
  for (const l of linhas) {
    const ja = antigas.get(l.itemId)
    if (l.itemId && (!ja || (ja.avulso && !l.avulso))) antigas.set(l.itemId, l)
  }
  const doModelo = itens.map((i): LinhaMontagem => {
    const antiga = antigas.get(i.itemId)
    return {
      chave: antiga?.chave ?? novaChave(),
      itemId: i.itemId,
      qty: i.qty,
      conferido: Math.min(antiga?.conferido ?? 0, i.qty),
      avulso: false,
      cobrancaCents: antiga?.cobrancaCents ?? 0,
    }
  })
  const noModelo = new Set(itens.map((i) => i.itemId))
  // Avulso de um item que agora faz parte do modelo não pode virar linha repetida do mesmo produto.
  return [...doModelo, ...linhas.filter((l) => l.avulso && !noModelo.has(l.itemId))]
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
 * Marca de uma linha no "Registrar uso": quanto VOLTA agora. Negativo é o contrário: desfaz
 * devolução marcada por engano (lençol "voltou 1" quando usaram os 3) e, passando disso, é uso
 * além do que saiu (a bandeja levou 6 Ringer e a cirurgia usou 9 → -3). Um número só serve às
 * duas maneiras de marcar, "o que voltou" e "o que foi usado", sem as duas divergirem.
 */
export type MarcasDeUso = Record<string, number>

/** Usado na linha com esta marca: o que está fora menos o que volta (a mais soma). */
export const usadoNaLinha = (l: LinhaKit, marca = 0) => Math.max(0, podeVoltar(l) - marca)

/** Total que terá voltado desta linha com esta marca (o que já voltou mais o de agora). */
export const voltouNaLinha = (l: LinhaKit, marca = 0) => Math.max(0, l.returnedQty + marca)

/** Marca a partir do que a enfermeira diz que usou. Passar do que saiu vira uso a mais. */
export const marcaPorUsado = (l: LinhaKit, usado: number) => podeVoltar(l) - Math.max(0, usado)

/** Marca a partir do TOTAL que voltou (0 a quanto saiu). Abaixo do que já voltou, desfaz. */
export const marcaPorVoltou = (l: LinhaKit, voltouTotal: number) =>
  Math.min(l.qty, Math.max(0, voltouTotal)) - l.returnedQty

/** O que vai ao banco: por linha, quanto volta, quanto de devolução se desfaz e quanto foi usado a mais. */
export function registroDeUso(linhas: LinhaKit[], marcas: MarcasDeUso) {
  const itens: Array<{ kitItemId: string; voltou: number; desfazer: number; aMais: number }> = []
  let voltam = 0
  let desfeito = 0
  let aMais = 0
  for (const l of linhas) {
    const marca = marcas[l.id] ?? 0
    if (marca > 0) {
      const voltou = Math.min(marca, podeVoltar(l))
      itens.push({ kitItemId: l.id, voltou, desfazer: 0, aMais: 0 })
      voltam += voltou
    } else if (marca < 0) {
      const desfazer = Math.min(-marca, l.returnedQty)
      const mais = -marca - desfazer
      itens.push({ kitItemId: l.id, voltou: 0, desfazer, aMais: mais })
      desfeito += desfazer
      aMais += mais
    }
  }
  return { itens, voltam, desfeito, aMais }
}
