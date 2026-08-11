import { describe, expect, it } from 'vitest'

import { remessasPorDocumento, vendaShospParaEntrada } from '@/services/importVendasFinanceiro'
import type { ShospSale } from '@/services/shospVendas'

function venda(over: Partial<ShospSale> = {}): ShospSale {
  return {
    saleId: '1001',
    date: '2026-08-01',
    patient: 'MARIA DA SILVA',
    cpf: '12345678901',
    amountCents: 100_00,
    method: 'pix',
    methods: ['pix'],
    mixed: false,
    methodRaw: 'PX',
    installments: 1,
    caixa: 'CAIXA 1',
    services: ['Transplante'],
    provider: '',
    doc: '1001',
    status: '',
    rowNumber: 2,
    rowNumbers: [2],
    key: 'cod:1001',
    ...over,
  }
}

describe('vendaShospParaEntrada', () => {
  it('leva o CPF da venda para a entrada', () => {
    expect(vendaShospParaEntrada(venda()).customerDoc).toBe('12345678901')
  })

  it('export sem coluna de CPF vira documento nulo, não string vazia', () => {
    expect(vendaShospParaEntrada(venda({ cpf: '' })).customerDoc).toBeNull()
  })
})

describe('remessasPorDocumento', () => {
  const linha = (e: { externalId: string }) => ({ external_id: e.externalId })

  it('quem não tem documento vai sem a coluna, para o upsert não apagar o CPF já gravado', () => {
    const [semDoc] = remessasPorDocumento([{ externalId: 'a', customerDoc: null }], linha)
    expect(semDoc).toHaveLength(1)
    expect('customer_doc' in semDoc[0]).toBe(false)
  })

  it('quem tem documento manda a coluna', () => {
    const [comDoc] = remessasPorDocumento([{ externalId: 'a', customerDoc: '999' }], linha)
    expect(comDoc[0]).toMatchObject({ external_id: 'a', customer_doc: '999' })
  })

  it('separa em duas remessas e não perde nem duplica entrada', () => {
    const remessas = remessasPorDocumento(
      [
        { externalId: 'a', customerDoc: '111' },
        { externalId: 'b', customerDoc: null },
        { externalId: 'c', customerDoc: '222' },
      ],
      linha,
    )
    expect(remessas).toHaveLength(2)
    expect(remessas.flat().map((l) => l.external_id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('não manda remessa vazia quando todo mundo tem documento', () => {
    const remessas = remessasPorDocumento([{ externalId: 'a', customerDoc: '111' }], linha)
    expect(remessas).toHaveLength(1)
  })
})
