// Valor da venda de transplante: a tela fala em TOTAL, o banco guarda o valor da clínica.
//
// Decisão do Álvaro em 23/09/2026: quem lança digita o total que o paciente paga (R$ 45.200) e o
// sistema tira a entrada (R$ 2.500), que é o pagamento do anestesista. O banco segue com o valor
// sem ela (R$ 42.700): é a base dos 13% do médico, dos relatórios e das vendas já gravadas.
//
// Corrigido em 24/09: a entrada paga o anestesista só ATÉ o valor da anestesia. Na venda do
// Thiago Henrique a entrada foi R$ 10.000 e a anestesia R$ 2.500; tirar a entrada inteira fazia
// R$ 7.500 da clínica sumirem do valor e do lucro (R$ 16.900 em vez de R$ 24.400). O que passa
// da anestesia é pagamento da cirurgia. O gatilho `clinic_sales_repasse_pela_regra` faz a mesma
// conta ao gravar (20260924210000); aqui ela é a da tela.
//
// A anestesia faz o caminho inverso: gravada já sem o que a entrada pagou, aparece cheia na
// tela, como custo, que é como a gerência pensa.

/**
 * Quanto da entrada pagou o anestesista: a entrada até o valor da anestesia.
 *
 * Sem anestesia conhecida (a prévia ainda não voltou, ou o procedimento não tem regra), vale a
 * regra antiga, a entrada inteira: "não sei a anestesia" não pode virar "a entrada é toda da
 * clínica" e inflar o lucro na tela.
 */
export const entradaDaAnestesia = (entradaCents: number, anestesiaCents: number | null) =>
  anestesiaCents == null
    ? Math.max(0, entradaCents)
    : Math.min(Math.max(0, entradaCents), Math.max(0, anestesiaCents))

/** Total digitado → valor gravado (sem a parte da entrada que pagou o anestesista). */
export const valorParaGravar = (totalCents: number, entradaDaAnestesiaCents: number) =>
  Math.max(0, totalCents - entradaDaAnestesiaCents)

type VendaGravada = { valueCents: number; depositCents: number | null; totalCents: number | null }

/**
 * Venda gravada → total mostrado. Desde 24/09 o formulário grava o total; nas vendas anteriores
 * ele não existe e o total é valor + entrada, a convenção com que elas foram lançadas.
 */
export const totalParaMostrar = (venda: VendaGravada) =>
  venda.totalCents ?? venda.valueCents + (venda.depositCents ?? 0)

/** Quanto da entrada pagou o anestesista numa venda gravada: o que falta do valor para o total. */
export const entradaDaAnestesiaGravada = (venda: VendaGravada) =>
  venda.totalCents != null ? Math.max(0, venda.totalCents - venda.valueCents) : Math.max(0, venda.depositCents ?? 0)

/** Anestesia digitada à mão (cheia) → gravada (sem o que a entrada pagou). */
export const anestesiaParaGravar = (digitadaCents: number, entradaCents: number) => Math.max(0, digitadaCents - entradaCents)

/** Anestesia gravada + parte paga pela entrada → a anestesia cheia da tela. */
export const anestesiaParaMostrar = (gravadaCents: number, pagaPelaEntradaCents: number) => gravadaCents + pagaPelaEntradaCents
