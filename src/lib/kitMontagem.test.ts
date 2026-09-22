import { describe, expect, it } from 'vitest'

import {
  type LinhaMontagem,
  aplicarBipe,
  aplicarBipeDevolucao,
  assinaturaDoModelo,
  atualizarPeloModelo,
  diferencaDoModelo,
  marcaPorUsado,
  marcaPorVoltou,
  registroDeUso,
  resumirMontagem,
  usadoNaLinha,
  voltouNaLinha,
} from './kitMontagem'

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

describe('registrar uso', () => {
  const ringer = { id: 'r', itemId: 'ringer', qty: 6, returnedQty: 0 }
  const gaze = { id: 'g', itemId: 'gaze', qty: 10, returnedQty: 2 }
  const lencol = { id: 'l', itemId: 'lencol', qty: 3, returnedQty: 1 }

  it('marcar o usado e marcar o total que voltou dão o mesmo registro', () => {
    expect(marcaPorUsado(gaze, 3)).toBe(5)
    expect(marcaPorVoltou(gaze, 7)).toBe(5)
    expect(usadoNaLinha(gaze, 5)).toBe(3)
    expect(voltouNaLinha(gaze, 5)).toBe(7)
  })

  it('usar mais do que saiu vira uso a mais, não devolução', () => {
    const marca = marcaPorUsado(ringer, 9)
    expect(marca).toBe(-3)
    expect(usadoNaLinha(ringer, marca)).toBe(9)
    expect(registroDeUso([ringer], { r: marca })).toEqual({
      itens: [{ kitItemId: 'r', voltou: 0, desfazer: 0, aMais: 3 }],
      voltam: 0,
      desfeito: 0,
      aMais: 3,
    })
  })

  it('devolução marcada por engano se desfaz antes de virar uso a mais', () => {
    // Lençol: saiu 3, marcaram voltou 1, usaram os 3.
    expect(marcaPorUsado(lencol, 3)).toBe(-1)
    expect(marcaPorVoltou(lencol, 0)).toBe(-1)
    expect(registroDeUso([lencol], { l: -1 }).itens).toEqual([{ kitItemId: 'l', voltou: 0, desfazer: 1, aMais: 0 }])
    // Usaram 4: desfaz 1 e o outro é a mais.
    expect(registroDeUso([lencol], { l: marcaPorUsado(lencol, 4) }).itens).toEqual([{ kitItemId: 'l', voltou: 0, desfazer: 1, aMais: 1 }])
  })

  it('o total que voltou nunca passa do que saiu', () => {
    expect(marcaPorVoltou(gaze, 50)).toBe(8)
    expect(registroDeUso([gaze, ringer], { g: 8 }).itens).toEqual([{ kitItemId: 'g', voltou: 8, desfazer: 0, aMais: 0 }])
  })

  it('bipe de devolução desconta o uso a mais', () => {
    expect(aplicarBipeDevolucao([ringer], { r: -3 }, 'ringer').devolucoes).toEqual({ r: -2 })
  })
})

describe('bandeja × modelo', () => {
  it('assinatura não depende da ordem e muda com a quantidade', () => {
    const a = assinaturaDoModelo([{ itemId: 'luva', qty: 4 }, { itemId: 'gaze', qty: 2 }])
    expect(assinaturaDoModelo([{ itemId: 'gaze', qty: 2 }, { itemId: 'luva', qty: 4 }])).toBe(a)
    expect(assinaturaDoModelo([{ itemId: 'gaze', qty: 3 }, { itemId: 'luva', qty: 4 }])).not.toBe(a)
  })

  it('diferença ignora avulso e conta o que saiu e o que entrou no modelo', () => {
    const bandeja = [linha('a', 'luva', 4), linha('b', 'aramin', 1), linha('c', 'swab', 1, 1, true)]
    expect(diferencaDoModelo(bandeja, [{ itemId: 'luva', qty: 4 }, { itemId: 'gaze', qty: 2 }])).toEqual({ sairam: 1, entraram: 1 })
    expect(diferencaDoModelo(bandeja.slice(0, 1), [{ itemId: 'luva', qty: 6 }])).toEqual({ sairam: 0, entraram: 0 })
  })

  it('atualizar pelo modelo tira o que saiu, mantém o conferido e os avulsos', () => {
    const bandeja = [
      { ...linha('a', 'luva', 4, 3), cobrancaCents: 500 },
      linha('b', 'aramin', 1, 1),
      linha('c', 'swab', 1, 1, true),
    ]
    const nova = atualizarPeloModelo(bandeja, [{ itemId: 'luva', qty: 2 }, { itemId: 'gaze', qty: 2 }])
    expect(nova.map((l) => [l.itemId, l.qty, l.conferido, l.avulso])).toEqual([
      ['luva', 2, 2, false],
      ['gaze', 2, 0, false],
      ['swab', 1, 1, true],
    ])
    expect(nova[0]).toMatchObject({ chave: 'a', cobrancaCents: 500 })
  })

  it('avulso de item que entrou no modelo não vira linha repetida', () => {
    const nova = atualizarPeloModelo([linha('c', 'gaze', 1, 1, true)], [{ itemId: 'gaze', qty: 2 }])
    expect(nova).toHaveLength(1)
    expect(nova[0]).toMatchObject({ itemId: 'gaze', qty: 2, conferido: 1, avulso: false })
  })
})
