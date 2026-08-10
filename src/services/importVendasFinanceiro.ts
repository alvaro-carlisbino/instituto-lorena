// Vendas do mês → contas a receber, e o cruzamento entre as duas fontes que a clínica tem.
//
// AS DUAS FONTES NÃO CONCORDAM, e essa é a razão desta tela existir. Julho/2026:
// o Shosp diz R$ 1.567.726 de clínica; a planilha da recepção diz R$ 1.532.092 de clínica.
// R$ 35.634 de diferença, mesma clínica, mesmo mês. Importar as duas somaria receita que
// não existe.
//
// A regra, então:
//
//   Shosp é a RECEITA da clínica. É sistema, tem código de venda, tem caixa, tem forma de
//     pagamento em campo próprio. É o que entra em contas a receber.
//
//   A planilha da recepção NÃO vira receita da clínica por conta própria. Ela serve pra
//     apontar: o que a recepção anotou e ninguém lançou no Shosp (dinheiro que existe e o
//     sistema não conhece), e o varejo de balcão, que é polo Tricopill e não passa no Shosp.
//     Importar isso é decisão explícita na tela, marcada uma a uma — nunca automática.
//
// E NADA disso vira lançamento de caixa por padrão. O extrato do banco já entra sozinho em
// fin_transactions pelo Open Finance, 3x por dia; lançar a venda lá também contaria o mesmo
// dinheiro duas vezes. A venda é o direito de receber, o extrato é o dinheiro, e a
// conciliação amarra os dois. A exceção é caixa SEM extrato (dinheiro em espécie, conta de
// terceiro): lá não existe feed nenhum, então sem o lançamento o saldo fica em zero pra
// sempre.

import { supabase } from '@/lib/supabaseClient'
import { difDias } from '@/lib/planilha'
import { PAYMENT_LABEL, type PaymentMethod, type ShospSale } from '@/services/shospVendas'
import type { EntryKind, LionEntry } from '@/services/lionEntradas'

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

/** Forma normalizada → o texto que o resto do financeiro já usa em `fin_receivables.method`. */
const METHOD_DB: Record<PaymentMethod, string> = {
  pix: 'pix',
  dinheiro: 'dinheiro',
  cartao_credito: 'cartao',
  cartao_debito: 'cartao',
  boleto: 'boleto',
  transferencia: 'transferencia',
  convenio: 'convenio',
  cheque: 'cheque',
  outro: 'outro',
}

/** Uma venda pronta pra virar conta a receber, venha de onde vier. */
export type EntradaImportavel = {
  externalId: string
  source: 'shosp' | 'lion'
  date: string
  customerName: string
  description: string
  amountCents: number
  method: PaymentMethod
  /** caixa do Shosp; a planilha da recepção não tem esse dado */
  caixa: string | null
  kind: EntryKind
}

export function vendaShospParaEntrada(s: ShospSale): EntradaImportavel {
  return {
    externalId: `shosp:${s.saleId || s.key}`,
    source: 'shosp',
    date: s.date,
    customerName: s.patient,
    description: s.services.length > 0 ? s.services.join(' + ') : 'Venda Shosp',
    amountCents: s.amountCents,
    method: s.method,
    caixa: s.caixa || null,
    kind: 'clinica',
  }
}

export function lancamentoLionParaEntrada(e: LionEntry): EntradaImportavel {
  return {
    externalId: e.key,
    source: 'lion',
    date: e.date,
    customerName: e.customerName,
    description: e.description,
    amountCents: e.amountCents,
    method: e.method,
    caixa: null,
    kind: e.kind,
  }
}

// ────────────────────────────────────────────────── cruzamento

export type ParLionShosp = {
  lion: LionEntry
  sale: ShospSale
  dayGap: number
  /** casou só por valor+data, sem o nome bater — vale conferir antes de confiar */
  nomeIncerto: boolean
}

/**
 * Uma venda que casa com VÁRIOS lançamentos, ou vários lançamentos que casam com uma venda.
 *
 * É o caso mais comum de "divergência" entre as duas fontes, e não é divergência nenhuma:
 * o Shosp registra a venda inteira numa linha só ("CC 5x/CD", R$ 4.320) e a recepção anota
 * uma linha por forma de pagamento (R$ 3.320 no crédito + R$ 1.000 no débito). Também
 * acontece ao contrário: "PROTOCOLO ALEXANDRE & PROTOCOLO JOSIELLY" numa linha da planilha
 * são duas vendas separadas no Shosp.
 */
