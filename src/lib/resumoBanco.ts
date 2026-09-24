// O MÊS NO BANCO, NA LÍNGUA DE QUEM DECIDE.
//
// As contas do "Resumo do mês" (pedido do Kauan em 24/set/2026, para apresentar o mês ao Dr.).
// Tudo aqui é do extrato da CONTA CORRENTE: é o dinheiro que de fato entrou e saiu. O cartão
// entra pelo boleto da fatura, como uma classe própria que abre nas compras (ver faturaCartao).
// Quem quer a despesa pelo mês da compra olha Gastos; quem quer resultado olha o DRE.
//
// Ficam FORA dos totais, mas à vista numa linha própria, o dinheiro que só trocou de lugar:
// transferência entre contas, aplicação e resgate. Sem isso um resgate de R$ 180 mil vira o
// "melhor dia de faturamento do mês".
//
// Cor segue a classe, nunca a posição no ranking: Pessoas é sempre a cor 1, em qualquer mês e
// em qualquer filtro. A ordem das classes é fixa e é ela que escolhe a cor.

import { GRUPO_FORA_DO_TOTAL } from '@/lib/centroCusto'
import { CENTRO_CARTAO, ehPagamentoDeFatura } from '@/lib/faturaCartao'
import { periodoAnterior, periodoPersonalizado, rotuloDoMes, type Periodo } from '@/lib/periodo'
import type { CostCenter } from '@/services/financeiro'

export const SEM_CENTRO = 'Sem centro de custo'
export const OUTROS_GRUPOS = 'Outros'
export const FORA_DO_TOTAL = 'Só mudou de conta'

/** Grupos de saída na ordem que dá a cor (1 a 6). Mesma ordem do seletor de centro de custo. */
export const CLASSES_SAIDA = ['Pessoas', 'Operação', 'Estrutura', 'Comercial', 'Impostos e sócios', CENTRO_CARTAO] as const

/** Formas de entrada na ordem que dá a cor (1 a 4). */
export const CLASSES_ENTRADA = ['PIX', 'Maquininha de cartão', 'TED e DOC', 'Outras entradas'] as const

export type Direcao = 'in' | 'out'

export type Movimento = {
  id: string
  data: string
  direcao: Direcao
  /** Sempre positivo. */
  amountCents: number
  descricao: string
  /** Quem recebeu ou quem pagou, como a tela mostra. */
  nome: string
  centro: string | null
  detalhe: string | null
  categoria: string | null
}

export type MovimentoClassificado = Movimento & {
  /** Grupo da saída ou forma da entrada. `FORA_DO_TOTAL` quando só trocou de lugar. */
  classe: string
  foraDoTotal: boolean
  /** Boleto da fatura do cartão. */
  fatura: boolean
}

/**
 * De onde veio a entrada, pelo trilho que o Itaú escreve na frente. O extrato quase nunca tem
 * categoria de receita (174 de 175 entradas de agosto sem), então a categoria só decide quando
 * diz "não é receita"; o resto sai da descrição, que sempre existe.
 */
export function formaDaEntrada(descricao: string, categoria: string | null): { classe: string; foraDoTotal: boolean } {
  if (categoria && /não é receita/i.test(categoria)) return { classe: FORA_DO_TOTAL, foraDoTotal: true }
  const d = descricao.replace(/\s+/g, ' ').trim().toUpperCase()
  // "RES APLIC AUT MAIS": resgate da aplicação automática. É o dinheiro da própria clínica voltando.
  if (/^RES\.? ?APLIC|^RESGATE/.test(d)) return { classe: FORA_DO_TOTAL, foraDoTotal: true }
  if (/^REDE\b|CIELO|STONE|GETNET|PAGSEGURO|SUMUP|SAFRAPAY/.test(d)) return { classe: 'Maquininha de cartão', foraDoTotal: false }
  if (/^PIX\b/.test(d)) return { classe: 'PIX', foraDoTotal: false }
  if (/^(TED|DOC)\b/.test(d)) return { classe: 'TED e DOC', foraDoTotal: false }
  return { classe: 'Outras entradas', foraDoTotal: false }
}

