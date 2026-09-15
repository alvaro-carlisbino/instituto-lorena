import { describe, expect, it } from 'vitest'

import { acharItemPorCodigo } from './estoqueCodigo'

const item = (id: string, barcode: string | null, sku: string | null = null, aliases: string[] = []) => ({
  id,
  barcode,
  sku,
  aliases,
})

describe('acharItemPorCodigo', () => {
  const itens = [
    item('luva', '7896007540221'),
    item('agulha', null, 'BD-30G'),
    item('gaze', '7891234567895', null, ['GAZE ESTERIL 7,5X7,5', '17891234567892']),
    item('seringa', '0036000291452'),
  ]

  it('acha pelo código de barras, ignorando espaço', () => {
    expect(acharItemPorCodigo(itens, ' 7896007540221 ')?.id).toBe('luva')
  })

  it('acha pelo SKU sem diferenciar maiúscula', () => {
    expect(acharItemPorCodigo(itens, 'bd-30g')?.id).toBe('agulha')
  })

  it('acha pelo segundo código guardado nos aliases', () => {
    expect(acharItemPorCodigo(itens, '17891234567892')?.id).toBe('gaze')
  })

  it('trata EAN-13 com zero na frente como o mesmo UPC-A', () => {
    expect(acharItemPorCodigo(itens, '036000291452')?.id).toBe('seringa')
  })

  it('não confunde nome guardado em alias com código', () => {
    expect(acharItemPorCodigo(itens, 'GAZE')).toBeNull()
  })

  it('devolve null para código desconhecido ou vazio', () => {
    expect(acharItemPorCodigo(itens, '999')).toBeNull()
    expect(acharItemPorCodigo(itens, '   ')).toBeNull()
  })
})
