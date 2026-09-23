// Valor da venda de transplante: a tela fala em TOTAL, o banco guarda o valor SEM a entrada.
//
// Decisão do Álvaro em 23/09/2026: quem lança digita o total que o paciente paga (R$ 45.200) e o
// sistema tira a entrada (R$ 2.500), que é o pagamento do anestesista. O banco segue com o valor
// sem a entrada (R$ 42.700): é a base dos 13% do médico, dos relatórios e das 241 vendas já
// gravadas, que não mudam. Antes cada pessoa lançava de um jeito e o lucro saía diferente.
//
// A anestesia faz o caminho inverso: gravada já sem o que a entrada pagou (a política menos a
// entrada, ver 20260922210000), aparece cheia na tela, como custo, que é como a gerência pensa.

/** Total digitado → valor gravado (sem a entrada). */
export const valorParaGravar = (totalCents: number, entradaCents: number) => Math.max(0, totalCents - entradaCents)

/** Valor gravado → total mostrado (com a entrada). */
export const totalParaMostrar = (valorGravadoCents: number, entradaCents: number | null) => valorGravadoCents + (entradaCents ?? 0)

/** Anestesia digitada à mão (cheia) → gravada (sem o que a entrada pagou). */
export const anestesiaParaGravar = (digitadaCents: number, entradaCents: number) => Math.max(0, digitadaCents - entradaCents)

/** Anestesia gravada + parte paga pela entrada → a anestesia cheia da tela. */
export const anestesiaParaMostrar = (gravadaCents: number, pagaPelaEntradaCents: number) => gravadaCents + pagaPelaEntradaCents
