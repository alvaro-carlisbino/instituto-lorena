import { describe, expect, it } from 'vitest'

import { possiveisCopias } from '@/lib/copiasBanco'

const l = (id: string, descricao: string, amountCents = 158_105, data = '2026-09-03') => ({ id, data, descricao, amountCents })

describe('possiveisCopias', () => {
  it('junta o pendente do lote com o boleto compensado, mesmo com descrição diferente', () => {
    const m = possiveisCopias([l('a', 'SISPAG FORNECEDORES'), l('b', 'SISPAG FORNECEDORES'), l('c', 'BOLETO  PAGO GRAFICA CENTRAL')])
    expect(m.get('c')?.map((x) => x.id).sort()).toEqual(['a', 'b'])
    expect(m.get('a')?.map((x) => x.id).sort()).toEqual(['b', 'c'])
  })

  it('não marca salários de mesmo valor no mesmo dia para pessoas diferentes', () => {
    const m = possiveisCopias([l('a', 'PIX ENVIADO MARIA SOUZA', 530_157), l('b', 'PIX ENVIADO JOANA LIMA', 530_157)])
    expect(m.size).toBe(0)
  })

  it('marca a mesma descrição repetida no mesmo dia e valor', () => {
    const m = possiveisCopias([l('a', 'DA  TELEFONE FIXO', 10_845), l('b', 'DA  TELEFONE FIXO', 10_845)])
    expect(m.get('a')?.[0].id).toBe('b')
  })

  it('dia ou valor diferente nunca é cópia', () => {
    expect(possiveisCopias([l('a', 'SISPAG FORNECEDORES'), l('b', 'SISPAG FORNECEDORES', 158_105, '2026-09-04')]).size).toBe(0)
    expect(possiveisCopias([l('a', 'SISPAG FORNECEDORES'), l('b', 'SISPAG FORNECEDORES', 158_106)]).size).toBe(0)
  })
})
