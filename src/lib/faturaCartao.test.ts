// Datas e descrições reais do Itaú Empresas da clínica (fecha dia 2, vence dia 15).
import { describe, expect, it } from 'vitest'

import {
  comprasPorCentro,
  diaDeFechamento,
  ehBoletoDoCartao,
  ehPagamentoDeFatura,
  fechamentoDoPagamento,
  inicioDasCompras,
  janelaDaFatura,
  montarFaturas,
  type ItemCartao,
} from '@/lib/faturaCartao'

const item = (id: string, data: string, cents: number, extra: Partial<ItemCartao> = {}): ItemCartao => ({
  id,
  data,
  descricao: id,
  amountCents: cents,
  credito: false,
  centro: null,
  detalhe: null,
  ...extra,
})

describe('ehPagamentoDeFatura', () => {
  it('reconhece as caras que o boleto do cartão já teve no extrato', () => {
    expect(ehPagamentoDeFatura('BOLETO  PAGO Fatura Carta')).toBe(true)
    expect(ehPagamentoDeFatura('BOLETO PAGO Fatura Carta')).toBe(true)
    expect(ehPagamentoDeFatura('BUSINESS      4004-2658')).toBe(true)
    expect(ehPagamentoDeFatura('Débito automático ITAU MC 1509-4113')).toBe(true)
  })

  it('não pega fornecedor com a palavra no nome', () => {
    expect(ehPagamentoDeFatura('PIX ENVIADO BUSINESS CENTER LTDA')).toBe(false)
    expect(ehPagamentoDeFatura('BOLETO PAGO SULMEDIC COM')).toBe(false)
    expect(ehPagamentoDeFatura(null)).toBe(false)
  })
})

describe('ehBoletoDoCartao', () => {
  it('boleto marcado como de outro cartão sai do cartão e conta sozinho', () => {
    expect(ehBoletoDoCartao({ description: 'BOLETO  PAGO Fatura Carta' })).toBe(true)
    expect(ehBoletoDoCartao({ description: 'BOLETO  PAGO Fatura Carta', faturaSemCompras: true })).toBe(false)
    expect(ehBoletoDoCartao({ description: 'PIX ENVIADO FULANO' })).toBe(false)
  })
})

describe('fechamentoDoPagamento', () => {
  it('pago no vencimento: a fatura fechou no dia 2 do mesmo mês', () => {
    expect(fechamentoDoPagamento('2026-09-15', 2)).toBe('2026-09-02')
    expect(fechamentoDoPagamento('2026-06-11', 2)).toBe('2026-06-02')
  })

  it('pago depois do vencimento (dia 15 no sábado) continua na mesma fatura', () => {
    expect(fechamentoDoPagamento('2026-08-17', 2)).toBe('2026-08-02')
    expect(fechamentoDoPagamento('2026-08-18', 2)).toBe('2026-08-02')
  })

  it('pago logo depois de fechar é da fatura anterior, que é a que estava para vencer', () => {
    expect(fechamentoDoPagamento('2026-09-04', 2)).toBe('2026-08-02')
  })

  it('fechamento 31 em mês curto cai no último dia', () => {
    expect(fechamentoDoPagamento('2026-03-12', 31)).toBe('2026-02-28')
  })

  it('vira o ano', () => {
    expect(fechamentoDoPagamento('2027-01-15', 2)).toBe('2027-01-02')
    expect(fechamentoDoPagamento('2027-01-05', 2)).toBe('2026-12-02')
  })
})

describe('janelaDaFatura', () => {
  it('vai do dia seguinte ao fechamento anterior até o fechamento', () => {
    expect(janelaDaFatura('2026-09-02', 2)).toEqual({ de: '2026-08-03', ate: '2026-09-02' })
    expect(janelaDaFatura('2026-01-02', 2)).toEqual({ de: '2025-12-03', ate: '2026-01-02' })
  })
})