export type ParComposto = {
  entries: LionEntry[]
  sales: ShospSale[]
  amountCents: number
}

export type CruzamentoResult = {
  casados: ParLionShosp[]
  /** 1 venda ↔ N lançamentos (pagamento dividido, procedimento somado) */
  compostos: ParComposto[]
  /** lançamento da recepção sem contrapartida no Shosp */
  soNaLion: LionEntry[]
  /** venda do Shosp que a recepção não anotou */
  soNoShosp: ShospSale[]
  totais: {
    lionCents: number
    lionClinicaCents: number
    lionVarejoCents: number
    shospCents: number
    casadosCents: number
    compostosCents: number
    soNaLionClinicaCents: number
    soNaLionVarejoCents: number
    soNoShospCents: number
  }
}

/**
 * Acha um subconjunto de até `max` itens cuja soma bate no alvo.
 *
 * Força bruta de propósito: o candidato já vem filtrado por nome e por dia, então a lista
 * tem meia dúzia de itens. Combinação de 3 em 6 é trivial — e o teto existe pra impedir que
 * uma lista grande vire explosão combinatória em cima de dado do usuário.
 */
function acharSoma<T>(itens: T[], valor: (t: T) => number, alvo: number, max = 3): T[] | null {
  const busca = (inicio: number, resta: number, faltam: number, acc: T[]): T[] | null => {
    if (resta === 0 && acc.length >= 2) return acc
    if (faltam === 0 || resta < 0) return null
    for (let i = inicio; i < itens.length; i++) {
      const v = valor(itens[i])
      if (v > resta) continue
      const r = busca(i + 1, resta - v, faltam - 1, [...acc, itens[i]])
      if (r) return r
    }
    return null
  }
  return busca(0, alvo, max, [])
}

/** Só os pedaços do nome que ajudam a identificar — tira preposição e inicial solta. */
function pedacos(nome: string): string[] {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3 && !['dos', 'das', 'de', 'da', 'do'].includes(p))
}

/** Dois pedaços em comum. Um só casaria "Maria" com "Maria" e trocaria paciente por paciente. */
function nomeBate(a: string, b: string): boolean {
  const pa = pedacos(a)
  const pb = new Set(pedacos(b))
  const comum = pa.filter((p) => pb.has(p)).length
  if (pa.length === 0 || pb.size === 0) return false
  return pa.length === 1 || pb.size === 1 ? comum >= 1 : comum >= 2
}

/**
 * Cruza a planilha da recepção com o relatório do Shosp.
 *
 * Casa por VALOR EXATO dentro de uma janela de dias, e o nome só desempata. É nessa ordem
 * porque o nome é digitado à mão nos dois lados e diverge à vontade ("Marcelle Thays" ×
 * "MARCELLE THAYS GOMES DA SILVA DALLA ROSA"), enquanto o valor é o mesmo número.
 */
