// Leitura da planilha ENTRADAS DIÁRIAS (LION) — o controle que a recepção preenche à mão.
//
// Não é relatório de sistema: é uma GRADE de Google Sheets desenhada pra ser lida por humano.
// Cada dia do mês ocupa um PAR de colunas (descrição, valor), e os dias vêm em blocos de dez
// empilhados. O mês inteiro de julho/2026 são 567 lançamentos em 132 linhas × 20 colunas.
//
//   1               2                 3              ...
//   Fulano - consulta - CRÉD  R$600,00   Ciclano - pix  R$150,00
//   Beltrano - 4 tricopill    R$597,00   ...
//   ...
//                             R$ 43.083,99   <- subtotal da própria planilha, sem descrição
//
// Quatro coisas dessa planilha quebram um parser ingênuo, e as quatro estão tratadas aqui:
//
//   1. SUBTOTAL NO MEIO DA COLUNA. Valor sem descrição é a soma do dia que a recepção fecha
//      na mão. Em julho são 29 deles, R$ 1.162.328 — contados como lançamento, dobram o mês.
//      Aqui viram conferência: se a nossa soma do dia bate com a dela, a leitura está certa.
//
//   2. O NÚMERO DO DIA SAI DA LINHA. No bloco 21-30 o "24" foi digitado uma linha acima dos
//      outros. Por isso a varredura é POR COLUNA, não por linha: cada marcador de dia abre
//      sua própria coluna e vale até o próximo marcador daquela coluna.
//
//   3. VÍRGULA COMO MILHAR. "R$2,500" é dois mil e quinhentos — tratado no toCents, ver
//      src/lib/planilha.ts. Sem aquilo, a entrada de transplante entrava como R$ 2,50.
//
//   4. MISTURA OS DOIS POLOS. Consulta e transplante são da clínica (Shosp); shampoo e
//      tricopill são varejo (Bling). Somar tudo junto quebra a regra da casa, então cada
//      lançamento é classificado — e o que não dá pra afirmar fica 'indefinido', não é
//      empurrado pro lado mais conveniente.

import * as XLSX from 'xlsx'

import { toCents } from '@/lib/planilha'
import { normalizarFormaPagamento, type PaymentMethod } from '@/services/shospVendas'

/** De que polo é o lançamento — decide onde a receita pode entrar. */
export type EntryKind = 'clinica' | 'varejo' | 'indefinido'

export type LionEntry = {
  day: number
  date: string // yyyy-mm-dd
  /** texto cru da célula, que é onde mora nome + o que foi vendido + forma */
  description: string
  /** nome do paciente, tirado do começo da descrição */
  customerName: string
  amountCents: number
  rawValue: string
  method: PaymentMethod
  kind: EntryKind
  row: number
  col: number
  /** identidade estável do lançamento, pra reimportar sem duplicar */
  key: string
}

export type LionParseResult = {
  entries: LionEntry[]
  /** somas que a própria planilha traz (valor sem descrição) — usadas só pra conferir */
  sheetTotals: Array<{ day: number | null; amountCents: number; row: number; col: number }>
  days: number[]
  year: number
  month: number
  /** células com valor que não deu pra aproveitar */
  skipped: number
  /** dias em que a nossa soma difere da soma escrita na planilha */
  conferencia: Array<{ day: number; nossoCents: number; planilhaCents: number; difCents: number }>
}

// ────────────────────────────────────────────────── classificação de polo

// Procedimento da clínica: é o que passa pelo Shosp e vira receita da clínica.
const RE_CLINICA =
  /\b(consulta|transplante|\btc\b|protocolo|sess[aã]o|sess[oõ]es|terapia|aplica[cç][aã]o|vitamina|sinal|nanofat|\bmmp\b|anestesista|lavagem|retorno|acomp|avulsa|infus[aã]o|ferinject|entrada de tc|pgto parcial de tc|hair pro)\b/i

// Varejo: produto de prateleira, que é polo Tricopill/Bling e NÃO passa pelo Shosp.
const RE_VAREJO =
  /\b(tricopill|shampoo|\bsh\b|cond\b|condicionador|m[aá]sc|mascara|m[aá]scara|pomada|t[oô]nico|tonico|leave\s?in|\bgel\b|perfume|spa black|kit|frete|elixir|olive|tea tree|refresh|flowers|pistache|dry confort|fine herbal|tonific|soft mind|touch energy|mix oil|revitamax|oz[oô]nio|classy|out frizz|herbal milk|detox|rhiza)\b/i

function classificar(desc: string): EntryKind {
  const clinica = RE_CLINICA.test(desc)
  const varejo = RE_VAREJO.test(desc)
  // "1 tricopill + consulta" existe: quando os dois batem, quem manda é a clínica, porque é
  // o lado que tem contrapartida no Shosp e é lá que a conferência acontece.
  if (clinica) return 'clinica'
  if (varejo) return 'varejo'
  return 'indefinido'
}

/**
 * Nome do cliente: o que vem antes do primeiro " - ".
 * A recepção escreve "Nome - o que foi - forma", com hífen separando. Sem separador,
 * devolve a descrição inteira aparada — melhor um nome comprido do que nenhum.
 */
export function nomeDaDescricao(desc: string): string {
  const limpo = desc.replace(/\s+/g, ' ').trim()
  const corte = limpo.split(/\s+-\s+|\s-(?=\s)|(?<=\S)-\s/)[0]
  return (corte || limpo).replace(/\s*\(.*?\)\s*/g, ' ').trim()
}

/**
 * Forma de pagamento: está no FIM do texto ("- CRED 10x", "- pix", "- DÉB.").
 * Tenta o último pedaço primeiro; o texto inteiro é o plano B, porque tem linha escrita
 * como "GRUPO INGÁ PIX" no meio.
 */
