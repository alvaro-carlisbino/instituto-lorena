// Consumo de verdade e lista de compra (pedido da enfermagem, 23/09/2026: "dar baixa nos setores
// para tirar uma relação na segunda e fazer o pedido de compra").
//
// Consumo não é "toda saída": o kit sai cheio na montagem e a sobra volta como entrada do mesmo
// kit; a transferência entre setores é saída num lugar e entrada no outro, nada foi gasto; o
// estorno desfaz um lançamento. Somar só as saídas contava o kit cheio e a transferência como
// gasto, e o pedido sairia inflado.

export type MovimentoDeConsumo = {
  itemId: string
  kind: 'entrada' | 'saida' | 'ajuste'
  qtyDelta: number
  refType: string | null
  unitCostCents: number | null
}

export type Consumo = { qty: number; costCents: number; uncosted: boolean }

/** Entrada que desfaz um gasto (sobra de kit, kit cancelado, estorno de saída). */
const devolveGasto = (refType: string | null) => refType === 'stock_kit' || refType === 'estorno'

export function consumoLiquido(movimentos: MovimentoDeConsumo[]): Map<string, Consumo> {
  const porItem = new Map<string, Consumo>()
  for (const m of movimentos) {
    if (m.refType === 'stock_transfer') continue
    let sinal = 0
    if (m.kind === 'saida' && m.refType !== 'estorno') sinal = 1
    else if (m.kind === 'entrada' && devolveGasto(m.refType)) sinal = -1
    if (sinal === 0) continue
    const acc = porItem.get(m.itemId) ?? { qty: 0, costCents: 0, uncosted: false }
    const qty = Math.abs(m.qtyDelta)
    acc.qty += sinal * qty
    if (m.unitCostCents != null) acc.costCents += sinal * Math.round(qty * m.unitCostCents)
    else if (sinal > 0) acc.uncosted = true
    porItem.set(m.itemId, acc)
  }
  // Devolução de kit montado antes do período pode deixar negativo: não gastou nada, não "ganhou".
  for (const [id, c] of porItem) {
    if (c.qty <= 1e-9) porItem.delete(id)
    else c.costCents = Math.max(0, c.costCents)
  }
  return porItem
}

export type ItemParaCompra = {
  id: string
  name: string
  unit: string
  /** Saldo somando todos os setores. */
  saldo: number
  minQty: number
  lastCostCents: number | null
}

export type LinhaDeCompra = {
  itemId: string
  name: string
  unit: string
  saldo: number
  gasto: number
  /** Quanto se espera gastar nos dias de cobertura, pelo ritmo do período. */
  previsto: number
  minQty: number
  sugerido: number
  lastCostCents: number | null
  motivo: 'consumo' | 'minimo'
}

/**
 * Para cada item: o que o ritmo do período pede para os próximos `diasCobertura` dias (ou o
 * mínimo cadastrado, o que for maior), menos o que já tem. Só entra quem precisa comprar.
 */
export function sugerirCompra(params: {
  itens: ItemParaCompra[]
  consumo: Map<string, Consumo>
  diasPeriodo: number
  diasCobertura: number
}): LinhaDeCompra[] {
  const diasPeriodo = Math.max(1, params.diasPeriodo)
  const linhas: LinhaDeCompra[] = []
  for (const it of params.itens) {
    const gasto = params.consumo.get(it.id)?.qty ?? 0
    const previsto = (gasto / diasPeriodo) * params.diasCobertura
    const alvo = Math.max(previsto, it.minQty)
    const falta = alvo - Math.max(it.saldo, 0)
    if (falta <= 1e-9) continue
    linhas.push({
      itemId: it.id,
      name: it.name,
      unit: it.unit,
      saldo: it.saldo,
      gasto,
      previsto,
      minQty: it.minQty,
      sugerido: Math.ceil(falta - 1e-9),
      lastCostCents: it.lastCostCents,
      motivo: previsto >= it.minQty ? 'consumo' : 'minimo',
    })
  }
  return linhas.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

/** Dias corridos entre duas datas yyyy-mm-dd, contando as duas pontas. */
export function diasEntre(de: string, ate: string): number {
  const a = Date.parse(`${de}T12:00:00`)
  const b = Date.parse(`${ate}T12:00:00`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1
  return Math.round((b - a) / 86_400_000) + 1
}