export function cruzarLionComShosp(
  entries: LionEntry[],
  sales: ShospSale[],
  janelaDias = 1,
): CruzamentoResult {
  const porValor = new Map<number, ShospSale[]>()
  for (const s of sales) {
    const lista = porValor.get(s.amountCents) ?? []
    lista.push(s)
    porValor.set(s.amountCents, lista)
  }

  const usados = new Set<ShospSale>()
  const casados: ParLionShosp[] = []
  const soNaLion: LionEntry[] = []

  // Varejo não passa no Shosp por definição — procurar contrapartida lá só geraria par falso
  // por coincidência de valor (shampoo de R$ 119 casando com qualquer venda de R$ 119).
  const procuram = entries.filter((e) => e.kind !== 'varejo')
  const naoProcuram = entries.filter((e) => e.kind === 'varejo')

  for (const e of procuram) {
    const candidatos = (porValor.get(e.amountCents) ?? [])
      .filter((s) => !usados.has(s) && difDias(e.date, s.date) <= janelaDias)
      .sort((a, b) => {
        const na = nomeBate(e.customerName, a.patient) ? 0 : 1
        const nb = nomeBate(e.customerName, b.patient) ? 0 : 1
        if (na !== nb) return na - nb
        return difDias(e.date, a.date) - difDias(e.date, b.date)
      })
    const melhor = candidatos[0]
    if (!melhor) {
      soNaLion.push(e)
      continue
    }
    usados.add(melhor)
    casados.push({
      lion: e,
      sale: melhor,
      dayGap: difDias(e.date, melhor.date),
      nomeIncerto: !nomeBate(e.customerName, melhor.patient),
    })
  }

  // ── 2ª passada: 1 venda ↔ N lançamentos, e N vendas ↔ 1 lançamento.
  // Sem isto, todo pagamento dividido vira "some dos dois lados" — R$ 200 mil de divergência
  // falsa em julho/2026, que é mais do que a divergência de verdade.
  const compostos: ParComposto[] = []
  const sobraLion = new Set(soNaLion)
  const sobraShosp = new Set(sales.filter((s) => !usados.has(s)))

  for (const s of [...sobraShosp]) {
    const cand = [...sobraLion].filter(
      (e) => difDias(e.date, s.date) <= janelaDias && nomeBate(e.customerName, s.patient),
    )
    const achado = acharSoma(cand, (e) => e.amountCents, s.amountCents)
    if (!achado) continue
    for (const e of achado) sobraLion.delete(e)
    sobraShosp.delete(s)
    compostos.push({ entries: achado, sales: [s], amountCents: s.amountCents })
  }

  for (const e of [...sobraLion]) {
    const cand = [...sobraShosp].filter(
      (s) => difDias(e.date, s.date) <= janelaDias && nomeBate(e.customerName, s.patient),
    )
    const achado = acharSoma(cand, (s) => s.amountCents, e.amountCents)
    if (!achado) continue
    for (const s of achado) sobraShosp.delete(s)
    sobraLion.delete(e)
    compostos.push({ entries: [e], sales: achado, amountCents: e.amountCents })
  }

  const soNoShosp = [...sobraShosp]
  const soma = (n: number[]): number => n.reduce((a, b) => a + b, 0)
  const lionClinica = entries.filter((e) => e.kind !== 'varejo')
  const lionVarejo = naoProcuram

  const orfaosLion = [...sobraLion]
  return {
    casados,
    compostos,
    soNaLion: [...orfaosLion, ...naoProcuram].sort((a, b) => a.date.localeCompare(b.date)),
    soNoShosp,
    totais: {
      lionCents: soma(entries.map((e) => e.amountCents)),
      lionClinicaCents: soma(lionClinica.map((e) => e.amountCents)),
      lionVarejoCents: soma(lionVarejo.map((e) => e.amountCents)),
      shospCents: soma(sales.map((s) => s.amountCents)),
      casadosCents: soma(casados.map((c) => c.sale.amountCents)),
      compostosCents: soma(compostos.map((c) => c.amountCents)),
      soNaLionClinicaCents: soma(orfaosLion.map((e) => e.amountCents)),
      soNaLionVarejoCents: soma(naoProcuram.map((e) => e.amountCents)),
      soNoShospCents: soma(soNoShosp.map((s) => s.amountCents)),
    },
  }
}

// ────────────────────────────────────────────────── gravação

export type ImportOpts = {
  /** caixa do Shosp → id da conta do financeiro. Ausente/nulo = importa sem conta. */
  caixaParaConta?: Record<string, string | null>
  /** contas que NÃO têm extrato automático — só nelas a venda também vira lançamento */
  contasSemExtrato?: Set<string>
  categoryId?: string | null
  /** true = só conta o que faria, não escreve nada */
  dryRun?: boolean
}

export type ImportResult = {
  novas: number
  atualizadas: number
  lancamentosCaixa: number
  totalCents: number
  /** entradas que não deu pra gravar, com o motivo */
  falhas: Array<{ externalId: string; motivo: string }>
}

const CHUNK = 200

/**
 * Grava as entradas como contas a receber, de forma idempotente.
 *
 * A chave é `external_id`: rodar o mesmo mês duas vezes ATUALIZA a linha em vez de criar
 * outra. O relatório do Shosp é exportado à mão e reexportado quando alguém corrige um
 * lançamento — sem isso, a segunda importação dobrava o faturamento do mês.
 */
