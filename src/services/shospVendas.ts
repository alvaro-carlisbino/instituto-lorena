// Leitura do RELATÓRIO DE VENDAS REALIZADAS do Shosp (xlsx/xls/csv exportado na mão pelo painel).
// A API que integramos (crm-shosp) só tem agenda/paciente — não existe endpoint financeiro,
// então o caminho é upload de arquivo mesmo.
//
// O layout padrão do export (documentado em docs/shosp-relatorio-vendas.md) é:
//
//   Cod;Data;Hora;Paciente;CPF;Unidade;Plano de Saúde;Caixa;Prestador;Servico;Qtd Serv.;
//   V. Serv;N.F.A;F. Pagam.;Bandeira;Terceiro;Status;V. Total;V. Rec.;V. Troco;V. Desc.;V. Cobr.
//
// Três coisas desse layout mudam o resultado e por isso estão tratadas aqui:
//
//   1. UMA LINHA POR SERVIÇO, não por venda. Venda com 3 procedimentos vem em 3 linhas, e
//      V. Total / V. Cobr. vêm REPETIDOS em cada uma. Somar linha a linha infla o mês (no
//      export de julho/2026: R$ 1.574.921 contra os R$ 1.567.726 de verdade). Aqui as linhas
//      do mesmo `Cod` viram UMA venda, com a lista de serviços junto.
//
//   2. FORMA DE PAGAMENTO É CÓDIGO, não texto: PX, CC, CD, DN, DB — e a parcela vem colada
//      ("CC 10x"), com pagamento dividido separado por barra ("CC 6x/PX").
//
//   3. CAIXA diz em que conta o dinheiro entrou. Venda com caixa de terceiro (anestesista,
//      outra praça) nunca vai aparecer no extrato do Itaú; sem isso vira "não caiu no banco"
//      falso — em julho/2026 seriam R$ 44.400 acusados errado.
//
// Ainda assim a detecção continua por APELIDO de cabeçalho com varredura das primeiras linhas:
// o export do Shosp não é contrato, coluna some e muda de nome. O resultado devolve o mapa de
// colunas usado para a tela mostrar e o usuário poder corrigir.

import * as XLSX from 'xlsx'

import { normHeader, pickCol, toCents, toISODate } from '@/lib/planilha'

/** Forma de pagamento normalizada. O que decide a REGRA de conciliação lá no motor. */
export type PaymentMethod =
  | 'pix'
  | 'dinheiro'
  | 'cartao_credito'
  | 'cartao_debito'
  | 'boleto'
  | 'transferencia'
  | 'convenio'
  | 'cheque'
  | 'outro'

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: 'PIX',
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  boleto: 'Boleto',
  transferencia: 'Transferência / TED',
  convenio: 'Convênio',
  cheque: 'Cheque',
  outro: 'Outro',
}

/** Cai 1 pra 1 na conta, no mesmo valor e quase na mesma data → dá pra casar lançamento a lançamento. */
export const METODOS_UM_PRA_UM: PaymentMethod[] = ['pix', 'transferencia', 'boleto']
/** Vira repasse do adquirente: agrupado, líquido de taxa e com dias de atraso → casa por dia. */
export const METODOS_CARTAO: PaymentMethod[] = ['cartao_credito', 'cartao_debito']

export type ShospSale = {
  /** `Cod` do Shosp — identidade da venda. Vazio em export que não traz a coluna. */
  saleId: string
  date: string // yyyy-mm-dd
  patient: string
  cpf: string
  amountCents: number
  /** forma principal; em pagamento dividido é a primeira reconhecida */
  method: PaymentMethod
  /** todas as formas da venda — mais de uma quando o pagamento foi dividido */
  methods: PaymentMethod[]
  /** pagamento dividido entre formas ("CC 6x/PX"): o Shosp não diz quanto foi em cada uma */
  mixed: boolean
  methodRaw: string
  installments: number
  /** conta/caixa onde o Shosp lançou o dinheiro */
  caixa: string
  /** serviços da venda (uma linha da planilha cada) */
  services: string[]
  provider: string
  doc: string
  status: string
  /** linha na planilha (1-based, como o Excel mostra) — pro usuário achar o registro */
  rowNumber: number
  /** todas as linhas que formaram esta venda */
  rowNumbers: number[]
  /** identidade da venda, usada pra achar registro repetido no próprio arquivo */
  key: string
}

