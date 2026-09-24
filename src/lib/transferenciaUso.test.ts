import { describe, expect, it } from 'vitest'

import { diaAntes, diaValido, limitarUsado, linhasAlteradas, rotuloDoDia, situacaoDaTransferencia } from './transferenciaUso'

const linha = (itemId: string, qty: number, usado = 0) => ({ itemId, qty, usado })

describe('situacaoDaTransferencia', () => {
  it('cancelada vence o resto', () => {
    expect(situacaoDaTransferencia({ cancelledAt: '2026-09-24', items: [linha('a', 2, 2)] })).toBe('cancelada')
  })

  it('tudo usado, parte usada, no setor', () => {
    expect(situacaoDaTransferencia({ cancelledAt: null, items: [linha('a', 3, 3), linha('b', 1, 1)] })).toBe('usada')
    expect(situacaoDaTransferencia({ cancelledAt: null, items: [linha('a', 2, 1), linha('b', 1)] })).toBe('parte')
    expect(situacaoDaTransferencia({ cancelledAt: null, items: [linha('a', 2), linha('b', 1)] })).toBe('no_setor')
  })

  it('linha zerada na edição não deixa a transferência "parte usada"', () => {
    expect(situacaoDaTransferencia({ cancelledAt: null, items: [linha('a', 3, 3), linha('b', 0)] })).toBe('usada')
  })
})

describe('limitarUsado', () => {
  it('não passa do que levou nem fica negativo', () => {
    expect(limitarUsado(5, 2)).toBe(2)
    expect(limitarUsado(-1, 2)).toBe(0)
    expect(limitarUsado(1.5, 2)).toBe(1.5)
  })
})

describe('linhasAlteradas', () => {
  it('manda só o que mudou e item novo com quantidade', () => {
    const antes = [linha('luva', 2), linha('caneta', 1, 1)]
    const depois = [linha('luva', 2, 1), linha('caneta', 1, 1), linha('alcool', 3, 3), linha('gaze', 0)]
    expect(linhasAlteradas(antes, depois)).toEqual([linha('luva', 2, 1), linha('alcool', 3, 3)])
  })
})

describe('dia do uso', () => {
  it('rótulo do dia', () => {
    expect(rotuloDoDia('2026-09-24', '2026-09-24')).toBe('hoje')
    expect(rotuloDoDia('2026-09-23', '2026-09-24')).toBe('ontem')
    expect(rotuloDoDia('2026-09-20', '2026-09-24')).toBe('20/09')
    expect(rotuloDoDia(null, '2026-09-24')).toBe('')
  })

  it('ontem atravessa o mês', () => {
    expect(diaAntes('2026-10-01', 1)).toBe('2026-09-30')
    expect(rotuloDoDia('2026-09-30', '2026-10-01')).toBe('ontem')
  })

  it('aceita até 30 dias atrás e nunca o futuro', () => {
    expect(diaValido('2026-09-24', '2026-09-24')).toBe(true)
    expect(diaValido('2026-08-25', '2026-09-24')).toBe(true)
    expect(diaValido('2026-08-24', '2026-09-24')).toBe(false)
    expect(diaValido('2026-09-25', '2026-09-24')).toBe(false)
    expect(diaValido('', '2026-09-24')).toBe(false)
  })
})