export async function importarEntradas(
  entradas: EntradaImportavel[],
  opts: ImportOpts = {},
): Promise<ImportResult> {
  const client = assertClient()
  const falhas: ImportResult['falhas'] = []
  if (entradas.length === 0) {
    return { novas: 0, atualizadas: 0, lancamentosCaixa: 0, totalCents: 0, falhas }
  }

  // Quem já existe, pra saber o que é novo e o que é correção — e pra não prometer
  // "300 importadas" quando 300 já estavam lá.
  const ids = entradas.map((e) => e.externalId)
  const existentes = new Set<string>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await client
      .from('fin_receivables')
      .select('external_id')
      .in('external_id', ids.slice(i, i + CHUNK))
    if (error) throw new Error(`Não consegui ler o que já foi importado: ${error.message}`)
    for (const r of data ?? []) if (r.external_id) existentes.add(String(r.external_id))
  }

  const contaDe = (caixa: string | null): string | null =>
    caixa ? (opts.caixaParaConta?.[caixa] ?? null) : null

  const linhas = entradas.map((e) => ({
    external_id: e.externalId,
    source: e.source,
    description: `${e.description}`.slice(0, 300),
    customer_name: e.customerName || null,
    category_id: opts.categoryId || null,
    account_id: contaDe(e.caixa),
    due_date: e.date,
    amount_cents: e.amountCents,
    // O relatório é de vendas REALIZADAS: o dinheiro já foi cobrado, então nasce recebido.
    // O que a conciliação ainda vai dizer é se ele CAIU na conta — que é outra pergunta.
    status: 'recebido',
    received_at: `${e.date}T12:00:00`,
    received_amount_cents: e.amountCents,
    method: METHOD_DB[e.method],
    note: `Importado de ${e.source === 'shosp' ? 'Shosp' : 'planilha da recepção'}${
      e.caixa ? ` · caixa ${e.caixa}` : ''
    } · ${PAYMENT_LABEL[e.method]}`,
  }))

  const novas = entradas.filter((e) => !existentes.has(e.externalId)).length
  const atualizadas = entradas.length - novas
  const totalCents = entradas.reduce((a, e) => a + e.amountCents, 0)

  if (opts.dryRun) {
    return { novas, atualizadas, lancamentosCaixa: 0, totalCents, falhas }
  }

  for (let i = 0; i < linhas.length; i += CHUNK) {
    const chunk = linhas.slice(i, i + CHUNK)
    const { error } = await client
      .from('fin_receivables')
      .upsert(chunk, { onConflict: 'tenant_id,external_id' })
    if (error) {
      for (const l of chunk) falhas.push({ externalId: l.external_id, motivo: error.message })
    }
  }

  // Caixa sem extrato: aqui o lançamento é a ÚNICA prova do dinheiro, então entra.
  // Nas contas com Open Finance não entra, senão o mesmo dinheiro aparece duas vezes.
  let lancamentosCaixa = 0
  const semExtrato = opts.contasSemExtrato
  if (semExtrato && semExtrato.size > 0) {
    const paraCaixa = entradas
      .map((e) => ({ e, contaId: contaDe(e.caixa) }))
      .filter((x) => x.contaId && semExtrato.has(x.contaId))
    const txns = paraCaixa.map(({ e, contaId }) => ({
      account_id: contaId,
      date: e.date,
      amount_cents: e.amountCents,
      direction: 'in',
      description: `${e.customerName || 'Venda'} — ${e.description}`.slice(0, 300),
      source: 'csv',
      external_id: `venda:${e.externalId}`,
    }))
    for (let i = 0; i < txns.length; i += CHUNK) {
      const chunk = txns.slice(i, i + CHUNK)
      const { data, error } = await client
        .from('fin_transactions')
        .upsert(chunk, { onConflict: 'tenant_id,account_id,external_id', ignoreDuplicates: true })
        .select('id')
      if (error) {
        falhas.push({ externalId: 'lançamentos de caixa', motivo: error.message })
        break
      }
      lancamentosCaixa += (data ?? []).length
    }
  }

  return { novas, atualizadas, lancamentosCaixa, totalCents, falhas }
}

/** Desfaz uma importação inteira — a saída de emergência de quem importou o mês errado. */
export async function desfazerImportacao(source: 'shosp' | 'lion', de: string, ate: string): Promise<number> {
  const client = assertClient()
  const { data, error } = await client
    .from('fin_receivables')
    .delete()
    .eq('source', source)
    .gte('due_date', de)
    .lte('due_date', ate)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length
}
