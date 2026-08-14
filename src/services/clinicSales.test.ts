import { describe, expect, it } from 'vitest'

import { type ClinicSale, diasAteFechar, followUpStats, salesByDoctor } from './clinicSales'

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
