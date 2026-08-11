// Motor de conciliação EXTRATO DE VENDAS (Shosp) × ENTRADAS DO BANCO.
//
// A regra é por FORMA DE PAGAMENTO, e essa é a decisão que faz a tela prestar:
//
//   PIX / transferência / boleto → cai 1 pra 1 na conta. Casa lançamento a lançamento,
//     valor exato + janela de dias. Sobrou dos dois lados = erro de verdade.
//
//   Cartão → NUNCA cai 1 pra 1, e nem cai INTEIRO. O adquirente junta as vendas, desconta a
//     taxa e credita dias depois — débito em D+1, crédito PARCELADO uma parcela por mês. Uma
//     venda "CC 10x" de R$ 10.000 não devolve R$ 10.000 em D+30: devolve R$ 1.000 por mês
//     durante dez meses. Em julho/2026 isso é R$ 280.360 em 37 vendas de 10x, das quais só
//     ~R$ 28.000 podiam ter caído no período. Cobrar o valor cheio dentro da janela fazia a
//     tela acusar R$ 664.316 sumidos que nunca deviam ter caído. Aqui o motor monta o
//     CRONOGRAMA de liquidação parcela a parcela e só cobra o que já venceu.
//
//   Dinheiro → não é pra estar no banco. Só aparece se alguém depositou. Comparar venda a
//     venda acusaria o caixa inteiro como sumido. Aqui vira um fechamento do período:
//     quanto entrou em espécie × quanto foi depositado.
//
//   Convênio / outro → o repasse vem do plano, agrupado e semanas depois. Fica informativo.
//
// Duas coisas saem da conta ANTES de qualquer regra, porque não têm como fechar:
//
//   Caixa que não é a conta do extrato (anestesista, outra praça, gaveta) — o dinheiro
//     existe, só não passa por aqui. Sem tirar, viram "não caiu no banco" falsos.
//
//   Pagamento dividido ("CC 6x/PX") — o Shosp registra as formas, não quanto foi em cada uma.
//     Sem o rateio não dá pra procurar valor nenhum no extrato; vira conferência na mão.
//
// E a descrição do extrato NÃO é adivinhável. O Itaú escreve "PIX TRANSF INSTITU16/07" para
// R$ 45.515 que não é venda nenhuma — é a outra conta do grupo mandando dinheiro pra cá. Nenhum
// regex nasce sabendo disso, e chutar errado aqui inventa R$ 412 mil de "entrada sem venda".
// Por isso existe `regras`: o usuário classifica o pagador recorrente UMA vez, fica salvo, e a
// declaração dele ganha de qualquer heurística daqui.

import { difDias, difDiasComSinal, normHeader } from '@/lib/planilha'
import {
  METODOS_CARTAO,
  METODOS_UM_PRA_UM,
  PAYMENT_LABEL,
  type PaymentMethod,
  type ShospSale,
} from '@/services/shospVendas'

/** Entrada de dinheiro no banco, normalizada — serve tanto pro fin_transactions quanto pro OFX cru. */
export type BankCredit = {
  id: string
  date: string // yyyy-mm-dd
  amountCents: number // sempre positivo
  description: string
}

/**
 * Classificação que o USUÁRIO declarou para um pagador recorrente do extrato.
 *
 * Casa por "contém", sem acento e sem caixa, contra a descrição do lançamento. Ganha de todo
 * regex embutido: quem sabe que "PIX TRANSF INSTITU" é a conta irmã do grupo, e não a venda de
 * um paciente, é quem opera a clínica — não este arquivo.
 */
export type CounterpartyRule = {
  /** trecho da descrição do lançamento */
  pattern: string
  classe: CreditClass
  /** nome que o usuário deu — é o que aparece no resumo do que saiu da conta */
  label?: string
}

export type ReconcileConfig = {
  /** janela de dias no casamento 1 pra 1 (PIX/TED/boleto) */
  janelaDias: number
  /** dias até o repasse do DÉBITO (Rede credita em D+1) */
  debitoDias: number
  /** dias até CADA parcela do crédito: a parcela k cai em D + creditoDias × k */
  creditoDias: number
  /** teto de taxa do adquirente, em % — acima disso vira alerta */
  taxaMaxPct: number
  /** caixas do Shosp cujo dinheiro NÃO passa pelo extrato que está sendo conciliado */
  caixasFora: string[]
  /** classificações declaradas pelo usuário, aplicadas antes de qualquer heurística */
  regras: CounterpartyRule[]
  /**
   * Último dia coberto pelo extrato. Parcela agendada depois disso É DINHEIRO A RECEBER,
   * não divergência: cobrar do banco um repasse que ainda nem venceu é inventar erro.
   */
  extratoAte?: string
}

