/**
 * Assinatura do pagador dentro da descrição do extrato — é o padrão que vira REGRA.
 *
 * O Itaú escreve "PIX ENVIADO LAVANDERIA B" hoje e "PIX ENVIADO LAVANDERIA B 12/09" no mês que
 * vem. Se a regra guardar a frase inteira, ela casa só com o lançamento daquele dia e não serve
 * pra nada — o usuário classifica de novo todo mês e desiste. Tirar o verbo ("PIX ENVIADO") e os
 * números colados é o que faz uma classificação valer para o histórico inteiro e para o futuro.
 */
export function sugerirPadrao(descricao: string): string {
  return (descricao || '')
    .replace(/^\s*(pix|ted|doc)\s+(enviado|recebido|transf|qrs)\s*/i, '')
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    // Sem `\b` na frente de propósito: o número costuma vir COLADO na letra
    // ("REDE VISA DB0085868531"), e com a borda de palavra o filtro não pegava nada.
    // Exige 4+ dígitos para não comer nome legítimo tipo "LOJA 24H".
    .replace(/\d[\d.\-/]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
