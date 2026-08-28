import { describe, expect, it } from 'vitest'
import { slotBetween } from './leadOrdering'

const at = (position: number) => ({ position })

describe('slotBetween', () => {
  it('primeira posição da coluna vazia', () => {
    expect(slotBetween(undefined, undefined)).toBe(1)
  })

  it('topo da coluna: fica antes de quem já está lá', () => {
    expect(slotBetween(undefined, at(1))).toBe(0)
    expect(slotBetween(undefined, at(0))).toBe(-1)
  })

  it('fim da coluna: fica depois do último', () => {
    expect(slotBetween(at(7), undefined)).toBe(8)
  })

  it('com folga entre os vizinhos, cai no meio', () => {
    expect(slotBetween(at(10), at(20))).toBe(15)
    expect(slotBetween(at(1), at(3))).toBe(2)
  })

  it('sem folga, pede renumeração', () => {
    expect(slotBetween(at(4), at(5))).toBeNull()
    expect(slotBetween(at(4), at(4))).toBeNull()
  })

  it('funciona com posições negativas — o topo pode descer indefinidamente', () => {
    let top = 1
    for (let i = 0; i < 5; i += 1) {
      const next = slotBetween(undefined, at(top))
      expect(next).not.toBeNull()
      top = next as number
    }
    expect(top).toBe(-4)
  })

  it('mover ao topo grava só um card: os vizinhos não mudam de número', () => {
    const coluna = [at(1), at(2), at(3)]
    const novo = slotBetween(undefined, coluna[0])
    expect(novo).toBe(0)
    expect(coluna.map((c) => c.position)).toEqual([1, 2, 3])
  })
})
