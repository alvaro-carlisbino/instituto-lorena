import { describe, expect, it } from 'vitest'

import { type LinhaMontagem, aplicarBipe, aplicarBipeDevolucao, resumirMontagem } from './kitMontagem'

const linha = (chave: string, itemId: string, qty: number, conferido = 0, avulso = false): LinhaMontagem => ({
  chave,
  itemId,
  qty,
  conferido,
  avulso,
  cobrancaCents: 0,
})

describe('aplicarBipe (montagem)', () => {
  it('confere +1 na linha do kit que ainda falta', () => {
    const r = aplicarBipe([linha('a', 'luva', 4, 3)], 'luva')
    expect(r.resultado).toBe('conferido')
    expect(r.linhas[0]).toMatchObject({ qty: 4, conferido: 4 })
  })

  it('bipe além do pedido soma na quantidade em vez de sumir', () => {
    const r = aplicarBipe([linha('a', 'luva', 4, 4)], 'luva')
    expect(r.resultado).toBe('a_mais')
    expect(r.linhas[0]).toMatchObject({ qty: 5, conferido: 5 })
  })

  it('produto de duas linhas: completa a que ainda falta, não a primeira', () => {
    const r = aplicarBipe([linha('a', 'gaze', 2, 2), linha('b', 'gaze', 2, 0, true)], 'gaze')
    expect(r.chave).toBe('b')
    expect(r.linhas[1].conferido).toBe(1)
  })

  it('item fora do modelo entra como avulso', () => {
    const r = aplicarBipe([linha('a', 'luva', 4)], 'propofol')
    expect(r.resultado).toBe('novo')
    expect(r.linhas).toHaveLength(2)
    expect(r.linhas[1]).toMatchObject({ itemId: 'propofol', qty: 1, conferido: 1, avulso: true })
  })
})

describe('resumirMontagem', () => {
  it('soma linhas do mesmo produto antes de comparar com o saldo', () => {
    const r = resumirMontagem(
      [linha('a', 'gaze', 3, 3), linha('b', 'gaze', 3, 0), linha('c', 'luva', 1, 1), linha('d', '', 1)],
      new Map([
        ['gaze', 5],
        ['luva', 10],
      ]),
    )
    expect(r.linhas).toBe(3)
    expect(r.completas).toBe(2)
    expect(r.faltaConferir).toBe(1)
    expect([...r.semSaldo]).toEqual(['gaze'])
  })
})

describe('aplicarBipeDevolucao', () => {
  const kit = [
    { id: 'k1', itemId: 'propofol', qty: 10, returnedQty: 8 },
    { id: 'k2', itemId: 'propofol', qty: 2, returnedQty: 0 },
    { id: 'k3', itemId: 'luva', qty: 1, returnedQty: 1 },
  ]

  it('usa a linha que ainda tem o que devolver e passa para a próxima', () => {
    let dev: Record<string, number> = {}
    for (let i = 0; i < 3; i += 1) dev = aplicarBipeDevolucao(kit, dev, 'propofol').devolucoes
    expect(dev).toEqual({ k1: 2, k2: 1 })
  })

  it('avisa quando já voltou tudo que saiu', () => {
    expect(aplicarBipeDevolucao(kit, {}, 'luva').resultado).toBe('esgotado')
  })

  it('avisa quando o item não saiu neste kit', () => {
    expect(aplicarBipeDevolucao(kit, {}, 'gaze').resultado).toBe('fora_do_kit')
  })
})
