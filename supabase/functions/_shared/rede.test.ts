import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { collectAddons, nomeConfere, redeReturnMessagePt, totaisDaMensagem, totalPrometidoDiverge } from './rede.ts'

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

/**
 * O que estes testes protegem: o link cobra o que a conversa combinou.
 *
 * Caso real (15/09/2026): a cliente pediu kit 5+1 + gel BrowSculpt, a IA escreveu "o total é
 * R$ 1.124,90 no cartão" e o link saiu R$ 995,00, só com o kit. O gel aparece no bling_catalog
 * do prompt com id, então a IA pode mandá-lo em `catalogo`; esse caminho pulava o id de marca
 * própria e o `collectAddons` só lia a chave `gel_sobrancelha`. Ninguém cobrava o gel.
 */

const GEL_ID = '16691834812'

Deno.test('collectAddons pega o gel mandado dentro de catalogo', () => {
  const out = collectAddons({ kit: '5_meses', catalogo: [{ id: GEL_ID, nome: 'Gel de Sobrancelha BrowSculpt 10ml', qty: 1 }] })
  assertEquals(out.map((a) => [a.key, a.qty]), [['gel_sobrancelha', 1]])
})

Deno.test('collectAddons não cobra duas vezes o gel que veio pelos dois caminhos', () => {
  const out = collectAddons({ gel_sobrancelha: 1, catalogo: [{ id: GEL_ID, nome: 'Gel BrowSculpt', qty: 1 }] })
  assertEquals(out.map((a) => [a.key, a.qty]), [['gel_sobrancelha', 1]])
  const dois = collectAddons({ gel_sobrancelha: 1, catalogo: [{ id: GEL_ID, nome: 'Gel BrowSculpt', qty: 2 }] })
  assertEquals(dois.map((a) => a.qty), [2])
})

Deno.test('collectAddons ignora produto de revenda no catalogo e quantidade lixo', () => {
  assertEquals(collectAddons({ catalogo: [{ id: '16676826723', nome: 'MAXI BONDER STYLING GEL - 100g', qty: 3 }] }), [])
  assertEquals(collectAddons({ gel_sobrancelha: 0, catalogo: [{ id: GEL_ID, qty: -1 }] }), [])
})

Deno.test('totalPrometidoDiverge pega a mensagem do caso de 15/09', () => {
  const texto =
    'Perfeito, Fernanda. Estou gerando o link para o Kit 5+1 com o Gel de Sobrancelha; o total é R$ 1.124,90 no cartão e o frete é grátis para Maringá. Só um instante.'
  const r = totalPrometidoDiverge(texto, { metodo: 'cartao', cobradoCents: 99500, baseCents: 99500, freteCents: 0 })
  assert(r.diverge)
  assertEquals(r.prometidoCents, 112490)
  assertFalse(totalPrometidoDiverge(texto, { metodo: 'cartao', cobradoCents: 112490, baseCents: 112490 }).diverge)
})

Deno.test('totalPrometidoDiverge não se engana com o preço item a item', () => {
  // Itemizado com o valor do kit aparecendo: o que vale é o TOTAL, não qualquer R$ da mensagem.
  const texto = 'O Kit 5+1 sai por R$ 995,00 e o Gel por R$ 129,90. O total fica R$ 1.124,90 no cartão.'
  assert(totalPrometidoDiverge(texto, { metodo: 'cartao', cobradoCents: 99500 }).diverge)
})

Deno.test('totalPrometidoDiverge aceita frete e cupom falados à parte', () => {
  const frete = 'O total dos produtos é R$ 597,00, mais o frete de R$ 15,00.'
  assertFalse(totalPrometidoDiverge(frete, { metodo: 'cartao', cobradoCents: 61200, baseCents: 59700, freteCents: 1500 }).diverge)
  const comFrete = 'Com o frete o total fica R$ 612,00.'
  assertFalse(totalPrometidoDiverge(comFrete, { metodo: 'cartao', cobradoCents: 61200, baseCents: 59700, freteCents: 1500 }).diverge)
  const cupom = 'O total seria R$ 597,00, e com o CLUBE10 fica R$ 537,30.'
  assertFalse(totalPrometidoDiverge(cupom, { metodo: 'cartao', cobradoCents: 53730, baseCents: 59700 }).diverge)
})

Deno.test('totalPrometidoDiverge ignora o total do outro meio de pagamento', () => {
  const texto = 'No Pix o total sairia R$ 945,25. Aqui está o link do cartão, R$ 995,00.'
  assertEquals(totaisDaMensagem(texto, 'cartao'), [])
  assertFalse(totalPrometidoDiverge(texto, { metodo: 'cartao', cobradoCents: 99500 }).diverge)
})

Deno.test('totalPrometidoDiverge não bloqueia mensagem sem total', () => {
  const r = totalPrometidoDiverge('Seu link está aqui embaixo 💚', { metodo: 'pix', cobradoCents: 56715 })
  assertFalse(r.diverge)
  assertEquals(r.prometidoCents, null)
})

Deno.test('totaisDaMensagem lê milhar, valor sem centavos e ponto final', () => {
  assertEquals(totaisDaMensagem('Total: R$ 1.124,90.', 'cartao'), [112490])
  assertEquals(totaisDaMensagem('o total é R$ 995.', 'cartao'), [99500])
  assertEquals(totaisDaMensagem('Totais: R$ 199,9', 'pix'), [19990])
})
