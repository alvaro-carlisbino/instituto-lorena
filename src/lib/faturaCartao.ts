// A FATURA DO CARTÃO, DESMEMBRADA.
//
// No extrato da conta corrente o cartão aparece como UMA saída ("BOLETO PAGO Fatura Carta",
// "BUSINESS 4004-2658"), sem centro de custo possível: ela é aluguel de máquina, material do
// centro cirúrgico e anúncio ao mesmo tempo. Pedido do Kauan (24/set/2026): na aba do banco, o
// cartão vira uma classificação própria e, dentro dela, cada compra com o seu centro, "como se
// estivesse entrando dentro da fatura".
//
// As compras já estão no sistema, na conta do cartão. O que o banco NÃO manda é a fatura pronta
// (o Itaú Empresas devolve a lista de faturas vazia), então a ligação compra → fatura sai do
// calendário do cartão: fecha no dia 2 e vence no dia 15. Compra de 03/08 a 02/09 é da fatura
// que vence em 15/09.
//
// A soma das compras não bate no centavo com o boleto pago, e a tela mostra a diferença em vez
// de esconder: juros, IOF, anuidade lançada fora do dia, compra que o banco não mandou ou
// pagamento de outro cartão no mesmo boleto. Conferido em set/2026: nenhuma janela de datas
// fecha exatamente com nenhum dos 7 pagamentos.

/**
 * Espelho de `crm_e_pagamento_de_fatura` no banco. Os dois precisam casar a mesma coisa: é o que
 * tira o boleto do gasto (senão o cartão conta duas vezes) e o que o põe aqui.
 */
export function ehPagamentoDeFatura(descricao: string | null | undefined): boolean {
  return /(fatura +cart|pagamento +de +fatura|pagto +fatura|d[ée]bito +autom[aá]tico +itau +mc|business +[0-9]{4}-?[0-9]{4})/i.test(
    descricao ?? '',
  )
}

/**
 * Boleto do cartão ligado ao sistema: fica fora do gasto e abre nas compras. O boleto marcado
 * como de outro cartão (`fatura_sem_compras`, 25/set/2026) não entra aqui: ele conta sozinho, pelo
 * centro que o financeiro deu, porque as compras dele não estão no sistema.
 */
export function ehBoletoDoCartao(t: { description: string | null; faturaSemCompras?: boolean }): boolean {
  return ehPagamentoDeFatura(t.description) && !t.faturaSemCompras
}

/** Nome da classificação no Extrato e no Resumo. Não é centro de custo cadastrado: é o boleto. */
export const CENTRO_CARTAO = 'Cartão de crédito'

/** Dia de fechamento quando o banco não disse. É o do Itaú Empresas Mastercard da clínica. */
export const DIA_FECHAMENTO_PADRAO = 2

/** Antecedência mínima entre fechar e pagar. Fecha dia 2, vence dia 15: sobra folga. */
const DIAS_MINIMOS_ATE_PAGAR = 5

const somaDias = (d: string, dias: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)

const ultimoDiaDoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate()