export type ShospColumnKey =
  | 'date'
  | 'patient'
  | 'cpf'
  | 'amount'
  | 'method'
  | 'installments'
  | 'caixa'
  | 'service'
  | 'provider'
  | 'doc'
  | 'status'

export type ShospColumnMap = Record<ShospColumnKey, number>

export type ResumoCaixa = { name: string; qtd: number; amountCents: number }

export type ShospParseResult = {
  sales: ShospSale[]
  /** cabeçalhos originais da linha detectada como cabeçalho */
  headers: string[]
  map: ShospColumnMap
  headerRowIndex: number
  sheetName: string
  /** linhas de dado aproveitadas (antes de agrupar por venda) */
  rowsRead: number
  /** linhas que eram serviço a mais de uma venda já contada — a diferença linha × venda */
  groupedRows: number
  /** linhas puladas por não terem data ou valor aproveitável */
  skipped: number
  /** linhas descartadas por status cancelado/estornado */
  canceled: number
  /** situações encontradas e quantas vezes — o Shosp usa letra ("A"), então fica à vista */
  statusCounts: Array<{ status: string; qtd: number }>
  /** caixas encontrados, com volume: é a lista que a tela usa pra marcar o que não está no extrato */
  caixas: ResumoCaixa[]
  /** vendas com pagamento dividido entre formas */
  mixedCount: number
}

// ────────────────────────────────────────────────── apelidos de cabeçalho

const ALIASES: Record<ShospColumnKey, string[]> = {
  // "data pagamento" antes de "data" — num extrato de RECEBIMENTO o que importa é quando
  // o dinheiro entrou, não quando o procedimento foi feito.
  date: [
    'data pagamento',
    'data do pagamento',
    'data recebimento',
    'data do recebimento',
    'data baixa',
    'data credito',
    'dt pagamento',
    'pagamento em',
    'data',
    'dt',
  ],
  patient: ['paciente', 'cliente', 'nome do paciente', 'nome paciente', 'nome'],
  cpf: ['cpf', 'cpf/cnpj', 'documento do paciente'],
  // "V. Cobr." (valor cobrado) é o que a clínica tem a receber daquela venda — já sem desconto
  // e sem troco. Vem antes de "V. Total" porque as duas existem no mesmo arquivo, e antes de
  // "V. Rec." porque recebido é o que o paciente entregou (em dinheiro pode incluir troco, e
  // no cartão parcelado traz o centavo do arredondamento das parcelas).
  amount: [
    'valor cobrado',
    'v. cobr',
    'v cobr',
    'valor pago',
    'valor recebido',
    'valor liquido',
    'vl pago',
    'vl recebido',
    'valor total',
    'v. total',
    'v total',
    'total',
    'valor',
  ],
  method: [
    'forma de pagamento',
    'forma pagamento',
    'forma pagto',
    'f. pagam',
    'f pagam',
    'meio de pagamento',
    'meio pagamento',
    'tipo pagamento',
    'condicao pagamento',
    'forma',
  ],
  installments: ['parcelas', 'qtd parcelas', 'qtde parcelas', 'n parcelas', 'numero de parcelas', 'parcela'],
  caixa: ['caixa', 'conta', 'conta bancaria', 'banco'],
  // "Qtd Serv." não entra: é quantidade, não nome. Sem 'servico' cru primeiro, 'procedimento'
  // de outros layouts continua pegando.
  service: ['servico', 'procedimento', 'descricao do servico', 'item'],
  provider: ['prestador', 'profissional', 'medico', 'executante'],
  doc: ['cod', 'codigo', 'recibo', 'documento', 'numero documento', 'nr documento', 'lancamento', 'nota', 'id'],
  status: ['situacao', 'status', 'estado'],
}

const CHAVES: ShospColumnKey[] = [
  'date',
  'patient',
  'cpf',
  'amount',
  'method',
  'installments',
  'caixa',
  'service',
  'provider',
  'doc',
  'status',
]

