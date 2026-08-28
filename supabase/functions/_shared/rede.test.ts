import { assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { nomeConfere } from './rede.ts'

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
