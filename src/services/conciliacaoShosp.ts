// Motor de conciliação EXTRATO DE VENDAS (Shosp) × ENTRADAS DO BANCO.
//
// A regra é por FORMA DE PAGAMENTO, e essa é a decisão que faz a tela prestar:
//
//   PIX / transferência / boleto → cai 1 pra 1 na conta. Casa lançamento a lançamento,
//     valor exato + janela de dias. Sobrou dos dois lados = erro de verdade.
//
//   Cartão → NUNCA cai 1 pra 1. O adquirente junta as vendas do dia, desconta a taxa e
//     credita dias depois (débito D+1, crédito D+30). Casar venda a venda marcaria quase
//     toda venda de cartão como divergência falsa. Aqui casa a SOMA DO DIA contra o
//     repasse, tolerando a taxa, e informa a taxa efetiva encontrada.
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

export type ReconcileConfig = {
  /** janela de dias no casamento 1 pra 1 (PIX/TED/boleto) */
  janelaDias: number
  /** menor atraso esperado do repasse de cartão (débito costuma ser D+1) */
  cartaoAtrasoMin: number
  /** maior atraso esperado do repasse de cartão (crédito costuma ser D+30) */
  cartaoAtrasoMax: number
  /** teto de taxa do adquirente, em % — acima disso vira alerta */
  taxaMaxPct: number
  /** caixas do Shosp cujo dinheiro NÃO passa pelo extrato que está sendo conciliado */
  caixasFora: string[]
}

export const CONFIG_PADRAO: ReconcileConfig = {
  janelaDias: 3,
  cartaoAtrasoMin: 0,
  cartaoAtrasoMax: 35,
  taxaMaxPct: 8,
  caixasFora: [],
}

export type DivergenceKind =
  | 'venda_sem_credito'
  | 'credito_sem_venda'
  | 'valor_divergente'
  | 'venda_duplicada'
  | 'repasse_nao_encontrado'
  | 'taxa_fora_da_faixa'
  | 'pagamento_misto'

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
}

// ──────────────────────────────────────────── classificação do extrato bancário

const RE_ADQUIRENTE =
  /\b(rede|redecard|cielo|getnet|stone|granito|adiq|vero|safrapay|sumup|pagseguro|pagbank|mercado\s?pago|asaas|infinitepay|cappta|elavon|bin\b|ton\b)/i

const RE_DEPOSITO = /(dep[oó]sito|dep\s|dinheiro|num[eé]r[aá]rio|malote|sangria|caixa eletr)/i

/** Entrada que claramente NÃO é venda de paciente — não pode virar "entrada sem venda". */
const RE_NAO_VENDA =
  /(rendimento|aplicac|aplicaç|resgate|mesma titularidade|entre contas|saldo anterior|tarifa|estorno|devolu|juros|iof|empr[eé]stimo|antecipa[cç][aã]o|c[aâ]mbio|restitui|sal[aá]rio|fgts|inss|transf.*propria|transf.*própria)/i

export type CreditClass = 'adquirente' | 'deposito' | 'nao_venda' | 'venda'

export function classificarCredito(c: BankCredit): CreditClass {
  const d = c.description ?? ''
  // A ordem é a regra. Adquirente primeiro (senão "ANTECIPAÇÃO REDE" viraria "não é venda"),
  // depois o que não é venda, e PIX/TED ANTES de depósito: banco escreve coisas como
  // "DEPOSITO PIX FULANO", e cair na regra de depósito faria a venda em PIX aparecer
  // como "não caiu no banco" — falso positivo no lugar mais visível da tela.
  if (RE_ADQUIRENTE.test(d)) return 'adquirente'
  if (RE_NAO_VENDA.test(d)) return 'nao_venda'
  if (/\b(pix|ted|doc)\b/i.test(d)) return 'venda'
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
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')
}

// ──────────────────────────────────────────── resultado

export type ResumoMetodo = {
  method: PaymentMethod
  label: string
  qtd: number
  brutoCents: number
}

