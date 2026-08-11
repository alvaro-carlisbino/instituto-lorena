// Regras que a tela de conciliação já quebrou uma vez cada. Os números vêm do fechamento
// real de julho/2026 (300 vendas, R$ 1.567.726, extrato do Itaú Empresas).
import { describe, expect, it } from 'vitest'

import {
  CONFIG_PADRAO,
  assinaturaContraparte,
  classificarCredito,
  reconcileShospVsBanco,
  type BankCredit,
  type ReconcileConfig,
} from '@/services/conciliacaoShosp'
import type { ShospSale } from '@/services/shospVendas'

let seq = 0
function venda(p: Partial<ShospSale> & Pick<ShospSale, 'date' | 'amountCents'>): ShospSale {
  seq += 1
  return {
    saleId: `v${seq}`,
    patient: `PACIENTE ${seq}`,
    cpf: '',
    method: 'pix',
    methods: ['pix'],
    mixed: false,
    methodRaw: 'PX',
    installments: 1,
    caixa: 'ITAU MARINGA - PIX/CARTÃO/TED',
    services: [],
    provider: '',
    doc: `d${seq}`,
    status: 'A',
    rowNumber: seq,
    rowNumbers: [seq],
    key: `cod:d${seq}`,
    ...p,
  }
}
function credito(date: string, amountCents: number, description: string): BankCredit {
  seq += 1
  return { id: `c${seq}`, date, amountCents, description }
}
const cfg = (over: Partial<ReconcileConfig> = {}): ReconcileConfig => ({ ...CONFIG_PADRAO, ...over })

describe('classificarCredito', () => {
  it('não conta rendimento de aplicação como venda', () => {
    // O Itaú escreve "APLIC", e o regex pedia "aplicac": 12 lançamentos de rendimento de
    // julho/2026 caíam no balde de venda e viravam "entrada no banco sem venda".
    expect(classificarCredito(credito('2026-07-01', 398, 'REND PAGO APLIC AUT MAIS'))).toBe('nao_venda')
  })

  it('depósito de CHEQUE não é dinheiro em espécie', () => {
    // Casava com `dep\s` e os R$ 37.800 de um cheque entravam no fechamento de caixa,
    // fazendo a clínica parecer ter depositado espécie que nunca existiu.
    expect(classificarCredito(credito('2026-07-27', 3780000, 'DEP CHEQUE ATM N. 018591'))).toBe('venda')
    expect(classificarCredito(credito('2026-07-27', 50000, 'DEPOSITO DINHEIRO ATM'))).toBe('deposito')
  })

  it('regra do usuário ganha do regex embutido', () => {
    // "PIX TRANSF INSTITU16/07" tem `pix` na descrição e viraria venda de paciente. São
    // R$ 412.215 em 22 lançamentos que na verdade são a conta irmã do grupo.
    const c = credito('2026-07-16', 4551520, 'PIX TRANSF INSTITU16/07')
    expect(classificarCredito(c)).toBe('venda')
    expect(classificarCredito(c, [{ pattern: 'PIX TRANSF INSTITU', classe: 'nao_venda' }])).toBe('nao_venda')
  })
})

describe('assinaturaContraparte', () => {
  it('agrupa o mesmo pagador em datas diferentes', () => {
    // Sem tirar a data colada no nome, cada dia virava uma contraparte e nada agrupava.
    expect(assinaturaContraparte('PIX TRANSF INSTITU16/07')).toBe(
      assinaturaContraparte('PIX TRANSF INSTITU24/07'),
    )
  })
})

