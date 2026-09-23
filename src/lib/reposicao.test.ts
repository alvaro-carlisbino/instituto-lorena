import { describe, expect, it } from 'vitest'

import { consumoLiquido, diasEntre, sugerirCompra, type MovimentoDeConsumo } from './reposicao'

const mov = (p: Partial<MovimentoDeConsumo>): MovimentoDeConsumo => ({
  itemId: 'gaze',
  kind: 'saida',
  qtyDelta: -1,
  refType: null,
  unitCostCents: 100,
  ...p,
})

describe('consumoLiquido', () => {
  it('kit desconta a sobra devolvida', () => {
    const c = consumoLiquido([
      mov({ qtyDelta: -10, refType: 'stock_kit' }),
      mov({ kind: 'entrada', qtyDelta: 4, refType: 'stock_kit' }),
    ])
    expect(c.get('gaze')).toEqual({ qty: 6, costCents: 600, uncosted: false })
  })

  it('transferência entre setores não é gasto', () => {
    const c = consumoLiquido([
      mov({ qtyDelta: -50, refType: 'stock_transfer' }),
      mov({ kind: 'entrada', qtyDelta: 50, refType: 'stock_transfer' }),
      mov({ qtyDelta: -3, refType: 'bipagem' }),
    ])
    expect(c.get('gaze')?.qty).toBe(3)
  })

  it('estorno desfaz a saída; entrada de nota e ajuste de contagem não mexem', () => {
    const c = consumoLiquido([
      mov({ qtyDelta: -5 }),
      mov({ kind: 'entrada', qtyDelta: 5, refType: 'estorno' }),
      mov({ kind: 'entrada', qtyDelta: 100, refType: 'purchase_invoice' }),
      mov({ kind: 'ajuste', qtyDelta: -7, refType: 'stock_count' }),
    ])
    expect(c.has('gaze')).toBe(false)
  })

  it('só devolução no período (kit montado antes) não vira consumo negativo', () => {
    const c = consumoLiquido([mov({ kind: 'entrada', qtyDelta: 2, refType: 'stock_kit' })])
    expect(c.size).toBe(0)
  })
})

describe('sugerirCompra', () => {
  const item = { id: 'gaze', name: 'Gaze', unit: 'pct', saldo: 10, minQty: 0, lastCostCents: 500 }

  it('compra o ritmo do período para a cobertura, menos o saldo', () => {
    const [l] = sugerirCompra({
      itens: [item],
      consumo: new Map([['gaze', { qty: 30, costCents: 0, uncosted: false }]]),
      diasPeriodo: 30,
      diasCobertura: 30,
    })
    expect(l.sugerido).toBe(20)
    expect(l.motivo).toBe('consumo')
  })

  it('saldo que cobre não entra na lista', () => {
    const linhas = sugerirCompra({
      itens: [{ ...item, saldo: 40 }],
      consumo: new Map([['gaze', { qty: 30, costCents: 0, uncosted: false }]]),
      diasPeriodo: 30,
      diasCobertura: 30,
    })
    expect(linhas).toEqual([])
  })

  it('mínimo cadastrado vale mesmo sem consumo; saldo negativo conta como zero', () => {
    const [l] = sugerirCompra({
      itens: [{ ...item, saldo: -4, minQty: 12 }],
      consumo: new Map(),
      diasPeriodo: 30,
      diasCobertura: 30,
    })
    expect(l.sugerido).toBe(12)
    expect(l.motivo).toBe('minimo')
  })

  it('fração arredonda para cima (0,05 frasco vira 1)', () => {
    const [l] = sugerirCompra({
      itens: [{ ...item, saldo: 0 }],
      consumo: new Map([['gaze', { qty: 0.05, costCents: 0, uncosted: false }]]),
      diasPeriodo: 30,
      diasCobertura: 30,
    })
    expect(l.sugerido).toBe(1)
  })
})

describe('diasEntre', () => {
  it('conta as duas pontas', () => {
    expect(diasEntre('2026-09-01', '2026-09-30')).toBe(30)
    expect(diasEntre('2026-09-23', '2026-09-23')).toBe(1)
  })
})