/** O dia `dia` do mês (ano, mes 1-12), sem passar do fim do mês (fechamento 31 em fevereiro). */
function diaDoMes(ano: number, mes: number, dia: number): string {
  const d = Math.min(dia, ultimoDiaDoMes(ano, mes))
  return `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function mesAnterior(ano: number, mes: number): [number, number] {
  return mes === 1 ? [ano - 1, 12] : [ano, mes - 1]
}

/** Dia de fechamento do cartão, pelo que o banco mandou por último; senão o padrão. */
export function diaDeFechamento(conta: { ofBillCloseDate?: string | null } | null | undefined): number {
  const d = Number(String(conta?.ofBillCloseDate ?? '').slice(8, 10))
  return Number.isInteger(d) && d >= 1 && d <= 31 ? d : DIA_FECHAMENTO_PADRAO
}

/**
 * Em que dia fechou a fatura que este pagamento quitou: o último fechamento que ficou pelo menos
 * alguns dias antes do pagamento. Pago em 15/09 → fechou em 02/09; pago em 17/08 (o dia 15 caiu
 * num sábado) → fechou em 02/08.
 */
export function fechamentoDoPagamento(dataPagamento: string, dia: number = DIA_FECHAMENTO_PADRAO): string {
  const limite = somaDias(dataPagamento, -DIAS_MINIMOS_ATE_PAGAR)
  let [ano, mes] = limite.slice(0, 7).split('-').map(Number)
  let candidato = diaDoMes(ano, mes, dia)
  if (candidato > limite) {
    ;[ano, mes] = mesAnterior(ano, mes)
    candidato = diaDoMes(ano, mes, dia)
  }
  return candidato
}

/** Compras que caem numa fatura: do dia seguinte ao fechamento anterior até o fechamento. */
export function janelaDaFatura(fechamento: string, dia: number = DIA_FECHAMENTO_PADRAO): { de: string; ate: string } {
  const [ano, mes] = fechamento.slice(0, 7).split('-').map(Number)
  const [a, m] = mesAnterior(ano, mes)
  return { de: somaDias(diaDoMes(a, m, dia), 1), ate: fechamento }
}

export type PagamentoFatura = { id: string; data: string; descricao: string; amountCents: number }

export type ItemCartao = {
  id: string
  data: string
  descricao: string
  /** Sempre positivo. `credito` diz se abate (estorno) ou soma (compra). */
  amountCents: number
  credito: boolean
  centro: string | null
  detalhe: string | null
}

export type Fatura = {
  /** Chave estável: o dia em que fechou. */
  fechamento: string
  de: string
  ate: string
  /** Um boleto só na maioria dos meses; dois quando o banco quitou em duas vezes ou outro cartão veio junto. */
  pagamentos: PagamentoFatura[]
  compras: ItemCartao[]
  creditos: ItemCartao[]
  pagoCents: number
  comprasCents: number
  creditosCents: number
  /** Pago menos (compras − créditos). Positivo: pagou mais do que as compras que o banco mandou. */
  diferencaCents: number
}

/**
 * Junta cada pagamento à fatura que ele quitou e põe dentro as compras da janela. Dois boletos da
 * mesma fatura ficam na mesma fatura: as compras aparecem uma vez só e a diferença diz o resto.
 */
export function montarFaturas(
  pagamentos: PagamentoFatura[],
  itens: ItemCartao[],
  dia: number = DIA_FECHAMENTO_PADRAO,
): Fatura[] {
  const porFechamento = new Map<string, PagamentoFatura[]>()
  for (const p of pagamentos) {
    const f = fechamentoDoPagamento(p.data, dia)
    porFechamento.set(f, [...(porFechamento.get(f) ?? []), p])
  }
  return [...porFechamento.entries()]
    .map(([fechamento, pags]) => {
      const { de, ate } = janelaDaFatura(fechamento, dia)
      const daJanela = itens.filter((i) => i.data >= de && i.data <= ate)
      const compras = daJanela.filter((i) => !i.credito).sort((a, b) => a.data.localeCompare(b.data) || b.amountCents - a.amountCents)
      const creditos = daJanela.filter((i) => i.credito).sort((a, b) => a.data.localeCompare(b.data))
      const pagoCents = pags.reduce((s, p) => s + p.amountCents, 0)
      const comprasCents = compras.reduce((s, i) => s + i.amountCents, 0)
      const creditosCents = creditos.reduce((s, i) => s + i.amountCents, 0)
      return {
        fechamento,
        de,
        ate,
        pagamentos: [...pags].sort((a, b) => a.data.localeCompare(b.data)),
        compras,
        creditos,
        pagoCents,
        comprasCents,
        creditosCents,
        diferencaCents: pagoCents - (comprasCents - creditosCents),
      }
    })
    .sort((a, b) => b.fechamento.localeCompare(a.fechamento))
}

/** Primeiro dia que precisa ser buscado na conta do cartão para montar as faturas destes pagamentos. */
export function inicioDasCompras(pagamentos: Array<{ data: string }>, dia: number = DIA_FECHAMENTO_PADRAO): string | null {
  const inicios = pagamentos.map((p) => janelaDaFatura(fechamentoDoPagamento(p.data, dia), dia).de).sort()
  return inicios[0] ?? null
}

/** Quanto de cada centro tem nas compras, maior primeiro. Sem centro fica com o nome `null`. */
export function comprasPorCentro(compras: ItemCartao[]): Array<{ centro: string | null; cents: number; n: number }> {
  const m = new Map<string | null, { cents: number; n: number }>()
  for (const c of compras) {
    const k = c.centro ?? null
    const atual = m.get(k) ?? { cents: 0, n: 0 }
    m.set(k, { cents: atual.cents + c.amountCents, n: atual.n + 1 })
  }
  return [...m.entries()].map(([centro, v]) => ({ centro, ...v })).sort((a, b) => b.cents - a.cents)
}