function mapearColunas(headers: string[]): ShospColumnMap {
  const map = {} as ShospColumnMap
  const usados = new Set<number>()
  for (const chave of CHAVES) {
    // apelido mais específico primeiro; não deixa duas chaves apontarem pra mesma coluna
    let idx = -1
    for (const apelido of ALIASES[chave]) {
      const i = pickCol(headers, apelido)
      if (i >= 0 && !usados.has(i)) {
        idx = i
        break
      }
    }
    if (idx >= 0) usados.add(idx)
    map[chave] = idx
  }
  return map
}

/** Quantos apelidos conhecidos a linha reconhece — usado pra achar onde está o cabeçalho. */
function pontuarComoCabecalho(row: unknown[]): number {
  const headers = row.map(normHeader)
  let score = 0
  for (const chave of CHAVES) {
    if (pickCol(headers, ...ALIASES[chave]) >= 0) score += 1
  }
  return score
}

// ────────────────────────────────────────────────── forma de pagamento

/**
 * Códigos do Shosp. São siglas de 2 letras, então só valem em casamento EXATO — soltas num
 * `includes` pegariam qualquer palavra.
 *
 * `DB` é lido como depósito bancário: `CD` já é o cartão de débito nesse mesmo relatório, e o
 * único caso do export de julho/2026 é um pagamento de R$ 37.800 no caixa do Itaú — valor que
 * não sai de maquininha. Se um dia aparecer como outra coisa, o efeito é conciliar 1 pra 1
 * uma venda que não deveria, e ela aparece na tela como divergência, não some.
 */
const CODIGO_FORMA: Record<string, PaymentMethod> = {
  px: 'pix',
  pix: 'pix',
  cc: 'cartao_credito',
  cd: 'cartao_debito',
  dn: 'dinheiro',
  dh: 'dinheiro',
  db: 'transferencia',
  ted: 'transferencia',
  tr: 'transferencia',
  ch: 'cheque',
  bl: 'boleto',
  bo: 'boleto',
}

/** Tira a parcela colada na forma: "CC 10x" → "cc". */
function semParcela(s: string): string {
  return s
    .replace(/\b\d{1,2}\s*x\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Texto livre (ou código) do Shosp → forma normalizada. A ordem importa: "cartão" antes de "débito" solto. */
export function normalizarFormaPagamento(raw: unknown): PaymentMethod {
  const s = normHeader(raw)
  if (!s) return 'outro'
  // código exato primeiro: sigla de 2 letras não sobrevive às heurísticas de texto abaixo
  const codigo = CODIGO_FORMA[semParcela(s)]
  if (codigo) return codigo
  if (s.includes('pix')) return 'pix'
  if (/pagseguro|pagbank|mercado pago|picpay/.test(s)) return 'pix'
  if (s.includes('boleto')) return 'boleto'
  if (s.includes('cheque')) return 'cheque'
  if (/conveni|plano de saude|unimed|amil|sulamerica|bradesco saude|cassi|ipe/.test(s)) return 'convenio'
  if (/dinheiro|especie|a vista em especie|caixa/.test(s)) return 'dinheiro'
  // cartão: decide crédito × débito
  const ehCartao = /cart|credito|crédito|debito|débito|visa|master|elo|amex|hiper/.test(s)
  if (ehCartao) {
    if (/debito|débito/.test(s)) return 'cartao_debito'
    return 'cartao_credito'
  }
  if (/transfer|ted|doc |deposito|depósito/.test(s)) return 'transferencia'
  return 'outro'
}

export type FormaPagamento = {
  method: PaymentMethod
  methods: PaymentMethod[]
  mixed: boolean
  installments: number
}

/**
 * Lê a coluna "F. Pagam." inteira: forma(s) + parcelas.
 * "CC 10x" → crédito em 10x. "CC 6x/PX" → dividido entre crédito 6x e PIX.
 */
export function parseFormaPagamento(raw: unknown): FormaPagamento {
  const s = String(raw ?? '').trim()
  const partes = s
    .split(/[/+]|\se\s/i)
    .map((p) => p.trim())
    .filter(Boolean)

  const methods: PaymentMethod[] = []
  let parcelas = 1
  for (const parte of partes) {
    const m = parte.match(/(\d{1,2})\s*x\b/i)
    if (m) parcelas = Math.max(parcelas, Number(m[1]) || 1)
    const metodo = normalizarFormaPagamento(parte)
    if (!methods.includes(metodo)) methods.push(metodo)
  }

  // nenhuma parte reconhecida: tenta o texto inteiro antes de desistir
  const reconhecidos = methods.filter((m) => m !== 'outro')
  if (reconhecidos.length === 0) {
    const inteiro = normalizarFormaPagamento(s)
    return { method: inteiro, methods: [inteiro], mixed: false, installments: parcelas }
  }

  return {
    method: reconhecidos[0],
    methods: reconhecidos,
    mixed: reconhecidos.length > 1,
    installments: parcelas,
  }
}

const STATUS_MORTO = /cancelad|estornad|extornad|excluid|deletad|anulad/

// ────────────────────────────────────────────────── parser

async function lerMatriz(file: File): Promise<{ matrix: unknown[][]; sheetName: string }> {
  // CSV vai por TEXTO, não por bytes. O relatório do Shosp sai em UTF-8 sem BOM, e o SheetJS
  // sem BOM decide sozinho que os bytes são latin-1: "VINÍCIUS" chega "VINÃCIUS" e o nome do
  // paciente deixa de casar com a descrição do lançamento no banco. `file.text()` já decodifica
  // como UTF-8 e o SheetJS recebe string pronta.
  const ehTexto = /\.(csv|txt|tsv)$/i.test(file.name) || /csv|text\/plain/i.test(file.type)

  // `raw: true` é obrigatório e a razão é chata: sem ele, o parser de CSV do SheetJS
  // adivinha data no padrão AMERICANO. "10/07/2026" (10 de julho) volta como 7 de OUTUBRO,
  // enquanto "25/12/2026" fica string porque não existe mês 25 — ou seja, metade da coluna
  // desloca de mês e a outra metade não, calado. Com `raw` a célula de CSV chega como texto
  // e quem converte é o nosso toISODate, que sabe que dd/mm/yyyy é o formato daqui.
  // `cellDates` continua ligado: em xlsx de verdade a data é serial e volta como Date certa.
  const wb = ehTexto
    ? XLSX.read((await file.text()).replace(/^\uFEFF/, ''), { type: 'string', cellDates: true, raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, raw: true })

  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { matrix: [], sheetName: '' }
  const sheet = wb.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true })
  return { matrix, sheetName }
}