describe('diaDeFechamento', () => {
  it('usa o que o banco mandou, e o padrão quando não mandou', () => {
    expect(diaDeFechamento({ ofBillCloseDate: '2026-09-02' })).toBe(2)
    expect(diaDeFechamento({ ofBillCloseDate: '2026-09-10' })).toBe(10)
    expect(diaDeFechamento({ ofBillCloseDate: null })).toBe(2)
    expect(diaDeFechamento(null)).toBe(2)
  })
})

describe('montarFaturas', () => {
  const itens = [
    item('julho', '2026-07-20', 5_000_00),
    item('fecha', '2026-08-02', 1_000_00),
    item('abre', '2026-08-03', 2_000_00, { centro: 'Marketing' }),
    item('meio', '2026-08-20', 3_000_00, { centro: 'Centro Cirúrgico' }),
    item('estorno', '2026-08-21', 500_00, { credito: true }),
    item('fecha-set', '2026-09-02', 700_00, { centro: 'Marketing' }),
    item('outubro', '2026-09-03', 9_999_00),
  ]

  it('põe dentro só as compras da janela e mostra a diferença para o boleto', () => {
    const [f] = montarFaturas([{ id: 'p', data: '2026-09-15', descricao: 'BUSINESS 4004-2658', amountCents: 5_000_00 }], itens, 2)
    expect(f.fechamento).toBe('2026-09-02')
    expect(f.compras.map((c) => c.id)).toEqual(['abre', 'meio', 'fecha-set'])
    expect(f.creditos.map((c) => c.id)).toEqual(['estorno'])
    expect(f.comprasCents).toBe(5_700_00)
    expect(f.creditosCents).toBe(500_00)
    // 5.000 pago − (5.700 − 500) = −200: o banco mandou mais compra do que foi pago
    expect(f.diferencaCents).toBe(-200_00)
  })

  it('dois boletos da mesma fatura ficam juntos, sem repetir as compras', () => {
    const faturas = montarFaturas(
      [
        { id: 'a', data: '2026-08-17', descricao: 'BUSINESS 4004-2658', amountCents: 3_000_00 },
        { id: 'b', data: '2026-08-18', descricao: 'BOLETO  PAGO Fatura Carta', amountCents: 500_00 },
      ],
      itens,
      2,
    )
    expect(faturas).toHaveLength(1)
    expect(faturas[0].pagamentos.map((p) => p.id)).toEqual(['a', 'b'])
    expect(faturas[0].compras.map((c) => c.id)).toEqual(['julho', 'fecha'])
    expect(faturas[0].pagoCents).toBe(3_500_00)
  })

  it('mais nova primeiro', () => {
    const faturas = montarFaturas(
      [
        { id: 'a', data: '2026-08-17', descricao: '', amountCents: 1 },
        { id: 'b', data: '2026-09-15', descricao: '', amountCents: 1 },
      ],
      itens,
      2,
    )
    expect(faturas.map((f) => f.fechamento)).toEqual(['2026-09-02', '2026-08-02'])
  })
})

describe('inicioDasCompras', () => {
  it('é o começo da janela da fatura mais antiga', () => {
    expect(inicioDasCompras([{ data: '2026-09-15' }, { data: '2026-08-17' }], 2)).toBe('2026-07-03')
    expect(inicioDasCompras([], 2)).toBeNull()
  })
})

describe('comprasPorCentro', () => {
  it('soma por centro, maior primeiro, e sem centro fica como null', () => {
    const r = comprasPorCentro([
      item('a', '2026-08-03', 100, { centro: 'Marketing' }),
      item('b', '2026-08-04', 300),
      item('c', '2026-08-05', 150, { centro: 'Marketing' }),
    ])
    expect(r).toEqual([
      { centro: null, cents: 300, n: 1 },
      { centro: 'Marketing', cents: 250, n: 2 },
    ])
  })
})
