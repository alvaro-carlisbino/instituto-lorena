import { describe, expect, it } from 'vitest'

import notasJson from '../config/notasDaVersao.json'
import {
  type NotaDaVersao,
  NOTAS_DESTE_BUILD,
  lerNotas,
  notasDesde,
  notasNovas,
  resumoDoAviso,
} from './notasDaVersao'

const nota = (id: string, itens: string[] = ['um item']): NotaDaVersao => ({
  id,
  data: '2026-09-17',
  titulo: `Título ${id}`,
  itens,
})

const ids = (notas: NotaDaVersao[]) => notas.map((n) => n.id)

describe('notasNovas', () => {
  it('devolve o que o servidor tem antes da mais nova que o build conhece', () => {
    expect(ids(notasNovas([nota('c'), nota('b'), nota('a')], [nota('b'), nota('a')]))).toEqual(['c'])
    expect(ids(notasNovas([nota('d'), nota('c'), nota('b'), nota('a')], [nota('b'), nota('a')]))).toEqual(['d', 'c'])
  })

  it('servidor igual ao build: nada novo', () => {
    expect(notasNovas([nota('b'), nota('a')], [nota('b'), nota('a')])).toEqual([])
  })

  it('servidor mais velho que o build (rollback): nada novo', () => {
    expect(notasNovas([nota('b'), nota('a')], [nota('c'), nota('b'), nota('a')])).toEqual([])
  })

  it('nenhum id conhecido: só a primeira, sem despejar histórico', () => {
    expect(ids(notasNovas([nota('z'), nota('y'), nota('x')], [nota('b'), nota('a')]))).toEqual(['z'])
    expect(ids(notasNovas([nota('z'), nota('y')], []))).toEqual(['z'])
  })

  it('servidor sem notas (falha de rede): vazio', () => {
    expect(notasNovas([], [nota('a')])).toEqual([])
  })
})

describe('notasDesde', () => {
  const lista = [nota('c'), nota('b'), nota('a')]

  it('devolve as notas publicadas depois da última vista', () => {
    expect(ids(notasDesde(lista, 'a'))).toEqual(['c', 'b'])
    expect(ids(notasDesde(lista, 'b'))).toEqual(['c'])
  })

  it('última vista é a mais nova: vazio', () => {
    expect(notasDesde(lista, 'c')).toEqual([])
  })

  it('sem id visto: vazio', () => {
    expect(notasDesde(lista, null)).toEqual([])
    expect(notasDesde(lista, undefined)).toEqual([])
    expect(notasDesde(lista, '')).toEqual([])
  })

  it('id que a lista não tem: vazio, não repete histórico', () => {
    expect(notasDesde(lista, 'sumiu')).toEqual([])
  })
})

describe('resumoDoAviso', () => {
  it('cabe tudo: sem "e mais"', () => {
    const r = resumoDoAviso([nota('b'), nota('a')])
    expect(ids(r.notas)).toEqual(['b', 'a'])
    expect(r.resto).toBeNull()
  })

  it('corta em 2 notas e 3 itens por nota', () => {
    const r = resumoDoAviso([nota('c', ['1', '2', '3', '4', '5']), nota('b'), nota('a')])
    expect(ids(r.notas)).toEqual(['c', 'b'])
    expect(r.notas[0].itens).toEqual(['1', '2', '3'])
    expect(r.resto).toBe('e mais 1 novidade')
  })

  it('plural no "e mais"', () => {
    expect(resumoDoAviso([nota('d'), nota('c'), nota('b'), nota('a')]).resto).toBe('e mais 2 novidades')
  })

  it('não altera a nota original', () => {
    const original = nota('a', ['1', '2', '3', '4'])
    resumoDoAviso([original])
    expect(original.itens).toHaveLength(4)
  })
})

describe('lerNotas', () => {
  it('descarta o que não é nota e itens que não são texto', () => {
    const r = lerNotas([
      { id: 'a', data: '2026-09-17', titulo: 'Ok', itens: ['x', 2, ''] },
      { id: 'b', data: '2026-09-17', titulo: 'Sem itens' },
      { id: '', data: '2026-09-17', titulo: 'Sem id', itens: [] },
      null,
      'texto',
    ])
    expect(r).toEqual([{ id: 'a', data: '2026-09-17', titulo: 'Ok', itens: ['x'] }])
  })

  it('o que não é lista vira vazio (ex.: rewrite devolvendo outra coisa)', () => {
    expect(lerNotas({ id: 'a' })).toEqual([])
    expect(lerNotas(null)).toEqual([])
  })
})

// O arquivo de verdade: quem acrescenta nota a cada deploy roda estes testes antes.
describe('src/config/notasDaVersao.json', () => {
  it('tem pelo menos uma nota e todas bem formadas', () => {
    expect(NOTAS_DESTE_BUILD.length).toBeGreaterThan(0)
    expect(NOTAS_DESTE_BUILD).toHaveLength(notasJson.length)
    for (const n of NOTAS_DESTE_BUILD) {
      expect(n.data).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(n.itens.length).toBeGreaterThan(0)
    }
  })

  it('ids únicos', () => {
    expect(new Set(ids(NOTAS_DESTE_BUILD)).size).toBe(NOTAS_DESTE_BUILD.length)
  })

  it('da mais nova para a mais antiga', () => {
    const datas = NOTAS_DESTE_BUILD.map((n) => n.data)
    expect(datas).toEqual([...datas].sort().reverse())
  })

  it('sem travessão', () => {
    // Por código, para o próprio teste não conter o caractere que ele proíbe.
    expect(JSON.stringify(notasJson)).not.toContain(String.fromCharCode(0x2014))
  })
})
