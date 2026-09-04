import { assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { nomeConfere, redeReturnMessagePt } from './rede.ts'

/**
 * O que estes testes protegem: o bot não pode cobrar um produto diferente do que prometeu.
 *
 * Caso real (Rosana, 28/08/2026): a IA disse "3 Gels Maxi Bonder (R$ 84,00 cada)" e mandou no
 * op o id do GRANDHA STRAIGHT SHAMPOO (R$ 160,00). O id existia, tinha preço e tinha estoque,
 * então passou em todas as travas e o link saiu R$ 733,00 contra os R$ 505,00 combinados.
 * `nomeConfere` é a trava que faltava: o nome falado ao cliente tem que descrever o produto
 * do cadastro.
 *
 * Os dois lados importam. Recusar de menos cobra errado; recusar de mais mata venda boa,
 * porque a IA abrevia o nome do Bling ao falar com o cliente ("Gel Maxi Bonder" para
 * "MAXI BONDER STYLING GEL - 100g").
 */

Deno.test('nomeConfere aceita a abreviação que a IA usa na conversa', () => {
  assert(nomeConfere('Gel Maxi Bonder', 'MAXI BONDER STYLING GEL - 100g'))
  assert(nomeConfere('Shampoo Dry Confort', 'DRY CONFORT SHAMPOO -300ml'))
  assert(nomeConfere('Shampoo Tea Tree Up Ice', 'TEA TREE UP ICE SHAMPOO - 250ml'))
  assert(nomeConfere('Shampoo Dry Confort 300ml', 'DRY CONFORT SHAMPOO -300ml'))
  assert(nomeConfere('Grandha Mix Oil Softness Shampoo', 'GRANDHA MIX OIL SOFTNESS SHAMPOO 300ML'))
  // Marca a mais no nome falado não pode derrubar a venda.
  assert(nomeConfere('Shampoo Grandha Dry Confort', 'DRY CONFORT SHAMPOO -300ml'))
  assert(nomeConfere('Tricopill', 'Tricopill Suplemento Capilar - 1 Mês'))
})

Deno.test('nomeConfere barra o id trocado do caso Rosana', () => {
  assertFalse(nomeConfere('Gel Maxi Bonder', 'GRANDHA STRAIGHT SHAMPOO - 250ML'))
  assertFalse(nomeConfere('Shampoo Dry Confort', 'GRANDHA STRAIGHT SHAMPOO - 250ML'))
})

Deno.test('nomeConfere separa shampoo de condicionador do MESMO produto', () => {
  // Duas palavras de três batem, mas na prateleira são frascos diferentes.
  assertFalse(nomeConfere('Shampoo Dry Confort', 'DRY CONFORT CONDICIONADOR 240ML'))
  assertFalse(nomeConfere('Condicionador Dry Confort', 'DRY CONFORT SHAMPOO -300ml'))
  assertFalse(nomeConfere('Leave-in Straight', 'GRANDHA STRAIGHT SHAMPOO - 250ML'))
  assertFalse(nomeConfere('Tonico Dry Confort', 'DRY CONFORT SHAMPOO -300ml'))
})

Deno.test('nomeConfere recusa quando não há nome para conferir', () => {
  assertFalse(nomeConfere('', 'DRY CONFORT SHAMPOO -300ml'))
  assertFalse(nomeConfere('   ', 'DRY CONFORT SHAMPOO -300ml'))
  assertFalse(nomeConfere('Gel Maxi Bonder', ''))
})

/**
 * O que estes testes protegem: o cliente nunca mais lê "Unauthorized" na tela de pagamento.
 *
 * Caso real (Siulvia, 04/09/2026): o banco dela recusou o cartão duas vezes (e.Rede cód 103).
 * O /pagar mostrava o `returnMessage` cru da e.Rede, em inglês. Ela leu "Unauthorized",
 * entendeu que o LINK estava quebrado e mandou print — e a IA, lendo o mesmo print, também
 * concluiu "falha no acesso ao link": pediu desculpa por um erro técnico que não existia e
 * gerou dois links novos, que caíram na mesma recusa. Recusa de banco tem que se parecer com
 * recusa de banco, e tem que dizer o que fazer.
 */

Deno.test('redeReturnMessagePt traduz a recusa do caso Siulvia (103) e manda trocar de cartão', () => {
  const msg = redeReturnMessagePt('103')
  assert(msg.includes('banco'))
  assert(msg.includes('outro cartão'))
  // Nada de inglês da e.Rede chegando ao cliente.
  assertFalse(/unauthorized/i.test(msg))
})

Deno.test('redeReturnMessagePt cobre os códigos que pedem ação DIFERENTE de trocar de cartão', () => {
  assert(redeReturnMessagePt('119').includes('CVV'))
  assert(redeReturnMessagePt('112').includes('validade'))
  assert(redeReturnMessagePt('111').includes('limite'))
})

Deno.test('redeReturnMessagePt não culpa o banco quando quem falhou foi a operadora', () => {
  // `http_500` = a e.Rede não respondeu. Mandar a pessoa ligar no banco aqui é passeio à toa.
  const msg = redeReturnMessagePt('http_500')
  assertFalse(msg.includes('banco'))
  assert(msg.includes('operadora'))
})

Deno.test('redeReturnMessagePt tem saída em português para código desconhecido', () => {
  const msg = redeReturnMessagePt('999')
  assert(msg.includes('999'))
  assert(msg.includes('outro cartão'))
})
