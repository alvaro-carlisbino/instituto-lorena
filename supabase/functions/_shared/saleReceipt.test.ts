import { assertStringIncludes, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { buildSaleReceiptText } from './saleReceipt.ts'

/** `toLocaleString('pt-BR')` separa "R$" do número com espaço FINO (U+00A0); normaliza pra comparar. */
const texto = (d: Parameters<typeof buildSaleReceiptText>[0]) => buildSaleReceiptText(d).replace(/\u00a0/g, ' ')

/**
 * O que estes testes protegem: o comprovante do grupo tem que dizer O QUE foi vendido.
 *
 * Caso real (Michele Nasser, 12/09/2026): venda de 2 géis BrowSculpt (R$129,90 cada, −5% de
 * Pix, + R$15 de entrega em Maringá = R$261,81) chegou ao grupo como "Pedido loja Tricopill
 * (2 itens)" — o rótulo genérico do carrinho. A gerente leu "2 Tricopill por R$261,81",
 * concluiu que o preço do suplemento tinha quebrado e abriu chamado. Não havia bug nenhum:
 * faltava a lista de itens na mensagem.
 */

const base = {
  tenantId: 'tricopill',
  paymentId: '18c8df78b1cc46d1',
  gateway: 'e.Rede',
  method: 'pix' as const,
  amountCents: 26181,
  freightCents: 1500,
  buyer: { name: 'Michele Nasser' },
}

Deno.test('comprovante do carrinho da loja nomeia o item e o total dele', () => {
  const txt = texto({
    ...base,
    produto: 'Pedido loja Tricopill (2 itens) + frete (Pix 5% off)',
    items: [{ id: '16691834812', qty: 2, nome: 'Gel de Sobrancelha BrowSculpt 10ml', precoCents: 12990 }],
  })
  assertStringIncludes(txt, '• Itens: 2× Gel de Sobrancelha BrowSculpt 10ml (R$ 259,80)')
})

Deno.test('carrinho com mais de um item vira lista, uma linha por item', () => {
  const txt = texto({
    ...base,
    produto: 'Pedido loja Tricopill (3 itens)',
    items: [
      { id: 'kit:3_meses', qty: 1, nome: 'Tricopill — 3 frascos + 1 grátis (4 frascos)', precoCents: 59700 },
      { id: '16691834812', qty: 2, nome: 'Gel de Sobrancelha BrowSculpt 10ml', precoCents: 12990 },
    ],
  })
  assertStringIncludes(txt, '• Itens:')
  assertStringIncludes(txt, '   1× Tricopill — 3 frascos + 1 grátis (4 frascos) (R$ 597,00)')
  assertStringIncludes(txt, '   2× Gel de Sobrancelha BrowSculpt 10ml (R$ 259,80)')
})

Deno.test('venda de kit (sem lista de itens) segue igual, sem linha vazia', () => {
  const txt = texto({
    ...base,
    amountCents: 59700,
    produto: 'Tricopill — 3 frascos + 1 grátis (4 frascos)',
    items: null,
  })
  assertStringIncludes(txt, '• Produto: Tricopill — 3 frascos + 1 grátis (4 frascos)')
  assertFalse(txt.includes('• Itens'))
})

Deno.test('item sem nome não vira linha fantasma no comprovante', () => {
  const txt = texto({
    ...base,
    produto: 'Pedido loja Tricopill (1 item)',
    items: [{ id: '999', qty: 1, precoCents: 12990 }],
  })
  assertFalse(txt.includes('• Itens'))
})
