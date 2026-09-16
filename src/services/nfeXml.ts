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
  /** 'nfse' = nota de serviço: não tem produto, entra só no financeiro. Ausente = NF-e. */
  kind?: 'nfe' | 'nfse'
  /** Chave de acesso (44 dígitos, do Id de infNFe). Identidade da nota — trava reimportação.
   *  Na NFS-e não existe chave nacional única: vira `nfse:<cnpj do prestador>:<número>`. */
  key: string | null
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
  // Id vem como "NFe4126..." — só os 44 dígitos interessam.
  const rawKey = (infNFe.getAttribute('Id') ?? '').replace(/\D/g, '')
  const key = rawKey.length === 44 ? rawKey : null

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
    kind: 'nfe',
    key,
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

// ------------------------------------------------------------------ NFS-e (nota de serviço)
//
// Nota de serviço não passa pela SEFAZ: sai da prefeitura (ABRASF: GISS, Betha, ISS.net…) ou do
// emissor nacional. A captura automática nunca vê, e o "Importar XML" recusava por não ter
// infNFe, então nota de farmácia de manipulação (Health Tech, 135700, set/26) ficava de fora.
// Não traz produto nem duplicata: entra só no financeiro.

/** Por nome local: o XML municipal às vezes vem com prefixo (ns2:Numero), e o nome qualificado não casaria. */
const byLocal = (parent: Element | Document, tag: string): Element | null =>
  parent.getElementsByTagNameNS('*', tag)[0] ?? null

const localText = (parent: Element | Document | null, tag: string): string | null => {
  const value = parent ? byLocal(parent, tag)?.textContent?.trim() : null
  return value ? value : null
}

/** Filho direto: InfNfse tem Numero da nota, mas também Numero do endereço e do RPS lá dentro. */
const childText = (parent: Element | null, tag: string): string | null => {
  if (!parent) return null
  for (let i = 0; i < parent.children.length; i += 1) {
    const el = parent.children[i]!
    if (el.localName === tag) return el.textContent?.trim() || null
  }
  return null
}

export function isNfseXml(xml: string): boolean {
  return /<(\w+:)?(InfNfse|infNFSe)[\s>]/.test(xml)
}

export function parseNfseXml(xml: string): NfeParsed {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Arquivo não é um XML válido.')
  }
  if (byLocal(doc, 'NfseCancelamento')) {
    throw new Error('Esta NFS-e foi cancelada na prefeitura, não entra no financeiro.')
  }

  // Emissor nacional (nfse.gov.br): NFSe/infNFSe, com emit e valores/vLiq.
  const nacional = byLocal(doc, 'infNFSe')
  if (nacional) {
    const emit = byLocal(nacional, 'emit')
    const number = childText(nacional, 'nNFSe') ?? ''
    const cnpj = localText(emit, 'CNPJ') ?? localText(emit, 'CPF')
    return {
      kind: 'nfse',
      key: cnpj && number ? `nfse:${cnpj}:${number}` : null,
      number,
      series: null,
      issueDate: toDay(localText(nacional, 'dhEmi') ?? childText(nacional, 'dhProc')),
      supplierCnpj: cnpj,
      supplierName: localText(emit, 'xNome'),
      totalCents: toCents(localText(nacional, 'vLiq') ?? localText(nacional, 'vServ')),
      items: [],
      installments: [],
    }
  }

  // ABRASF (1.0 e 2.x): CompNfse/Nfse/InfNfse.
  const inf = byLocal(doc, 'InfNfse')
  if (!inf) throw new Error('XML não parece ser uma NFS-e (tag InfNfse não encontrada).')
  // 2.x põe o CNPJ em DeclaracaoPrestacaoServico/Prestador; 1.0 em PrestadorServico/IdentificacaoPrestador.
  // Nunca procurar Cnpj solto: o do tomador (a clínica) também está no arquivo.
  const prestadorServico = byLocal(inf, 'PrestadorServico')
  const prestador = byLocal(inf, 'Prestador')
  const cnpj =
    localText(prestador, 'Cnpj') ?? localText(prestadorServico, 'Cnpj') ?? localText(prestador, 'Cpf') ?? localText(prestadorServico, 'Cpf')
  const number = childText(inf, 'Numero') ?? ''
  return {
    kind: 'nfse',
    key: cnpj && number ? `nfse:${cnpj}:${number}` : null,
    number,
    series: null,
    issueDate: toDay(childText(inf, 'DataEmissao') ?? localText(inf, 'Competencia')),
    supplierCnpj: cnpj,
    supplierName: localText(prestadorServico, 'RazaoSocial') ?? localText(prestadorServico, 'NomeFantasia'),
    // Líquido é o que sai do banco (retenção de ISS/IR o tomador paga ao governo), e é com o
    // extrato que a parcela precisa casar.
    totalCents: toCents(localText(inf, 'ValorLiquidoNfse') ?? localText(inf, 'ValorServicos')),
    items: [],
    installments: [],
  }
}

/** Porta única do upload: NF-e de produto ou NFS-e de serviço, pelo que o arquivo é. */
export function parseNotaXml(xml: string): NfeParsed {
  return isNfseXml(xml) ? parseNfseXml(xml) : parseNfeXml(xml)
}