export function formaDaDescricao(desc: string): PaymentMethod {
  const partes = desc.split(/-/).map((p) => p.trim()).filter(Boolean)
  for (let i = partes.length - 1; i >= 0 && i >= partes.length - 2; i--) {
    const m = normalizarFormaPagamento(partes[i])
    if (m !== 'outro') return m
  }
  return normalizarFormaPagamento(desc)
}

// ────────────────────────────────────────────────── leitura

async function lerMatriz(file: File): Promise<unknown[][]> {
  const ehTexto = /\.(csv|txt|tsv)$/i.test(file.name) || /csv|text\/plain/i.test(file.type)
  const wb = ehTexto
    ? XLSX.read((await file.text()).replace(/^\uFEFF/, ''), { type: 'string', cellDates: true, raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, raw: true })
  const nome = wb.SheetNames[0]
  if (!nome) return []
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, defval: null, raw: true })
}

/** "ENTRADAS DIÁRIAS LION - JUL_2026.csv" → { year: 2026, month: 7 }. */
export function periodoDoNome(fileName: string): { year: number; month: number } | null {
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const s = fileName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const m = s.match(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*[\s_-]*(\d{4})\b/)
  if (!m) return null
  return { year: Number(m[2]), month: meses.indexOf(m[1]) + 1 }
}

const iso = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/**
 * Lê a planilha de entradas diárias.
 * `periodo` define o mês; sem ele, tenta o nome do arquivo (é onde o mês está escrito).
 */
export async function parseLionEntradas(
  file: File,
  periodo?: { year: number; month: number },
): Promise<LionParseResult> {
  const matrix = await lerMatriz(file)
  const p = periodo ?? periodoDoNome(file.name)
  const vazio: LionParseResult = {
    entries: [],
    sheetTotals: [],
    days: [],
    year: p?.year ?? 0,
    month: p?.month ?? 0,
    skipped: 0,
    conferencia: [],
  }
  if (!p || matrix.length === 0) return vazio

  const cel = (r: number, c: number): string => {
    const v = (matrix[r] ?? [])[c]
    return v == null ? '' : String(v).replace(/\s+/g, ' ').trim()
  }

  // ── marcadores de dia: célula com número puro de 1 a 31 e a célula ao lado vazia.
  // Por COLUNA, porque o número do dia nem sempre está na mesma linha dos vizinhos.
  const marcadores = new Map<number, Array<{ row: number; day: number }>>()
  for (let r = 0; r < matrix.length; r++) {
    const largura = Math.max(matrix[r]?.length ?? 0, 0)
    for (let c = 0; c < largura; c++) {
      const v = cel(r, c)
      if (!/^\d{1,2}$/.test(v)) continue
      const dia = Number(v)
      if (dia < 1 || dia > 31) continue
      if (cel(r, c + 1) !== '') continue // par (dia, vazio); com valor ao lado é lançamento
      const lista = marcadores.get(c) ?? []
      lista.push({ row: r, day: dia })
      marcadores.set(c, lista)
    }
  }
  if (marcadores.size === 0) return vazio

  const entries: LionEntry[] = []
  const sheetTotals: LionParseResult['sheetTotals'] = []
  const days = new Set<number>()
  let skipped = 0

  for (const [col, lista] of marcadores) {
    const ordenada = [...lista].sort((a, b) => a.row - b.row)
    for (let i = 0; i < ordenada.length; i++) {
      const { row, day } = ordenada[i]
      const fim = i + 1 < ordenada.length ? ordenada[i + 1].row : matrix.length
      days.add(day)
      for (let r = row + 1; r < fim; r++) {
        const desc = cel(r, col)
        const rawValue = cel(r, col + 1)
        if (!rawValue) continue
        const cents = toCents(rawValue)
        if (cents == null || cents === 0) {
          skipped += 1
          continue
        }
        if (!desc) {
          // valor sozinho = soma do dia escrita pela recepção
          sheetTotals.push({ day, amountCents: cents, row: r + 1, col })
          continue
        }
        entries.push({
          day,
          date: iso(p.year, p.month, day),
          description: desc,
          customerName: nomeDaDescricao(desc),
          amountCents: Math.abs(cents),
          rawValue,
          method: formaDaDescricao(desc),
          kind: classificar(desc),
          row: r + 1,
          col,
          key: `lion:${iso(p.year, p.month, day)}:${r + 1}:${col}`,
        })
      }
    }
  }

  // ── conferência: nossa soma do dia × soma escrita na planilha.
  // É o único jeito honesto de saber se a varredura pegou a coluna inteira: se a recepção
  // somou R$ 43.083,99 e a gente soma outra coisa, a leitura está errada e a tela precisa
  // dizer isso antes de alguém importar o mês.
  const nossoPorDia = new Map<number, number>()
  for (const e of entries) nossoPorDia.set(e.day, (nossoPorDia.get(e.day) ?? 0) + e.amountCents)
  const planilhaPorDia = new Map<number, number>()
  for (const t of sheetTotals) {
    if (t.day == null) continue
    planilhaPorDia.set(t.day, (planilhaPorDia.get(t.day) ?? 0) + t.amountCents)
  }
  const conferencia: LionParseResult['conferencia'] = []
  for (const [day, planilhaCents] of planilhaPorDia) {
    const nossoCents = nossoPorDia.get(day) ?? 0
    if (nossoCents !== planilhaCents) {
      conferencia.push({ day, nossoCents, planilhaCents, difCents: nossoCents - planilhaCents })
    }
  }
  conferencia.sort((a, b) => a.day - b.day)

  return {
    entries: entries.sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row),
    sheetTotals,
    days: [...days].sort((a, b) => a - b),
    year: p.year,
    month: p.month,
    skipped,
    conferencia,
  }
}