describe('cartão: cronograma de parcelas', () => {
  const dezVezes = venda({
    date: '2026-07-10',
    amountCents: 1_000_000,
    method: 'cartao_credito',
    methods: ['cartao_credito'],
    methodRaw: 'CC 10x',
    installments: 10,
  })

  it('só cobra a parcela que já venceu; o resto é a receber', () => {
    // O motor antigo esperava os R$ 10.000 inteiros dentro da janela e acusava o que faltava
    // como repasse sumido. Em julho/2026 isso inflou "sem repasse" para R$ 664.316.
    const r = reconcileShospVsBanco(
      [dezVezes],
      [credito('2026-08-09', 97_000, 'REDE  VISA CD0085868531')],
      cfg({ extratoAte: '2026-08-31' }),
    )
    // vencidas até 31/ago: só a 1ª parcela (09/ago). A 2ª cai em 08/set.
    expect(r.cartao.esperadoCents).toBe(100_000)
    expect(r.cartao.aReceberCents).toBe(900_000)
    // 10ª parcela = D+300
    expect(r.cartao.aReceberAte).toBe('2027-05-06')
    expect(r.divergences.filter((d) => d.kind === 'repasse_nao_encontrado')).toHaveLength(0)
  })

  it('mede a taxa sobre o que venceu, não sobre o bruto do mês', () => {
    const r = reconcileShospVsBanco(
      [dezVezes],
      [credito('2026-08-09', 97_000, 'REDE  VISA CD0085868531')],
      cfg({ extratoAte: '2026-08-31' }),
    )
    expect(r.cartao.taxaEfetivaPct).toBeCloseTo(3, 5)
    expect(r.cartao.repasseForaDaConta).toBe(false)
  })

  it('repasse que cai em outra conta vira UM fato, não uma linha por dia', () => {
    // Julho/2026: 23 dias de venda no cartão geravam 23 divergências vermelhas idênticas.
    // O fato é um só — o domicílio bancário aponta para outro lugar.
    const vendas = ['2026-07-01', '2026-07-02', '2026-07-03'].map((date) =>
      venda({
        date,
        amountCents: 500_000,
        method: 'cartao_credito',
        methods: ['cartao_credito'],
        methodRaw: 'CC',
      }),
    )
    const r = reconcileShospVsBanco(vendas, [credito('2026-08-02', 1000, 'REDE  MAST DB0085868531')], cfg({ extratoAte: '2026-08-31' }))
    const fora = r.divergences.filter((d) => d.kind === 'adquirente_fora_da_conta')
    expect(fora).toHaveLength(1)
    expect(r.cartao.repasseForaDaConta).toBe(true)
    // Sem repasse de verdade, taxa é número inventado — tem que vir nula.
    expect(r.cartao.taxaEfetivaPct).toBeNull()
  })

  it('débito liquida de uma vez, em D+1', () => {
    const r = reconcileShospVsBanco(
      [
        venda({
          date: '2026-07-10',
          amountCents: 100_000,
          method: 'cartao_debito',
          methods: ['cartao_debito'],
          methodRaw: 'CD',
        }),
      ],
      [credito('2026-07-11', 98_000, 'REDE  VISA DB0085868531')],
      cfg({ extratoAte: '2026-07-31' }),
    )
    expect(r.cartao.esperadoCents).toBe(100_000)
    expect(r.cartao.aReceberCents).toBe(0)
    expect(r.cartao.porVencimento[0].date).toBe('2026-07-11')
  })
})

describe('período', () => {
  it('não acusa crédito fora do período da planilha', () => {
    // O extrato vem esticado para alcançar o repasse do cartão. Sem este corte, todo PIX de
    // paciente de agosto virava "entrada sem venda de julho" — 37 divergências inventadas.
    const r = reconcileShospVsBanco(
      [venda({ date: '2026-07-10', amountCents: 15_000 })],
      [
        credito('2026-07-10', 15_000, 'PIX TRANSF FULANO 10/07'),
        credito('2026-08-20', 500_000, 'PIX TRANSF BELTRANO 20/08'),
      ],
      cfg(),
    )
    expect(r.casados).toHaveLength(1)
    expect(r.divergences.filter((d) => d.kind === 'credito_sem_venda')).toHaveLength(0)
    expect(r.totais.foraDoPeriodoQtd).toBe(1)
    expect(r.totais.foraDoPeriodoCents).toBe(500_000)
  })
})

describe('caixa', () => {
  it('conta quantas vendas de cada caixa não casaram', () => {
    // É o atalho pra ver que o problema é conta errada, não dinheiro sumido: 7 de 7 vendas
    // do "GRUPO INGÁ" sem crédito quer dizer que aquele caixa não passa por este extrato.
    const r = reconcileShospVsBanco(
      [
        venda({ date: '2026-07-10', amountCents: 15_000, caixa: 'GRUPO INGÁ - ANESTESISTAS' }),
        venda({ date: '2026-07-11', amountCents: 25_000, caixa: 'GRUPO INGÁ - ANESTESISTAS' }),
        venda({ date: '2026-07-12', amountCents: 35_000, caixa: 'ITAU MARINGA - PIX/CARTÃO/TED' }),
      ],
      [credito('2026-07-12', 35_000, 'PIX TRANSF FULANO 12/07')],
      cfg(),
    )
    const inga = r.semCreditoPorCaixa.find((c) => c.name === 'GRUPO INGÁ - ANESTESISTAS')
    expect(inga).toEqual({ name: 'GRUPO INGÁ - ANESTESISTAS', qtd: 2, totalQtd: 2, amountCents: 40_000 })
    expect(r.semCreditoPorCaixa.find((c) => c.name.startsWith('ITAU'))).toBeUndefined()
  })
})