export type ResumoCartao = {
  brutoCents: number
  repassadoCents: number
  /** Bruto dos dias cujo repasse FOI identificado — única base honesta pra taxa. */
  brutoConciliadoCents: number
  /** Repasse identificado desses dias (líquido). */
  repassadoConciliadoCents: number
  /** Bruto dos dias que ainda não têm repasse. Crédito é D+30: fim de mês sempre tem. */
  brutoPendenteCents: number
  /**
   * Taxa sobre o que já casou, não sobre o mês inteiro.
   *
   * Dividir bruto total por repasse total dá número de mentira: o dia 30 vendeu e o repasse
   * só cai no mês seguinte, então a conta acusava taxa de 33% onde o adquirente cobra 3%.
   * Como o rótulo na tela é "Taxa efetiva", o erro sairia como se fosse medição.
   */
  taxaEfetivaPct: number | null
  diasSemRepasse: number
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

export type ReconcileResult = {
  divergences: Divergence[]
  /** vendas 1 pra 1 que casaram certinho */
  casados: Array<{ sale: ShospSale; credit: BankCredit; dayGap: number }>
  porMetodo: ResumoMetodo[]
  cartao: ResumoCartao
  dinheiro: ResumoDinheiro
  foraDoExtrato: ResumoForaDoExtrato
  mistos: { qtd: number; amountCents: number }
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
  for (const c of credits) {
    const klass = classificarCredito(c)
    if (klass === 'adquirente') adquirente.push(c)
    else if (klass === 'deposito') depositos.push(c)
    else if (klass === 'nao_venda') naoVenda.push(c)
    else vendaLike.push(c)
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
  for (const c of vendaLike) {
    if (usados.has(c.id)) continue
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

  // ── 4. cartão: soma do dia × repasse do adquirente
  //
  // Venda de pagamento dividido entra pelo valor CHEIO, e o dia fica marcado. Deixar de fora
  // seria pior: o repasse do adquirente inclui a parte que foi no cartão, então o bruto do dia
  // ficaria menor que o repasse e o dia inteiro cairia como "repasse não encontrado". Entrando
  // cheio o erro puxa pro outro lado — taxa aparente maior — e o aviso do dia explica por quê.
  const cartaoPorDia = new Map<string, { gross: number; qtd: number; mistos: number }>()
  for (const s of sales) {
    const temCartao = s.methods.some((m) => METODOS_CARTAO.includes(m))
    if (!temCartao) continue
    const atual = cartaoPorDia.get(s.date) ?? { gross: 0, qtd: 0, mistos: 0 }
    atual.gross += s.amountCents
    atual.qtd += 1
    if (s.mixed) atual.mistos += 1
    cartaoPorDia.set(s.date, atual)
  }

  /** Aviso pra colar no detalhe do dia que tem pagamento dividido — senão o número parece errado à toa. */
  const avisoMisto = (n: number): string =>
    n > 0
      ? ` Atenção: ${n} venda(s) desse dia foram pagas em mais de uma forma e entraram aqui pelo valor cheio, então o bruto do cartão está superestimado.`
      : ''

  const repasseUsado = new Set<string>()
  let diasSemRepasse = 0
  let brutoConciliado = 0
  let repassadoConciliado = 0
  let brutoPendente = 0
  const diasCartao = [...cartaoPorDia.keys()].sort()

  for (const d of diasCartao) {
    const { gross, qtd, mistos: mistosNoDia } = cartaoPorDia.get(d)!
    // procura numa faixa MAIS LARGA que o teto de taxa: se achar algo com taxa alta,
    // é melhor mostrar "taxa acima do esperado" do que "repasse sumiu".
    const pisoLargo = Math.round(gross * (1 - (config.taxaMaxPct * 2) / 100))
    const teto = Math.round(gross * 1.02)
    const candidatos = adquirente
      .filter((c) => {
        if (repasseUsado.has(c.id)) return false
        const atraso = difDiasComSinal(d, c.date)
        if (atraso < config.cartaoAtrasoMin || atraso > config.cartaoAtrasoMax) return false
        return c.amountCents >= pisoLargo && c.amountCents <= teto
      })
      .sort((a, b) => {
        // menor taxa implícita primeiro (repasse mais "cheio" é o mais provável)
        const taxaA = gross - a.amountCents
        const taxaB = gross - b.amountCents
        return Math.abs(taxaA) - Math.abs(taxaB)
      })

    const achado = candidatos[0]
    if (!achado) {
      diasSemRepasse += 1
      brutoPendente += gross
      divergences.push({
        kind: 'repasse_nao_encontrado',
        severity: 'alta',
        date: d,
        amountCents: gross,
        title: `Cartão de ${dia(d)} — ${brl(gross)} em ${qtd} venda(s)`,
        detail:
          `Não achei repasse de adquirente entre D+${config.cartaoAtrasoMin} e D+${config.cartaoAtrasoMax} com valor compatível (esperado entre ${brl(pisoLargo)} e ${brl(gross)}). Pode ser repasse que ainda não caiu, repasse que cai agrupado com outro dia, ou venda de cartão que não foi capturada.` +
          avisoMisto(mistosNoDia),
      })
      continue
    }

    repasseUsado.add(achado.id)
    brutoConciliado += gross
    repassadoConciliado += achado.amountCents
    const taxaPct = gross > 0 ? ((gross - achado.amountCents) / gross) * 100 : 0
    if (taxaPct > config.taxaMaxPct) {
      divergences.push({
        kind: 'taxa_fora_da_faixa',
        severity: 'media',
        date: d,
        amountCents: gross,
        title: `Cartão de ${dia(d)} — taxa de ${taxaPct.toFixed(2)}%`,
        detail:
          `${brl(gross)} vendidos, ${brl(achado.amountCents)} repassados em ${dia(achado.date)} (${achado.description || 'sem descrição'}). Ficou ${brl(gross - achado.amountCents)} de taxa, acima do teto de ${config.taxaMaxPct}% configurado.` +
          avisoMisto(mistosNoDia),
        credit: achado,
        deltaCents: achado.amountCents - gross,
      })
    }
  }

  // ── 5. resumos
  const brutoCartao = [...cartaoPorDia.values()].reduce((acc, v) => acc + v.gross, 0)
  const repassadoCartao = adquirente.reduce((acc, c) => acc + c.amountCents, 0)
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
      repassadoCents: repassadoCartao,
      brutoConciliadoCents: brutoConciliado,
      repassadoConciliadoCents: repassadoConciliado,
      brutoPendenteCents: brutoPendente,
      taxaEfetivaPct:
        brutoConciliado > 0 ? ((brutoConciliado - repassadoConciliado) / brutoConciliado) * 100 : null,
      diasSemRepasse,
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
    totais: {
      vendasQtd: sales.length,
      vendasBrutoCents: sales.reduce((acc, s) => acc + s.amountCents, 0),
      vendasTotalQtd: todasAsVendas.length,
      vendasTotalBrutoCents: todasAsVendas.reduce((acc, s) => acc + s.amountCents, 0),
      creditosQtd: credits.length,
      creditosCents: credits.reduce((acc, c) => acc + c.amountCents, 0),
      ignoradosQtd: naoVenda.length,
      ignoradosCents: naoVenda.reduce((acc, c) => acc + c.amountCents, 0),
    },
  }
}
