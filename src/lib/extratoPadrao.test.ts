// Descrições reais do extrato do Itaú Empresas da clínica.
import { describe, expect, it } from 'vitest'

import { agruparPorPagador, assinaturaPagador, padraoDaRegra, sugerirPadrao } from '@/lib/extratoPadrao'

describe('assinaturaPagador', () => {
  it('tira o trilho do pagamento e fica com quem recebeu', () => {
    expect(assinaturaPagador('PIX ENVIADO LAVANDERIA BRILHO')).toBe('LAVANDERIA BRILHO')
    expect(assinaturaPagador('BOLETO  PAGO GRAFICA CENTRAL')).toBe('GRAFICA CENTRAL')
    expect(assinaturaPagador('DA  TELEFONE FIXO 9990001111')).toBe('TELEFONE FIXO')
    expect(assinaturaPagador('SISPAG MAMOSE MADEIRAS LTDA')).toBe('MAMOSE MADEIRAS LTDA')
  })

  it('não come o "DA" de um nome', () => {
    expect(assinaturaPagador('BOLETO  PAGO J P DA SILVA')).toBe('J P DA SILVA')
  })

  it('descrição que é só trilho vira o próprio rótulo, para ficarem juntas', () => {
    expect(assinaturaPagador('SISPAG PIX QR-CODE')).toBe('SISPAG PIX QR-CODE')
    expect(assinaturaPagador('CARTAO      1234-5678')).toBe('CARTAO')
  })
})

describe('padraoDaRegra', () => {
  it('sai padrão quando o lançamento diz quem recebeu', () => {
    expect(padraoDaRegra('PIX AGENDADO LAVANDERIA BRIL')).toBe('LAVANDERIA BRIL')
    expect(padraoDaRegra('BOLETO  PAGO GRAFICA CENTRAL')).toBe('GRAFICA CENTRAL')
  })

  it('não sai padrão de trilho sem nome: viraria regra para gente diferente', () => {
    expect(padraoDaRegra('SISPAG PIX QR-CODE')).toBeNull()
    expect(padraoDaRegra('SISPAG FORNECEDORES')).toBeNull()
    expect(padraoDaRegra('SISPAG TRANSF CC ITAU')).toBeNull()
    expect(padraoDaRegra('PIX ENVIADO 65.893.843 C')).toBeNull()
  })
})

describe('agruparPorPagador', () => {
  it('soma o mesmo fornecedor mesmo com o nome cortado em tamanhos diferentes', () => {
    const g = agruparPorPagador([
      { chave: 'LAVANDERIA BRILHO', amountCents: 2_900_000 },
      { chave: 'LAVANDERIA BRIL', amountCents: 830_000 },
      { chave: 'GRAFICA CENTRAL', amountCents: 177_850 },
      { chave: 'LAVANDERIA BRILHO', amountCents: 1_000_000 },
    ])
    expect(g).toHaveLength(2)
    expect(g[0].rotulo).toBe('LAVANDERIA BRILHO')
    expect(g[0].totalCents).toBe(4_730_000)
    expect(g[0].itens.map((i) => i.amountCents)).toEqual([2_900_000, 1_000_000, 830_000])
  })

  it('não junta nome curto demais por coincidência de começo', () => {
    const g = agruparPorPagador([
      { chave: 'ANA', amountCents: 100 },
      { chave: 'ANA CLAUDIA', amountCents: 200 },
    ])
    expect(g).toHaveLength(2)
  })
})

describe('sugerirPadrao', () => {
  it('tira o verbo do PIX, que não identifica ninguém', () => {
    expect(sugerirPadrao('PIX ENVIADO LAVANDERIA B')).toBe('LAVANDERIA B')
    expect(sugerirPadrao('PIX ENVIADO JOYTABLE')).toBe('JOYTABLE')
    expect(sugerirPadrao('PIX TRANSF INSTITU')).toBe('INSTITU')
  })

  it('tira a data colada no nome — é ela que impede a regra de valer no mês seguinte', () => {
    // O Itaú cola a data no fim: sem tirar, a regra casaria só com o lançamento daquele dia.
    expect(sugerirPadrao('PIX TRANSF INSTITU16/07')).toBe(sugerirPadrao('PIX TRANSF INSTITU24/07'))
    expect(sugerirPadrao('PIX QRS Leonardo Za29/07')).toBe('Leonardo Za')
  })

  it('tira número de documento comprido, mas preserva o nome', () => {
    expect(sugerirPadrao('REDE  VISA DB0085868531')).toBe('REDE VISA DB')
    expect(sugerirPadrao('DEP CHEQUE ATM N. 018591')).toBe('DEP CHEQUE ATM N.')
  })

  it('não inventa padrão a partir de descrição vazia', () => {
    expect(sugerirPadrao('')).toBe('')
    expect(sugerirPadrao('   ')).toBe('')
  })

  it('deixa quieto o que já é só nome', () => {
    expect(sugerirPadrao('SISPAG MAMOSE MADEIRAS LTDA')).toBe('SISPAG MAMOSE MADEIRAS LTDA')
  })
})