export const CONFIG_PADRAO: ReconcileConfig = {
  janelaDias: 3,
  debitoDias: 1,
  creditoDias: 30,
  taxaMaxPct: 8,
  caixasFora: [],
  regras: [],
}

export type DivergenceKind =
  | 'venda_sem_credito'
  | 'credito_sem_venda'
  | 'valor_divergente'
  | 'venda_duplicada'
  | 'repasse_nao_encontrado'
  | 'taxa_fora_da_faixa'
  | 'pagamento_misto'
  | 'adquirente_fora_da_conta'

export type Severity = 'alta' | 'media' | 'baixa'

export type Divergence = {
  kind: DivergenceKind
  severity: Severity
  date: string
  amountCents: number
  title: string
  detail: string
  sale?: ShospSale
  credit?: BankCredit
  /** diferença em centavos quando os dois lados existem */
  deltaCents?: number
}

/** Texto claro — vai no filtro e no CSV, onde cabe explicar. */
export const DIVERGENCE_LABEL: Record<DivergenceKind, string> = {
  venda_sem_credito: 'Venda sem dinheiro no banco',
  credito_sem_venda: 'Entrada no banco sem venda no Shosp',
  valor_divergente: 'Valor diferente',
  venda_duplicada: 'Venda repetida na planilha',
  repasse_nao_encontrado: 'Repasse de cartão não encontrado',
  taxa_fora_da_faixa: 'Taxa do cartão acima do esperado',
  pagamento_misto: 'Pagamento dividido entre formas',
  adquirente_fora_da_conta: 'Repasse de cartão não passa por esta conta',
}

/** Versão curta pro badge da tabela: o Badge é whitespace-nowrap, então rótulo comprido
 *  estoura a coluna e espreme justamente a coluna que explica o erro. */
export const DIVERGENCE_BADGE: Record<DivergenceKind, string> = {
  venda_sem_credito: 'Não caiu',
  credito_sem_venda: 'Sem venda',
  valor_divergente: 'Valor difere',
  venda_duplicada: 'Repetida',
  repasse_nao_encontrado: 'Sem repasse',
  taxa_fora_da_faixa: 'Taxa alta',
  pagamento_misto: 'Dividido',
  adquirente_fora_da_conta: 'Outra conta',
}

// ──────────────────────────────────────────── classificação do extrato bancário

const RE_ADQUIRENTE =
  /\b(rede|redecard|cielo|getnet|stone|granito|adiq|vero|safrapay|sumup|pagseguro|pagbank|mercado\s?pago|asaas|infinitepay|cappta|elavon|bin\b|ton\b)/i

const RE_DEPOSITO = /(dep[oó]sito|dep\s|dinheiro|num[eé]r[aá]rio|malote|sangria|caixa eletr)/i

/**
 * Entrada que claramente NÃO é venda de paciente — não pode virar "entrada sem venda".
 *
 * `aplic` sem o "ac" final de propósito: o Itaú escreve "REND PAGO APLIC AUT MAIS", e o
 * antigo `aplicac` não casava com "APLIC" nenhuma. Resultado: 12 lançamentos de rendimento
 * caíam no balde de venda e viravam divergência. Mesma história do `\brend\b`.
 */
const RE_NAO_VENDA =
  /(\brend\b|rendimento|aplicac|aplicaç|\baplic\b|resgate|mesma titularidade|entre contas|saldo anterior|tarifa|estorno|devolu|juros|iof|empr[eé]stimo|antecipa[cç][aã]o|c[aâ]mbio|restitui|sal[aá]rio|fgts|inss|transf.*propria|transf.*própria)/i

/** Depósito de CHEQUE não é dinheiro em espécie — ver `classificarCredito`. */
const RE_CHEQUE = /cheque/i

export type CreditClass = 'adquirente' | 'deposito' | 'nao_venda' | 'venda'

/** Primeira regra do usuário que casar com a descrição. Sem acento e sem caixa dos dois lados. */
export function regraQueCasa(
  description: string,
  regras: CounterpartyRule[] | undefined,
): CounterpartyRule | undefined {
  if (!regras?.length) return undefined
  const alvo = normHeader(description)
  if (!alvo) return undefined
  return regras.find((r) => r.pattern && alvo.includes(normHeader(r.pattern)))
}