const MAPA_VAZIO: ShospColumnMap = {
  date: -1,
  patient: -1,
  cpf: -1,
  amount: -1,
  method: -1,
  installments: -1,
  caixa: -1,
  service: -1,
  provider: -1,
  doc: -1,
  status: -1,
}

/**
 * Lê o relatório de vendas do Shosp.
 * `override` deixa a tela corrigir uma coluna que a detecção errou (índice da coluna, -1 = ignorar).
 */
export async function parseShospSales(
  file: File,
  override?: Partial<ShospColumnMap>,
): Promise<ShospParseResult> {
  const { matrix, sheetName } = await lerMatriz(file)
  const vazio: ShospParseResult = {
    sales: [],
    headers: [],
    map: { ...MAPA_VAZIO },
    headerRowIndex: -1,
    sheetName,
    rowsRead: 0,
    groupedRows: 0,
    skipped: 0,
    canceled: 0,
    statusCounts: [],
    caixas: [],
    mixedCount: 0,
  }
  if (matrix.length < 2) return vazio

  // O Shosp costuma cuspir título/filtro antes da tabela — procura o cabeçalho de verdade.
  let headerRowIndex = 0
  let melhorScore = -1
  const limite = Math.min(matrix.length, 15)
  for (let r = 0; r < limite; r++) {
    const score = pontuarComoCabecalho(matrix[r] ?? [])
    if (score > melhorScore) {
      melhorScore = score
      headerRowIndex = r
    }
  }
  // Nenhuma linha reconheceu nada: sem cabeçalho utilizável, melhor devolver vazio
  // do que adivinhar posição e inventar venda.
  if (melhorScore <= 0) return vazio

  const headersRaw = (matrix[headerRowIndex] ?? []).map((h) => String(h ?? '').trim())
  const headers = headersRaw.map(normHeader)
  const map = { ...mapearColunas(headers), ...(override ?? {}) } as ShospColumnMap

  // Sem data ou sem valor não dá pra conciliar nada.
  if (map.date < 0 || map.amount < 0) {
    return { ...vazio, headers: headersRaw, map, headerRowIndex, sheetName }
  }

  const cell = (row: unknown[], idx: number): unknown => (idx >= 0 ? row[idx] : null)
  const texto = (row: unknown[], idx: number): string => String(cell(row, idx) ?? '').trim()

  const sales: ShospSale[] = []
  /** venda já aberta, por `Cod` — é aqui que a linha-por-serviço vira linha-por-venda */
  const porCodigo = new Map<string, ShospSale>()
  const status = new Map<string, number>()
  let rowsRead = 0
  let groupedRows = 0
  let skipped = 0
  let canceled = 0

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? []
    const date = toISODate(cell(row, map.date))
    const amountCents = toCents(cell(row, map.amount))
    if (!date || amountCents == null || amountCents === 0) {
      skipped += 1
      continue // linha de total, separador, rodapé
    }

    const situacao = texto(row, map.status)
    if (STATUS_MORTO.test(normHeader(situacao))) {
      canceled += 1
      continue // venda cancelada/estornada não tem que bater com o banco
    }
    // Situação em código de uma letra ("A") não dá pra interpretar sem chutar, então em vez
    // de adivinhar o parser CONTA e a tela mostra. Sumir com venda por palpite é pior do que
    // deixar o usuário ver que apareceu uma situação nova no arquivo.
    const chaveStatus = situacao || '—'
    status.set(chaveStatus, (status.get(chaveStatus) ?? 0) + 1)

    rowsRead += 1

    const methodRaw = texto(row, map.method)
    const forma = parseFormaPagamento(methodRaw)
    const patient = texto(row, map.patient)
    const doc = texto(row, map.doc)
    const servico = texto(row, map.service)
    // valor negativo em extrato costuma ser estorno; guarda o módulo e deixa o sinal pro status
    const valor = Math.abs(amountCents)

    // Coluna de parcelas própria ganha da parcela colada na forma ("CC 10x").
    const parcelasCol = Number(texto(row, map.installments).replace(/\D/g, ''))
    const installments = Number.isFinite(parcelasCol) && parcelasCol > 0 ? parcelasCol : forma.installments

    // Mesmo `Cod` = mesma venda em mais de um serviço. Só junta se data, valor e forma baterem:
    // se divergirem, não é linha-por-serviço, é código reaproveitado — aí cada uma vira venda.
    const anterior = doc ? porCodigo.get(doc) : undefined
    if (anterior && anterior.date === date && anterior.amountCents === valor && anterior.methodRaw === methodRaw) {
      if (servico && !anterior.services.includes(servico)) anterior.services.push(servico)
      anterior.rowNumbers.push(r + 1)
      groupedRows += 1
      continue
    }

    const venda: ShospSale = {
      saleId: doc,
      date,
      patient,
      cpf: texto(row, map.cpf).replace(/\D/g, ''),
      amountCents: valor,
      method: forma.method,
      methods: forma.methods,
      mixed: forma.mixed,
      methodRaw,
      installments,
      caixa: texto(row, map.caixa),
      services: servico ? [servico] : [],
      provider: texto(row, map.provider),
      doc,
      status: situacao,
      rowNumber: r + 1,
      rowNumbers: [r + 1],
      // Com `Cod` a identidade é ele; sem ele, cai no combinado que existia antes.
      key: doc
        ? `cod:${doc}`
        : [date, patient.toUpperCase(), String(valor), normHeader(methodRaw)].join('|'),
    }
    sales.push(venda)
    if (doc) porCodigo.set(doc, venda)
  }

  const caixas = new Map<string, ResumoCaixa>()
  for (const s of sales) {
    const name = s.caixa || '—'
    const atual = caixas.get(name) ?? { name, qtd: 0, amountCents: 0 }
    atual.qtd += 1
    atual.amountCents += s.amountCents
    caixas.set(name, atual)
  }

  return {
    sales,
    headers: headersRaw,
    map,
    headerRowIndex,
    sheetName,
    rowsRead,
    groupedRows,
    skipped,
    canceled,
    statusCounts: [...status.entries()]
      .map(([s, qtd]) => ({ status: s, qtd }))
      .sort((a, b) => b.qtd - a.qtd),
    caixas: [...caixas.values()].sort((a, b) => b.amountCents - a.amountCents),
    mixedCount: sales.filter((s) => s.mixed).length,
  }
}
