// Leitura do EXTRATO DE VENDAS do Shosp (xlsx/xls/csv exportado na mão pelo painel).
// A API que integramos (crm-shosp) só tem agenda/paciente — não existe endpoint financeiro,
// então o caminho é upload de arquivo mesmo.
//
// O layout do export do Shosp não é contrato: coluna some, muda de nome, vem título antes
// do cabeçalho. Por isso aqui a detecção é por APELIDO de cabeçalho + varredura das
// primeiras linhas atrás da linha que mais parece cabeçalho, e o resultado devolve o mapa
// de colunas que foi usado para a tela poder mostrar e o usuário poder corrigir.

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
  date: string // yyyy-mm-dd
  patient: string
  amountCents: number
  method: PaymentMethod
  methodRaw: string
  installments: number
  doc: string
  status: string
  /** linha na planilha (1-based, como o Excel mostra) — pro usuário achar o registro */
  rowNumber: number
  /** identidade da venda, usada pra achar linha repetida no próprio arquivo */
  key: string
}

export type ShospColumnKey = 'date' | 'patient' | 'amount' | 'method' | 'installments' | 'doc' | 'status'

export type ShospColumnMap = Record<ShospColumnKey, number>

export type ShospParseResult = {
  sales: ShospSale[]
  /** cabeçalhos originais da linha detectada como cabeçalho */
  headers: string[]
  map: ShospColumnMap
  headerRowIndex: number
  sheetName: string
  /** linhas puladas por não terem data ou valor aproveitável */
  skipped: number
  /** linhas descartadas por status cancelado/estornado */
  canceled: number
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
  amount: [
    'valor pago',
    'valor recebido',
    'valor liquido',
    'vl pago',
    'vl recebido',
    'valor total',
    'total',
    'valor',
  ],
  method: [
    'forma de pagamento',
    'forma pagamento',
    'forma pagto',
    'meio de pagamento',
    'meio pagamento',
    'tipo pagamento',
    'condicao pagamento',
    'forma',
  ],
  installments: ['parcelas', 'qtd parcelas', 'qtde parcelas', 'n parcelas', 'numero de parcelas', 'parcela'],
  doc: ['recibo', 'documento', 'numero documento', 'nr documento', 'lancamento', 'codigo', 'id', 'nota'],
  status: ['situacao', 'status', 'estado'],
}

const CHAVES: ShospColumnKey[] = ['date', 'patient', 'amount', 'method', 'installments', 'doc', 'status']

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

/** Texto livre do Shosp → forma normalizada. A ordem importa: "cartão" antes de "débito" solto. */
export function normalizarFormaPagamento(raw: unknown): PaymentMethod {
  const s = normHeader(raw)
  if (!s) return 'outro'
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

const STATUS_MORTO = /cancelad|estornad|extornad|excluid|deletad|anulad/

// ────────────────────────────────────────────────── parser

function lerMatriz(buf: ArrayBuffer): { matrix: unknown[][]; sheetName: string } {
  // `raw: true` é obrigatório e a razão é chata: sem ele, o parser de CSV do SheetJS
  // adivinha data no padrão AMERICANO. "10/07/2026" (10 de julho) volta como 7 de OUTUBRO,
  // enquanto "25/12/2026" fica string porque não existe mês 25 — ou seja, metade da coluna
  // desloca de mês e a outra metade não, calado. Com `raw` a célula de CSV chega como texto
  // e quem converte é o nosso toISODate, que sabe que dd/mm/yyyy é o formato daqui.
  // `cellDates` continua ligado: em xlsx de verdade a data é serial e volta como Date certa.
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { matrix: [], sheetName: '' }
  const sheet = wb.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true })
  return { matrix, sheetName }
}

/**
 * Lê o extrato de vendas do Shosp.
 * `override` deixa a tela corrigir uma coluna que a detecção errou (índice da coluna, -1 = ignorar).
 */
export async function parseShospSales(
  file: File,
  override?: Partial<ShospColumnMap>,
): Promise<ShospParseResult> {
  const { matrix, sheetName } = lerMatriz(await file.arrayBuffer())
  const vazio: ShospParseResult = {
    sales: [],
    headers: [],
    map: { date: -1, patient: -1, amount: -1, method: -1, installments: -1, doc: -1, status: -1 },
    headerRowIndex: -1,
    sheetName,
    skipped: 0,
    canceled: 0,
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

  const sales: ShospSale[] = []
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

    const status = String(cell(row, map.status) ?? '').trim()
    if (STATUS_MORTO.test(normHeader(status))) {
      canceled += 1
      continue // venda cancelada/estornada não tem que bater com o banco
    }

    const methodRaw = String(cell(row, map.method) ?? '').trim()
    const patient = String(cell(row, map.patient) ?? '').trim()
    const doc = String(cell(row, map.doc) ?? '').trim()
    const parcelasRaw = Number(String(cell(row, map.installments) ?? '').replace(/\D/g, ''))
    const installments = Number.isFinite(parcelasRaw) && parcelasRaw > 0 ? parcelasRaw : 1

    sales.push({
      date,
      patient,
      // valor negativo em extrato costuma ser estorno; guarda o módulo e deixa o sinal pro status
      amountCents: Math.abs(amountCents),
      method: normalizarFormaPagamento(methodRaw),
      methodRaw,
      installments,
      doc,
      status,
      rowNumber: r + 1,
      key: [date, patient.toUpperCase(), String(Math.abs(amountCents)), normHeader(methodRaw), doc].join('|'),
    })
  }

  return { sales, headers: headersRaw, map, headerRowIndex, sheetName, skipped, canceled }
}