export function classificarCredito(c: BankCredit, regras?: CounterpartyRule[]): CreditClass {
  const d = c.description ?? ''
  // O que o usuário declarou vem primeiro e ponto: ele viu o extrato, o regex não.
  const regra = regraQueCasa(d, regras)
  if (regra) return regra.classe

  // A ordem é a regra. Adquirente primeiro (senão "ANTECIPAÇÃO REDE" viraria "não é venda"),
  // depois o que não é venda, e PIX/TED ANTES de depósito: banco escreve coisas como
  // "DEPOSITO PIX FULANO", e cair na regra de depósito faria a venda em PIX aparecer
  // como "não caiu no banco" — falso positivo no lugar mais visível da tela.
  if (RE_ADQUIRENTE.test(d)) return 'adquirente'
  if (RE_NAO_VENDA.test(d)) return 'nao_venda'
  if (/\b(pix|ted|doc)\b/i.test(d)) return 'venda'
  // "DEP CHEQUE ATM N. 018591" casa com `dep\s` e virava depósito de dinheiro: os R$ 37.800
  // de um cheque entravam no fechamento de caixa e faziam a clínica parecer ter depositado
  // uma espécie que nunca existiu. Cheque é recebimento normal — casa 1 pra 1 como os outros.
  if (RE_CHEQUE.test(d)) return 'venda'
  if (RE_DEPOSITO.test(d)) return 'deposito'
  return 'venda'
}

// ──────────────────────────────────────────── apoio

/** Nome do paciente aparece na descrição do lançamento? Usado como desempate e pra
 *  distinguir "valor errado" de "não entrou". Exige 2 pedaços do nome pra não casar por "MARIA". */