/** Para onde foi a saída: o grupo do centro de custo, o cartão, ou "sem centro". */
export function grupoDaSaida(
  m: Pick<Movimento, 'descricao' | 'centro' | 'categoria'>,
  centros: CostCenter[],
): { classe: string; foraDoTotal: boolean; fatura: boolean } {
  if (ehPagamentoDeFatura(m.descricao)) return { classe: CENTRO_CARTAO, foraDoTotal: false, fatura: true }
  const c = m.centro ? centros.find((x) => x.name === m.centro) : null
  if (c?.grupo === GRUPO_FORA_DO_TOTAL || (m.categoria && /não é despesa/i.test(m.categoria))) {
    return { classe: FORA_DO_TOTAL, foraDoTotal: true, fatura: false }
  }
  if (!m.centro) return { classe: SEM_CENTRO, foraDoTotal: false, fatura: false }
  const g = c?.grupo ?? ''
  return { classe: (CLASSES_SAIDA as readonly string[]).includes(g) ? g : OUTROS_GRUPOS, foraDoTotal: false, fatura: false }
}

export function classificar(movs: Movimento[], centros: CostCenter[]): MovimentoClassificado[] {
  return movs.map((m) => {
    if (m.direcao === 'in') return { ...m, ...formaDaEntrada(m.descricao, m.categoria), fatura: false }
    return { ...m, ...grupoDaSaida(m, centros) }
  })
}

/**
 * Posição da classe na paleta (1 a 6), ou `null` para as neutras (sem centro, outros, fora).
 * Entrada e saída têm ordens próprias: são gráficos separados, cada um com a sua legenda.
 */
export function corDaClasse(direcao: Direcao, classe: string): number | null {
  const lista: readonly string[] = direcao === 'in' ? CLASSES_ENTRADA : CLASSES_SAIDA
  const i = lista.indexOf(classe)
  return i >= 0 ? i + 1 : null
}

/** A ordem de exibição das classes: a fixa primeiro, depois as neutras. */
export function ordemDasClasses(direcao: Direcao): string[] {
  return direcao === 'in' ? [...CLASSES_ENTRADA] : [...CLASSES_SAIDA, OUTROS_GRUPOS, SEM_CENTRO]
}

export type TotalClasse = { classe: string; cents: number; n: number }

/** Soma por classe, sem o que está fora do total, na ordem fixa (a cor não pula de lugar). */
export function totaisPorClasse(movs: MovimentoClassificado[], direcao: Direcao): TotalClasse[] {
  const m = new Map<string, TotalClasse>()
  for (const x of movs) {
    if (x.direcao !== direcao || x.foraDoTotal) continue
    const t = m.get(x.classe) ?? { classe: x.classe, cents: 0, n: 0 }
    t.cents += x.amountCents
    t.n += 1
    m.set(x.classe, t)
  }
  return ordemDasClasses(direcao)
    .map((c) => m.get(c))
    .filter((t): t is TotalClasse => Boolean(t && t.cents > 0))
}

export type TotalCentro = { centro: string; classe: string; cents: number; n: number }

/** Saída por centro de custo, maior primeiro. O cartão é uma linha só, o boleto. */
export function totaisPorCentro(movs: MovimentoClassificado[]): TotalCentro[] {
  const m = new Map<string, TotalCentro>()
  for (const x of movs) {
    if (x.direcao !== 'out' || x.foraDoTotal) continue
    const centro = x.fatura ? CENTRO_CARTAO : (x.centro ?? SEM_CENTRO)
    const t = m.get(centro) ?? { centro, classe: x.classe, cents: 0, n: 0 }
    t.cents += x.amountCents
    t.n += 1
    m.set(centro, t)
  }
  return [...m.values()].sort((a, b) => b.cents - a.cents)
}

export type Totais = { entrou: number; saiu: number; entrouFora: number; saiuFora: number; semCentro: number; semCentroN: number }

export function totais(movs: MovimentoClassificado[]): Totais {
  const t: Totais = { entrou: 0, saiu: 0, entrouFora: 0, saiuFora: 0, semCentro: 0, semCentroN: 0 }
  for (const x of movs) {
    if (x.direcao === 'in') {
      if (x.foraDoTotal) t.entrouFora += x.amountCents
      else t.entrou += x.amountCents
    } else if (x.foraDoTotal) {
      t.saiuFora += x.amountCents
    } else {
      t.saiu += x.amountCents
      if (x.classe === SEM_CENTRO) {
        t.semCentro += x.amountCents
        t.semCentroN += 1
      }
    }
  }
  return t
}

// ── Calendário

const somaDias = (d: string, dias: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)

const diaDaSemana = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()

/** "03/09" */
export const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export type Faixa = { chave: string; de: string; ate: string; rotulo: string; rotuloLongo: string }

