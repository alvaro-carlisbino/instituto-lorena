import { describe, expect, it } from 'vitest'

import { combinaBusca, normalizarBusca } from '@/lib/busca'

describe('normalizarBusca', () => {
  it('tira acento e caixa', () => {
    expect(normalizarBusca('José Antônio')).toBe('jose antonio')
    expect(normalizarBusca('  SOBRANCELHA  ')).toBe('sobrancelha')
  })
})

describe('combinaBusca', () => {
  it('termo vazio não filtra nada', () => {
    expect(combinaBusca('', 'qualquer')).toBe(true)
    expect(combinaBusca('   ', 'qualquer')).toBe(true)
  })

  it('acha sem acento e sem caixa', () => {
    expect(combinaBusca('jose', 'José da Silva')).toBe(true)
    expect(combinaBusca('JOSÉ', 'jose da silva')).toBe(true)
  })

  it('acha pedaço do meio do rótulo', () => {
    expect(combinaBusca('nanofat', 'Sobrancelha + nanofat')).toBe(true)
  })

  it('cada palavra pode cair num campo diferente', () => {
    // "aline sobrancelha": vendedora num campo, procedimento no outro.
    expect(combinaBusca('aline sobrancelha', 'Maria de Souza', 'Sobrancelha', 'Aline Muniz')).toBe(true)
  })

  it('não acha quando falta uma das palavras', () => {
    expect(combinaBusca('aline barba', 'Maria de Souza', 'Sobrancelha', 'Aline Muniz')).toBe(false)
  })

  it('telefone acha com a pontuação que a pessoa digita', () => {
    expect(combinaBusca('(44) 99999-1234', '5544999991234')).toBe(true)
    expect(combinaBusca('44 99999', '5544999991234')).toBe(true)
    expect(combinaBusca('999991234', '5544999991234')).toBe(true)
  })

  it('telefone de outra pessoa não entra', () => {
    expect(combinaBusca('999998888', '5544999991234')).toBe(false)
  })

  it('campo nulo não vira texto pesquisável', () => {
    expect(combinaBusca('null', 'Maria', null, undefined)).toBe(false)
    expect(combinaBusca('undefined', 'Maria', null, undefined)).toBe(false)
  })

  it('número curto demais não dispara a regra de telefone', () => {
    // Com 3+ dígitos a pontuação é ignorada e "44-9" acha "5544999...".
    expect(combinaBusca('44-9', 'Maria', '5544999991234')).toBe(true)
    // Com 2 dígitos vale só a busca literal, que não acha "4-9" em lugar nenhum.
    expect(combinaBusca('4-9', 'Maria', '5544999991234')).toBe(false)
  })
})
