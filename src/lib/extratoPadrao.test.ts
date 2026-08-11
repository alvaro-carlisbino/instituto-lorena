// Descrições reais do extrato do Itaú Empresas da clínica.
import { describe, expect, it } from 'vitest'

import { sugerirPadrao } from '@/lib/extratoPadrao'

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
