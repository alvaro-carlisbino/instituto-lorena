// Parser client-side do XML da NF-e (procNFe ou NFe). Extrai o que o módulo de
// compras precisa: emitente → fornecedor, cabeçalho da nota, itens (com rastro de
// lote/validade quando o emissor preenche — comum em medicamento) e as duplicatas
// (cobr/dup) que viram parcelas em contas a pagar.

export type NfeItem = {
  description: string
  qty: number
  unit: string
  unitCostCents: number
  totalCents: number
  lotCode: string | null
  expiresOn: string | null
  /** GTIN/EAN do produto (cEAN) — 'SEM GTIN' vira null. */
  ean: string | null
  /** Código do produto no emitente (cProd) — casa com o SKU do nosso estoque. */
  supplierCode: string | null
}

export type NfeInstallment = {
  number: string
  dueDate: string
  amountCents: number
}

export type NfeParsed = {
  number: string
  series: string | null
  issueDate: string | null
  supplierCnpj: string | null
  supplierName: string | null
  totalCents: number
  items: NfeItem[]
  installments: NfeInstallment[]
}

const text = (parent: Element | Document, tag: string): string | null => {
  const el = parent.getElementsByTagName(tag)[0]
  const value = el?.textContent?.trim()
  return value ? value : null
}

const toCents = (raw: string | null): number => {
  const n = Number(raw ?? '')
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** dhEmi vem como ISO com timezone; dEmi (layout antigo) como yyyy-mm-dd. */
const toDay = (raw: string | null): string | null => {
  if (!raw) return null
  const day = raw.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

export function parseNfeXml(xml: string): NfeParsed {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Arquivo não é um XML válido.')
  }
  const infNFe = doc.getElementsByTagName('infNFe')[0]
  if (!infNFe) throw new Error('XML não parece ser uma NF-e (tag infNFe não encontrada).')

  const ide = infNFe.getElementsByTagName('ide')[0]
  const emit = infNFe.getElementsByTagName('emit')[0]

  const items: NfeItem[] = []
  const dets = infNFe.getElementsByTagName('det')
  for (let i = 0; i < dets.length; i += 1) {
    const prod = dets[i]!.getElementsByTagName('prod')[0]
    if (!prod) continue
    const rastro = prod.getElementsByTagName('rastro')[0]
    const qty = Number(text(prod, 'qCom') ?? '0')
    const rawEan = text(prod, 'cEAN')
    const rawCode = text(prod, 'cProd')
    items.push({
      description: text(prod, 'xProd') ?? `Item ${i + 1}`,
      qty: Number.isFinite(qty) ? qty : 0,
      unit: text(prod, 'uCom') ?? 'un',
      unitCostCents: toCents(text(prod, 'vUnCom')),
      totalCents: toCents(text(prod, 'vProd')),
      lotCode: rastro ? text(rastro, 'nLote') : null,
      expiresOn: rastro ? toDay(text(rastro, 'dVal')) : null,
      ean: rawEan && /^\d{8,14}$/.test(rawEan) ? rawEan : null,
      supplierCode: rawCode && rawCode.toUpperCase() !== 'SEM GTIN' ? rawCode : null,
    })
  }

  const installments: NfeInstallment[] = []
  const cobr = infNFe.getElementsByTagName('cobr')[0]
  if (cobr) {
    const dups = cobr.getElementsByTagName('dup')
    for (let i = 0; i < dups.length; i += 1) {
      const dup = dups[i]!
      const dueDate = toDay(text(dup, 'dVenc'))
      const amountCents = toCents(text(dup, 'vDup'))
      if (dueDate && amountCents > 0) {
        installments.push({ number: text(dup, 'nDup') ?? String(i + 1), dueDate, amountCents })
      }
    }
  }

  const icmsTot = infNFe.getElementsByTagName('ICMSTot')[0]

  return {
    number: (ide ? text(ide, 'nNF') : null) ?? '',
    series: ide ? text(ide, 'serie') : null,
    issueDate: ide ? toDay(text(ide, 'dhEmi') ?? text(ide, 'dEmi')) : null,
    supplierCnpj: emit ? text(emit, 'CNPJ') : null,
    supplierName: emit ? text(emit, 'xNome') : null,
    totalCents: icmsTot ? toCents(text(icmsTot, 'vNF')) : 0,
    items,
    installments,
  }
}
