import { describe, expect, it } from 'vitest'

import {
  type ClinicSale,
  classificarProcedimento,
  diasAteFechar,
  followUpStats,
  salesByDoctor,
  salesByProcedure,
} from './clinicSales'

const venda = (over: Partial<ClinicSale> = {}): ClinicSale =>
  ({
    id: 'v1',
    kind: 'cirurgia',
    leadId: null,
    patientName: 'Paciente',
    phone: null,
    city: null,
    origin: null,
    soldAt: '2026-08-05',
    consultationAt: '2026-08-05',
    sellerName: null,
    consultationType: null,
    procedureLabel: 'Tc Frontal/ Coroa',
    sellerDoctor: null,
    attendingDoctor: 'Lorena Visentainer',
    performingDoctor: 'Lorena Visentainer',
    anesthetist: null,
    valueCents: 3_000_000,
    depositCents: null,
    depositAt: null,
    depositPayee: null,
    paymentMethod: null,
    installments: null,
    invoiceIssued: false,
    confirmationStatus: 'nao_confirmada',
    confirmationAt: null,
    confirmationNote: null,
    costMaterialsCents: 0,
    costDoctorCents: 0,
    taxCents: 0,
    costOtherCents: 0,
    profitCents: 3_000_000,
    scheduledAt: null,
    schedulePending: true,
    durationMinutes: null,
    room: null,
    hotelNeeded: false,
    contractUrl: null,
    note: null,
    status: 'vendida',
    canceledAt: null,
    cancelReason: null,
    refundStatus: null,
    cancelNote: null,
    surgeryAccountId: null,
    srgSurgeryId: null,
    createdAt: '2026-08-05T12:00:00Z',
    ...over,
  }) satisfies ClinicSale

/**
 * A métrica que faltava na Central de Vendas: quanto do faturamento fecha na própria
 * consulta e quanto vem do follow-up. Na base real são 134 no dia contra 69 em follow-up
 * nas cirurgias — e o follow-up mais longo fechou 1004 dias depois.
 */
describe('diasAteFechar', () => {
  it('zero quando a venda é no dia da consulta', () => {
    expect(diasAteFechar(venda({ consultationAt: '2026-08-05', soldAt: '2026-08-05' }))).toBe(0)
  })

  it('conta os dias de calendário do follow-up', () => {
    expect(diasAteFechar(venda({ consultationAt: '2026-07-01', soldAt: '2026-08-05' }))).toBe(35)
  })

  it('não desconta um dia por causa de fuso: as duas colunas são date', () => {
    // fevereiro de ano bissexto, e um intervalo que cruza a virada do mês
    expect(diasAteFechar(venda({ consultationAt: '2026-02-27', soldAt: '2026-03-01' }))).toBe(2)
  })

  it('negativo quando a consulta ficou registrada depois da venda', () => {
    expect(diasAteFechar(venda({ consultationAt: '2026-08-10', soldAt: '2026-08-05' }))).toBe(-5)
  })

  it('null quando não há consulta registrada', () => {
    expect(diasAteFechar(venda({ consultationAt: null }))).toBeNull()
  })
})

describe('followUpStats', () => {
  const base = [
    venda({ id: 'a', consultationAt: '2026-08-05', soldAt: '2026-08-05', valueCents: 100 }),
    venda({ id: 'b', consultationAt: '2026-07-05', soldAt: '2026-08-05', valueCents: 200 }),
    venda({ id: 'c', consultationAt: '2026-08-01', soldAt: '2026-08-05', valueCents: 400 }),
    venda({ id: 'd', consultationAt: null, soldAt: '2026-08-05' }),
    venda({ id: 'e', consultationAt: '2026-09-01', soldAt: '2026-08-05' }),
  ]

  it('separa o que fechou na consulta do que veio de follow-up', () => {
    const s = followUpStats(base)
    expect(s.noDia).toBe(1)
    expect(s.followUp).toBe(2)
    expect(s.semConsulta).toBe(1)
    expect(s.consultaDepois).toBe(1)
  })

  it('soma o faturamento de cada lado separadamente', () => {
    const s = followUpStats(base)
    expect(s.valorNoDiaCents).toBe(100)
    expect(s.valorFollowUpCents).toBe(600)
  })

  it('usa mediana, não média — uma venda de 1004 dias não pode mover o número', () => {
    const s = followUpStats([
      venda({ id: '1', consultationAt: '2026-08-01', soldAt: '2026-08-06' }), // 5
      venda({ id: '2', consultationAt: '2026-08-01', soldAt: '2026-08-11' }), // 10
      venda({ id: '3', consultationAt: '2023-11-01', soldAt: '2026-08-01' }), // 1004
    ])
    expect(s.medianaDias).toBe(10)
  })

  it('venda cancelada não entra em nenhuma conta', () => {
    const s = followUpStats([
      venda({ id: 'x', status: 'cancelada', consultationAt: '2026-07-01', soldAt: '2026-08-05' }),
    ])
    expect(s.total).toBe(0)
    expect(s.followUp).toBe(0)
  })

  it('mediana fica em zero quando não houve follow-up nenhum', () => {
    const s = followUpStats([venda({ consultationAt: '2026-08-05', soldAt: '2026-08-05' })])
    expect(s.medianaDias).toBe(0)
  })
})