/** Cada dia do intervalo, inclusive os sem movimento: dia vazio também é informação. */
export function diasDoPeriodo(de: string, ate: string): Faixa[] {
  const out: Faixa[] = []
  for (let d = de; d <= ate && out.length < 400; d = somaDias(d, 1)) {
    out.push({ chave: d, de: d, ate: d, rotulo: diaCurto(d), rotuloLongo: diaCurto(d) })
  }
  return out
}

/**
 * As semanas do período, de segunda a domingo (a semana da clínica começa na segunda), cortadas
 * nas pontas: setembro/2026 começa numa terça, então a Semana 1 é 01 a 06/09.
 */
export function semanasDoPeriodo(de: string, ate: string): Faixa[] {
  const out: Faixa[] = []
  let ini = de
  while (ini <= ate && out.length < 60) {
    const ateDomingo = (7 - diaDaSemana(ini)) % 7
    const fimSemana = somaDias(ini, ateDomingo)
    const fim = fimSemana < ate ? fimSemana : ate
    const n = out.length + 1
    out.push({
      chave: ini,
      de: ini,
      ate: fim,
      rotulo: `Sem ${n}`,
      rotuloLongo: ini === fim ? `Semana ${n} · ${diaCurto(ini)}` : `Semana ${n} · ${diaCurto(ini)} a ${diaCurto(fim)}`,
    })
    ini = somaDias(fim, 1)
  }
  return out
}

export type PontoSerie = Faixa & {
  entrou: number
  saiu: number
  /** Saída por grupo ou entrada por forma, conforme a direção pedida. */
  saidaPorClasse: Record<string, number>
  entradaPorClasse: Record<string, number>
}

/** Série dia a dia ou semana a semana. Fora do total não entra em nenhuma coluna. */
export function serie(movs: MovimentoClassificado[], faixas: Faixa[]): PontoSerie[] {
  const pontos = faixas.map<PontoSerie>((f) => ({ ...f, entrou: 0, saiu: 0, saidaPorClasse: {}, entradaPorClasse: {} }))
  for (const x of movs) {
    if (x.foraDoTotal) continue
    const p = pontos.find((f) => x.data >= f.de && x.data <= f.ate)
    if (!p) continue
    if (x.direcao === 'in') {
      p.entrou += x.amountCents
      p.entradaPorClasse[x.classe] = (p.entradaPorClasse[x.classe] ?? 0) + x.amountCents
    } else {
      p.saiu += x.amountCents
      p.saidaPorClasse[x.classe] = (p.saidaPorClasse[x.classe] ?? 0) + x.amountCents
    }
  }
  return pontos
}

export type PontoAcumulado = { chave: string; rotulo: string; entrou: number; saiu: number; sobra: number }

/** O mês somando dia a dia: onde ele estava em cada dia. */
export function acumulado(pontos: PontoSerie[]): PontoAcumulado[] {
  let e = 0
  let s = 0
  return pontos.map((p) => {
    e += p.entrou
    s += p.saiu
    return { chave: p.chave, rotulo: p.rotulo, entrou: e, saiu: s, sobra: e - s }
  })
}

/**
 * Com o que comparar. Mês (ou pedaço de mês) compara com os MESMOS dias do mês anterior:
 * 1 a 24 de setembro contra 1 a 24 de agosto. O "período anterior do mesmo tamanho" daria
 * 8 a 31 de agosto, que mistura dois meses e pega o fim de mês, quando sai a folha.
 */
export function periodoDeComparacao(p: Periodo): Periodo & { rotuloCurto: string } {
  const [ano, mes] = p.de.slice(0, 7).split('-').map(Number)
  const mesmoMes = p.de.slice(0, 7) === p.ate.slice(0, 7) && p.de.endsWith('-01')
  if (!mesmoMes) {
    const ant = periodoAnterior(p)
    return { ...ant, rotuloCurto: 'o período anterior' }
  }
  const [a, m] = mes === 1 ? [ano - 1, 12] : [ano, mes - 1]
  const ym = `${a}-${String(m).padStart(2, '0')}`
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  const diaAte = Math.min(Number(p.ate.slice(8, 10)), ultimo)
  const ant = periodoPersonalizado(`${ym}-01`, `${ym}-${String(diaAte).padStart(2, '0')}`)
  const nome = rotuloDoMes(ym).split('/')[0].toLowerCase()
  const inteiro = diaAte === ultimo
  return { ...ant, rotulo: rotuloDoMes(ym), rotuloCurto: inteiro ? nome : `1 a ${diaAte} de ${nome}` }
}

/** Variação em %, ou null quando não há base para comparar. */
export function variacao(atual: number, antes: number): number | null {
  if (antes <= 0) return null
  return ((atual - antes) / antes) * 100
}