function nomeBate(patient: string, description: string): boolean {
  const alvo = normHeader(description)
  const partes = normHeader(patient)
    .split(' ')
    .filter((p) => p.length >= 3 && !['dos', 'das', 'de', 'da', 'do', 'e'].includes(p))
  if (partes.length === 0 || !alvo) return false
  const achados = partes.filter((p) => alvo.includes(p)).length
  return partes.length === 1 ? achados === 1 : achados >= 2
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dia(iso: string): string {
  if (!iso) return '—'
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')
}

/** yyyy-mm-dd + n dias. Meio-dia de propósito: some com a borda de horário de verão. */
function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Assinatura do pagador dentro da descrição do lançamento, pra agrupar recorrente.
 *
 * O Itaú escreve "PIX TRANSF INSTITU16/07": nome truncado colado na data. Sem tirar a data,
 * cada dia vira uma contraparte diferente e o agrupamento não agrupa nada.
 */
export function assinaturaContraparte(description: string): string {
  return normHeader(description)
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    .replace(/\b\d[\d.\-/]{3,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ──────────────────────────────────────────── resultado

export type ResumoMetodo = {
  method: PaymentMethod
  label: string
  qtd: number
  brutoCents: number
}

/** Uma parcela do repasse do adquirente: quando o dinheiro daquela venda deveria cair. */
export type ParcelaPrevista = {
  /** dia em que essa parcela vence no adquirente */
  date: string
  /** bruto da parcela (a taxa ainda não foi descontada) */
  amountCents: number
  /** k de "parcela k de n" */
  parcela: number
  parcelas: number
  sale: ShospSale
}

export type ResumoCartao = {
  /** bruto vendido no cartão no período da planilha */
  brutoCents: number
  /** parte do bruto que veio parcelada em 2x ou mais */
  parceladoCents: number
  maxParcelas: number
  /** o que, pelo cronograma, já venceu até o fim do extrato */
  esperadoCents: number
  /** o que ainda está no adquirente porque a parcela nem venceu — isto é a receber, não erro */
  aReceberCents: number
  /** dia da última parcela agendada, pra tela poder dizer "até quando" */
  aReceberAte: string | null
  /** o que os adquirentes de fato creditaram nesta conta dentro do período */
  repassadoCents: number
  /**
   * Taxa sobre o que já venceu × o que caiu — e só quando o repasse cobre a maior parte do
   * esperado. Se o adquirente credita em OUTRA conta, a "taxa" daria 96%: seria um número
   * inventado com cara de medição, exatamente o erro que esta tela existe pra não cometer.
   */
  taxaEfetivaPct: number | null
  /** o repasse identificado é pequeno demais perto do esperado → não dá pra medir nada */
  repasseForaDaConta: boolean
  /** cronograma por dia de vencimento, pra conferência */
  porVencimento: Array<{ date: string; amountCents: number; vencido: boolean }>
}

export type ResumoDinheiro = {
  vendidoCents: number
  depositadoCents: number
  diferencaCents: number
}

/** Vendas que o usuário marcou como de outra conta — ficam fora de toda regra, mas somadas à vista. */
export type ResumoForaDoExtrato = {
  qtd: number
  amountCents: number
  porCaixa: Array<{ name: string; qtd: number; amountCents: number }>
}

/** Entrada do banco que saiu da conta, agrupada pelo motivo — pra tela poder nomear o valor. */
export type ResumoIgnorado = {
  label: string
  qtd: number
  amountCents: number
  /** veio de regra declarada pelo usuário (e não da heurística embutida) */
  declarado: boolean
}

export type ReconcileResult = {
  divergences: Divergence[]
  /** vendas 1 pra 1 que casaram certinho */
  casados: Array<{ sale: ShospSale; credit: BankCredit; dayGap: number }>
  porMetodo: ResumoMetodo[]
  cartao: ResumoCartao
  dinheiro: ResumoDinheiro
  foraDoExtrato: ResumoForaDoExtrato
  mistos: { qtd: number; amountCents: number }
  /** o que ficou de fora do casamento por não ser venda, nomeado */
  ignorados: ResumoIgnorado[]
  /**
   * Vendas 1 pra 1 que não acharam crédito, agrupadas por CAIXA do Shosp.
   *
   * É o atalho pra descobrir que o problema não é dinheiro sumido e sim conta errada: quando
   * 11 de 11 vendas do caixa "LONDRINA" não casam, o que falta é desmarcar aquele caixa, não
   * caçar R$ 17.850 no extrato de Maringá.
   */
  semCreditoPorCaixa: Array<{ name: string; qtd: number; amountCents: number; totalQtd: number }>
  /** contrapartes recorrentes do extrato ainda sem explicação — matéria-prima do "quem é quem" */
  contrapartesAbertas: Array<{ label: string; qtd: number; amountCents: number; exemplo: string }>
  totais: {
    /** vendas que entraram nas regras (já sem as de caixa fora do extrato) */
    vendasQtd: number
    vendasBrutoCents: number
    /** tudo que veio na planilha, inclusive o que ficou fora das regras */
    vendasTotalQtd: number
    vendasTotalBrutoCents: number
    creditosQtd: number
    creditosCents: number
    /** entradas que a gente classificou como "não é venda" e tirou da conta */
    ignoradosQtd: number
    ignoradosCents: number
    /** entradas fora do período da planilha — vieram só pra alcançar o repasse do cartão */
    foraDoPeriodoQtd: number
    foraDoPeriodoCents: number
  }
}

// ──────────────────────────────────────────── motor

export function reconcileShospVsBanco(
  todasAsVendas: ShospSale[],
  credits: BankCredit[],
  config: ReconcileConfig = CONFIG_PADRAO,
): ReconcileResult {
  const divergences: Divergence[] = []
  const casados: ReconcileResult['casados'] = []

  // ── 0a. caixa que não é a conta deste extrato sai antes de tudo
  const foraSet = new Set(config.caixasFora.map((c) => normHeader(c)))
  const fora: ShospSale[] = []
  const sales: ShospSale[] = []
  for (const s of todasAsVendas) {
    if (foraSet.size > 0 && foraSet.has(normHeader(s.caixa || '—'))) fora.push(s)
    else sales.push(s)
  }
  const porCaixaFora = new Map<string, { name: string; qtd: number; amountCents: number }>()
  for (const s of fora) {
    const name = s.caixa || '—'
    const atual = porCaixaFora.get(name) ?? { name, qtd: 0, amountCents: 0 }
    atual.qtd += 1
    atual.amountCents += s.amountCents
    porCaixaFora.set(name, atual)
  }

  // ── 0b. linha repetida na própria planilha
  const porChave = new Map<string, ShospSale[]>()
  for (const s of sales) {
    const lista = porChave.get(s.key) ?? []
    lista.push(s)
    porChave.set(s.key, lista)
  }
  for (const [, lista] of porChave) {
    if (lista.length < 2) continue
    for (const s of lista.slice(1)) {
      divergences.push({
        kind: 'venda_duplicada',
        severity: 'media',
        date: s.date,
        amountCents: s.amountCents,
        title: `${s.patient || 'Paciente sem nome'} — ${brl(s.amountCents)}`,
        detail: `Mesma venda aparece ${lista.length}x na planilha (linhas ${lista.map((x) => x.rowNumber).join(', ')}). Se foi cobrança repetida de verdade, ignore; se foi export duplicado, o total do Shosp está inflado.`,
        sale: s,
      })
    }
  }

  // ── 1. separa o extrato bancário por natureza
  const adquirente: BankCredit[] = []
  const depositos: BankCredit[] = []
  const naoVenda: BankCredit[] = []
  const vendaLike: BankCredit[] = []
  /** o que saiu da conta, nomeado pela regra do usuário quando existe */
  const ignorados = new Map<string, ResumoIgnorado>()
  for (const c of credits) {
    const regra = regraQueCasa(c.description ?? '', config.regras)
    const klass = classificarCredito(c, config.regras)
    if (klass === 'adquirente') adquirente.push(c)
    else if (klass === 'deposito') depositos.push(c)
    else if (klass === 'nao_venda') {
      naoVenda.push(c)
      const label = regra?.label || regra?.pattern || 'Rendimento, tarifa e afins'
      const atual = ignorados.get(label) ?? { label, qtd: 0, amountCents: 0, declarado: Boolean(regra) }
      atual.qtd += 1
      atual.amountCents += c.amountCents
      ignorados.set(label, atual)
    } else vendaLike.push(c)
  }

  // ── 1b. pagamento dividido: sai das regras e vira conferência na mão
  const mistos = sales.filter((s) => s.mixed)
  for (const s of mistos) {
    divergences.push({
      kind: 'pagamento_misto',
      severity: 'baixa',
      date: s.date,
      amountCents: s.amountCents,
      title: `${s.patient || 'Paciente sem nome'} — ${brl(s.amountCents)} em ${s.methodRaw}`,
      detail: `Pagamento dividido entre ${s.methods.map((m) => PAYMENT_LABEL[m]).join(' e ')} (linha ${s.rowNumber}). O Shosp registra as formas mas não quanto foi em cada uma, então não dá pra procurar valor no extrato — confira na mão.`,
      sale: s,
    })
  }

  // ── 2. casamento 1 pra 1 (PIX / TED / boleto)
  const umPraUm = sales
    .filter((s) => !s.mixed && METODOS_UM_PRA_UM.includes(s.method))
    .sort((a, b) => a.date.localeCompare(b.date))

  // índice por valor: casamento exato fica O(1) por venda
  const porValor = new Map<number, BankCredit[]>()
  for (const c of vendaLike) {
    const lista = porValor.get(c.amountCents) ?? []
    lista.push(c)
    porValor.set(c.amountCents, lista)
  }
  const usados = new Set<string>()
  const semCredito: ShospSale[] = []

  for (const s of umPraUm) {
    const candidatos = (porValor.get(s.amountCents) ?? [])
      .filter((c) => !usados.has(c.id) && difDias(s.date, c.date) <= config.janelaDias)
      .sort((a, b) => {
        // nome do paciente na descrição ganha; depois, data mais próxima
        const nomeA = nomeBate(s.patient, a.description) ? 0 : 1
        const nomeB = nomeBate(s.patient, b.description) ? 0 : 1
        if (nomeA !== nomeB) return nomeA - nomeB
        return difDias(s.date, a.date) - difDias(s.date, b.date)
      })

    const melhor = candidatos[0]
    if (melhor) {
      usados.add(melhor.id)
      casados.push({ sale: s, credit: melhor, dayGap: difDias(s.date, melhor.date) })
      continue
    }

    // Não achou valor exato. Antes de gritar "não entrou", procura o mesmo paciente
    // na janela — aí o caso é valor diferente, que é outro problema (e outro culpado).
    const peloNome = vendaLike
      .filter(
        (c) => !usados.has(c.id) && difDias(s.date, c.date) <= config.janelaDias && nomeBate(s.patient, c.description),
      )
      .sort((a, b) => difDias(s.date, a.date) - difDias(s.date, b.date))[0]

    if (peloNome) {
      usados.add(peloNome.id)
      const delta = peloNome.amountCents - s.amountCents
      divergences.push({
        kind: 'valor_divergente',
        severity: 'alta',
        date: s.date,
        amountCents: s.amountCents,
        title: `${s.patient || 'Paciente sem nome'} — Shosp ${brl(s.amountCents)}, banco ${brl(peloNome.amountCents)}`,
        detail: `${PAYMENT_LABEL[s.method]} em ${dia(s.date)}. Entrou ${brl(Math.abs(delta))} ${delta > 0 ? 'a mais' : 'a menos'} do que a venda registrada (linha ${s.rowNumber} da planilha).`,
        sale: s,
        credit: peloNome,
        deltaCents: delta,
      })
      continue
    }

    semCredito.push(s)
    divergences.push({
      kind: 'venda_sem_credito',
      severity: 'alta',
      date: s.date,
      amountCents: s.amountCents,
      title: `${s.patient || 'Paciente sem nome'} — ${brl(s.amountCents)}`,
      detail:
        `${PAYMENT_LABEL[s.method]} lançado no Shosp em ${dia(s.date)} (linha ${s.rowNumber}), sem nenhuma entrada de mesmo valor no banco em ±${config.janelaDias} dia(s). Ou o dinheiro não entrou, ou entrou em conta que não está sendo lida aqui.` +
        (s.caixa ? ` Caixa no Shosp: ${s.caixa}.` : ''),
      sale: s,
    })
  }

  // ── 3. entrada no banco que nenhuma venda explica
  //
  // Só vale acusar crédito DENTRO do período das vendas. O extrato vem esticado de propósito —
  // precisa alcançar o repasse de cartão que cai um mês depois — mas a planilha para no dia 31.
  // Sem este corte, todo PIX de paciente de agosto virava "entrada sem venda de julho": em
  // julho/2026 eram 30 divergências acusando o motor de não achar venda que ninguém carregou.
  const datasVenda = sales.map((s) => s.date).sort()
  const vendasDe = datasVenda[0]
  const vendasAte = datasVenda.at(-1)
  const dentroDoPeriodo = (c: BankCredit): boolean =>
    !vendasDe || !vendasAte
      ? true
      : difDiasComSinal(vendasDe, c.date) >= -config.janelaDias &&
        difDiasComSinal(vendasAte, c.date) <= config.janelaDias

  const foraDoPeriodo: BankCredit[] = []
  const contrapartes = new Map<string, { label: string; qtd: number; amountCents: number; exemplo: string }>()
  for (const c of vendaLike) {
    if (usados.has(c.id)) continue
    if (!dentroDoPeriodo(c)) {
      foraDoPeriodo.push(c)
      continue
    }
    // Agrupa antes de acusar: 22 linhas de "PIX TRANSF INSTITU" são UM pagador recorrente,
    // e é como pagador que ele tem conserto (uma regra), não como 22 divergências.
    const chave = assinaturaContraparte(c.description ?? '') || 'sem descrição'
    const atual = contrapartes.get(chave) ?? {
      label: chave,
      qtd: 0,
      amountCents: 0,
      exemplo: c.description ?? '',
    }
    atual.qtd += 1
    atual.amountCents += c.amountCents
    contrapartes.set(chave, atual)
    divergences.push({
      kind: 'credito_sem_venda',
      severity: 'media',
      date: c.date,
      amountCents: c.amountCents,
      title: `${brl(c.amountCents)} — ${c.description || 'sem descrição'}`,
      detail: `Entrou no banco em ${dia(c.date)} e não tem venda equivalente no Shosp. Pode ser venda não lançada, recebimento antigo caindo agora, ou dinheiro que não é de paciente.`,
      credit: c,
    })
  }

  // ── 4. cartão: cronograma de parcelas × repasse do adquirente
  //
  // Venda de pagamento dividido entra pelo valor CHEIO, e o dia fica marcado. Deixar de fora
  // seria pior: o repasse do adquirente inclui a parte que foi no cartão, então o bruto ficaria
  // menor que o repasse. Entrando cheio o erro puxa pro outro lado — esperado maior — e o
  // resumo de "pagamento dividido" na tela explica por quê.
  const parcelas: ParcelaPrevista[] = []
  let brutoCartao = 0
  let parceladoCents = 0
  let maxParcelas = 1
  for (const s of sales) {
    const temCartao = s.methods.some((m) => METODOS_CARTAO.includes(m))
    if (!temCartao) continue
    brutoCartao += s.amountCents
    // Débito liquida uma vez só; crédito parcela. `installments` já vem do "CC 10x" da planilha.
    const ehDebito = s.methods.includes('cartao_debito') && !s.methods.includes('cartao_credito')
    const n = ehDebito ? 1 : Math.max(1, s.installments)
    if (n > 1) {
      parceladoCents += s.amountCents
      maxParcelas = Math.max(maxParcelas, n)
    }
    const passo = ehDebito ? config.debitoDias : config.creditoDias
    // Centavo da divisão vai na primeira parcela — mesma coisa que a maquininha faz, e evita
    // o total das parcelas fechar um centavo abaixo do bruto.
    const base = Math.floor(s.amountCents / n)
    const sobra = s.amountCents - base * n
    for (let k = 1; k <= n; k++) {
      parcelas.push({
        date: somarDias(s.date, ehDebito ? passo : passo * k),
        amountCents: base + (k === 1 ? sobra : 0),
        parcela: k,
        parcelas: n,
        sale: s,
      })
    }
  }

  // Fim do extrato: até onde dá pra cobrar. Sem isso informado, usa o último crédito lido —
  // é o que o banco entregou, e ninguém pode cobrar repasse depois disso.
  const fimExtrato =
    config.extratoAte ?? credits.map((c) => c.date).sort().at(-1) ?? null

  const vencidas = fimExtrato ? parcelas.filter((p) => p.date <= fimExtrato) : parcelas
  const aVencer = fimExtrato ? parcelas.filter((p) => p.date > fimExtrato) : []
  const esperadoCents = vencidas.reduce((a, p) => a + p.amountCents, 0)
  const aReceberCents = aVencer.reduce((a, p) => a + p.amountCents, 0)
  const aReceberAte = aVencer.map((p) => p.date).sort().at(-1) ?? null
  const repassadoCartao = adquirente.reduce((acc, c) => acc + c.amountCents, 0)

  const porVencimentoMap = new Map<string, number>()
  for (const p of parcelas) porVencimentoMap.set(p.date, (porVencimentoMap.get(p.date) ?? 0) + p.amountCents)
  const porVencimento = [...porVencimentoMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, amountCents]) => ({ date, amountCents, vencido: !fimExtrato || date <= fimExtrato }))

  // Cobertura decide o que a tela pode afirmar. Abaixo de 50% o repasse não está nesta conta —
  // e aí a verdade é "o cartão cai em outro lugar", não "23 dias de repasse sumiram". A tela
  // antiga cuspia uma linha vermelha por dia; isso é UM fato, e vira UMA linha.
  const cobertura = esperadoCents > 0 ? repassadoCartao / esperadoCents : 1
  const repasseForaDaConta = esperadoCents > 0 && cobertura < 0.5

  if (repasseForaDaConta) {
    const primeira = vencidas.map((p) => p.date).sort()[0]
    divergences.push({
      kind: 'adquirente_fora_da_conta',
      severity: 'alta',
      date: primeira ?? (fimExtrato ?? ''),
      amountCents: esperadoCents - repassadoCartao,
      title: `Cartão: ${brl(esperadoCents)} venceram no adquirente e só ${brl(repassadoCartao)} caíram nesta conta`,
      detail:
        `Das vendas em cartão do período, ${brl(esperadoCents)} já tinham vencimento até ${dia(fimExtrato ?? '')} pelo cronograma (débito D+${config.debitoDias}, crédito uma parcela a cada ${config.creditoDias} dias). Os adquirentes creditaram ${brl(repassadoCartao)} — ${(cobertura * 100).toFixed(1)}% do esperado. Isso não é dinheiro sumido: é o domicílio bancário do cartão apontando para outra conta. Concilie o cartão no extrato que recebe o repasse, ou marque aqui o pagador que traz esse dinheiro pra cá.` +
        (aReceberCents > 0
          ? ` Fora isso, ${brl(aReceberCents)} ainda nem venceram (parcelas até ${dia(aReceberAte ?? '')}).`
          : ''),
    })
  } else if (esperadoCents > 0) {
    // Tem repasse de verdade nesta conta: aí a taxa é medível e o excesso é alerta real.
    const taxaPct = ((esperadoCents - repassadoCartao) / esperadoCents) * 100
    if (taxaPct > config.taxaMaxPct) {
      divergences.push({
        kind: 'taxa_fora_da_faixa',
        severity: 'media',
        date: fimExtrato ?? '',
        amountCents: esperadoCents - repassadoCartao,
        title: `Cartão — taxa efetiva de ${taxaPct.toFixed(2)}% no período`,
        detail: `${brl(esperadoCents)} venceram no adquirente até ${dia(fimExtrato ?? '')} e ${brl(repassadoCartao)} foram creditados. A diferença de ${brl(esperadoCents - repassadoCartao)} passa do teto de ${config.taxaMaxPct}% configurado — ou a taxa contratada é maior, ou algum repasse do período não entrou.`,
      })
    }
  }

  // ── 5. resumos
  const vendidoDinheiro = sales
    .filter((s) => s.method === 'dinheiro')
    .reduce((acc, s) => acc + s.amountCents, 0)
  const depositado = depositos.reduce((acc, c) => acc + c.amountCents, 0)

  const metodos = new Map<PaymentMethod, ResumoMetodo>()
  for (const s of sales) {
    const atual = metodos.get(s.method) ?? {
      method: s.method,
      label: PAYMENT_LABEL[s.method],
      qtd: 0,
      brutoCents: 0,
    }
    atual.qtd += 1
    atual.brutoCents += s.amountCents
    metodos.set(s.method, atual)
  }

  divergences.sort((a, b) => {
    const peso: Record<Severity, number> = { alta: 0, media: 1, baixa: 2 }
    if (peso[a.severity] !== peso[b.severity]) return peso[a.severity] - peso[b.severity]
    return a.date.localeCompare(b.date)
  })

  return {
    divergences,
    casados,
    porMetodo: [...metodos.values()].sort((a, b) => b.brutoCents - a.brutoCents),
    cartao: {
      brutoCents: brutoCartao,
      parceladoCents,
      maxParcelas,
      esperadoCents,
      aReceberCents,
      aReceberAte,
      repassadoCents: repassadoCartao,
      // taxa só existe onde o repasse existe; ver o comentário do tipo
      taxaEfetivaPct:
        esperadoCents > 0 && !repasseForaDaConta
          ? ((esperadoCents - repassadoCartao) / esperadoCents) * 100
          : null,
      repasseForaDaConta,
      porVencimento,
    },
    dinheiro: {
      vendidoCents: vendidoDinheiro,
      depositadoCents: depositado,
      diferencaCents: vendidoDinheiro - depositado,
    },
    foraDoExtrato: {
      qtd: fora.length,
      amountCents: fora.reduce((acc, s) => acc + s.amountCents, 0),
      porCaixa: [...porCaixaFora.values()].sort((a, b) => b.amountCents - a.amountCents),
    },
    mistos: {
      qtd: mistos.length,
      amountCents: mistos.reduce((acc, s) => acc + s.amountCents, 0),
    },
    ignorados: [...ignorados.values()].sort((a, b) => b.amountCents - a.amountCents),
    semCreditoPorCaixa: (() => {
      const total = new Map<string, number>()
      for (const s of umPraUm) total.set(s.caixa || '—', (total.get(s.caixa || '—') ?? 0) + 1)
      const falhas = new Map<string, { name: string; qtd: number; amountCents: number; totalQtd: number }>()
      for (const s of semCredito) {
        const name = s.caixa || '—'
        const atual = falhas.get(name) ?? { name, qtd: 0, amountCents: 0, totalQtd: total.get(name) ?? 0 }
        atual.qtd += 1
        atual.amountCents += s.amountCents
        falhas.set(name, atual)
      }
      return [...falhas.values()].sort((a, b) => b.amountCents - a.amountCents)
    })(),
    contrapartesAbertas: [...contrapartes.values()]
      .filter((c) => c.qtd > 1 || c.amountCents >= 100_000)
      .sort((a, b) => b.amountCents - a.amountCents),
    totais: {
      vendasQtd: sales.length,
      vendasBrutoCents: sales.reduce((acc, s) => acc + s.amountCents, 0),
      vendasTotalQtd: todasAsVendas.length,
      vendasTotalBrutoCents: todasAsVendas.reduce((acc, s) => acc + s.amountCents, 0),
      creditosQtd: credits.length,
      creditosCents: credits.reduce((acc, c) => acc + c.amountCents, 0),
      ignoradosQtd: naoVenda.length,
      ignoradosCents: naoVenda.reduce((acc, c) => acc + c.amountCents, 0),
      foraDoPeriodoQtd: foraDoPeriodo.length,
      foraDoPeriodoCents: foraDoPeriodo.reduce((acc, c) => acc + c.amountCents, 0),
    },
  }
}