describe('salesByDoctor', () => {
  it('credita o follow-up a quem atendeu a consulta, não a quem opera', () => {
    const linhas = salesByDoctor([
      venda({
        id: 'a',
        attendingDoctor: 'Lorena Visentainer',
        performingDoctor: 'Matheus Amaral',
        consultationAt: '2026-07-01',
        soldAt: '2026-08-05',
      }),
      venda({
        id: 'b',
        attendingDoctor: 'Lorena Visentainer',
        performingDoctor: 'Lorena Visentainer',
        consultationAt: '2026-08-05',
        soldAt: '2026-08-05',
      }),
    ])
    const lorena = linhas.find((l) => l.nome === 'Lorena Visentainer')
    const matheus = linhas.find((l) => l.nome === 'Matheus Amaral')
    expect(lorena?.vendeu).toBe(2)
    expect(lorena?.followUp).toBe(1)
    expect(matheus?.vendeu).toBe(0)
    expect(matheus?.executa).toBe(1)
    expect(matheus?.followUp).toBe(0)
  })
})

/**
 * As onze grafias que existem em produção hoje. O campo é texto livre, então o teste
 * é a lista real e não exemplos inventados: é ela que diz se a regra classifica ou
 * inventa. Contagens conferidas no banco em 18/ago/2026.
 */
describe('classificarProcedimento', () => {
  it('manda cada grafia de produção para o transplante certo', () => {
    expect(classificarProcedimento('Tc Frontal/ Coroa')).toBe('masculino')
    expect(classificarProcedimento('Tc Frontal/ Coroa/Barba')).toBe('masculino')
    expect(classificarProcedimento('Barba')).toBe('masculino')
    expect(classificarProcedimento('Hairline')).toBe('masculino')

    expect(classificarProcedimento('Tc Feminino')).toBe('feminino')
    expect(classificarProcedimento('TC feminino + Nanofat')).toBe('feminino')
    expect(classificarProcedimento('Tc Feminino + nanofat')).toBe('feminino')

    expect(classificarProcedimento('Sobrancelha')).toBe('sobrancelha')
    expect(classificarProcedimento('Sobrancelha + nanofat')).toBe('sobrancelha')
  })

  it('a combinada entra pelo transplante, não pelo acréscimo', () => {
    // R$ 40 mil em média. Contada como sobrancelha, inflaria o procedimento mais
    // barato da casa e faria o ticket de sobrancelha mentir para cima.
    expect(classificarProcedimento('TC Feminino + Sobrancelhas')).toBe('feminino')
  })

  it('não força o que não é transplante para dentro de um grupo', () => {
    expect(classificarProcedimento('Teste de remarcação')).toBe('outros')
    expect(classificarProcedimento('')).toBe('outros')
    expect(classificarProcedimento(null)).toBe('outros')
  })

  it('ignora acento e caixa', () => {
    expect(classificarProcedimento('TRANSPLANTE FEMININO')).toBe('feminino')
    expect(classificarProcedimento('sobrancelhas')).toBe('sobrancelha')
  })
})

describe('salesByProcedure', () => {
  it('separa o ticket e mostra as grafias que caíram em cada grupo', () => {
    const linhas = salesByProcedure([
      venda({ id: 'a', procedureLabel: 'Tc Frontal/ Coroa', valueCents: 3_000_000 }),
      venda({ id: 'b', procedureLabel: 'Tc Frontal/ Coroa', valueCents: 4_000_000 }),
      venda({ id: 'c', procedureLabel: 'Sobrancelha', valueCents: 2_400_000 }),
      venda({ id: 'd', procedureLabel: 'Tc Feminino', valueCents: 3_500_000 }),
      // Cancelada não entra: entraria como venda de R$ 0 e derrubaria a média.
      venda({ id: 'e', procedureLabel: 'Sobrancelha', valueCents: 9_900_000, status: 'cancelada' }),
    ])

    const masculino = linhas.find((l) => l.grupo === 'masculino')
    expect(masculino?.vendeu).toBe(2)
    expect(masculino?.ticketCents).toBe(3_500_000)

    const sobrancelha = linhas.find((l) => l.grupo === 'sobrancelha')
    expect(sobrancelha?.vendeu).toBe(1)
    expect(sobrancelha?.ticketCents).toBe(2_400_000)

    expect(masculino?.rotulos).toEqual(['Tc Frontal/ Coroa (2)'])
    // A ordem é a do funil de preço, não a de quem apareceu primeiro na lista.
    expect(linhas.map((l) => l.grupo)).toEqual(['masculino', 'feminino', 'sobrancelha'])
  })
})
