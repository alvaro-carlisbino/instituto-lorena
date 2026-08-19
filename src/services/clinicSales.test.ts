import { describe, expect, it } from 'vitest'

import {
  type ClinicSale,
  type FiltroVendas,
  classificarProcedimento,
  diasAteFechar,
  filtrarVendas,
  followUpStats,
  salesByDoctor,
  salesByProcedure,
  vendasDispensadas,
  vendasSemData,
  vendasSemNota,
  vendasSemPaciente,
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
    noDateDismissedAt: null,
    noDateDismissedReason: null,
    noPatientDismissedAt: null,
    noPatientDismissedReason: null,
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

describe('filtrarVendas', () => {
  const padrao: FiltroVendas = {
    recorte: 'mes',
    mes: '2026-08',
    status: 'ativas',
    vendedora: 'todas',
    termo: '',
  }

  const base = [
    venda({ id: 'jan', soldAt: '2026-01-12', scheduledAt: null, leadId: 'l1', patientName: 'José Antônio' }),
    venda({
      id: 'ago-com-data',
      soldAt: '2026-08-05',
      scheduledAt: '2026-09-10T07:00:00Z',
      leadId: 'l2',
      patientName: 'Maria Souza',
      sellerName: 'Aline Muniz',
    }),
    venda({ id: 'ago-sem-data', soldAt: '2026-08-07', scheduledAt: null, leadId: null, patientName: 'Ana Lima' }),
    venda({ id: 'cancelada', soldAt: '2026-08-08', scheduledAt: null, leadId: 'l3', status: 'cancelada' }),
  ]

  it('o padrão é o mês, sem canceladas', () => {
    const ids = filtrarVendas(base, padrao).map((s) => s.id)
    expect(ids).toEqual(['ago-com-data', 'ago-sem-data'])
  })

  it('"sem data" atravessa o mês e não some com a venda de janeiro', () => {
    const ids = filtrarVendas(base, { ...padrao, recorte: 'sem-data' }).map((s) => s.id)
    expect(ids).toContain('jan')
    expect(ids).toContain('ago-sem-data')
    expect(ids).not.toContain('ago-com-data')
  })

  it('"sem data" põe a mais parada primeiro', () => {
    const ids = filtrarVendas(base, { ...padrao, recorte: 'sem-data' }).map((s) => s.id)
    expect(ids[0]).toBe('jan')
  })

  it('"sem data" não conta cancelada', () => {
    const ids = filtrarVendas(base, { ...padrao, recorte: 'sem-data' }).map((s) => s.id)
    expect(ids).not.toContain('cancelada')
  })

  it('"sem paciente" traz só quem não tem cadastro vinculado', () => {
    const ids = filtrarVendas(base, { ...padrao, recorte: 'sem-paciente' }).map((s) => s.id)
    expect(ids).toEqual(['ago-sem-data'])
  })

  it('cancelada só aparece quando o filtro pede', () => {
    expect(filtrarVendas(base, { ...padrao, status: 'cancelada' }).map((s) => s.id)).toEqual(['cancelada'])
    expect(filtrarVendas(base, { ...padrao, status: 'todas' }).map((s) => s.id)).toContain('cancelada')
  })

  it('a busca acha sem acento e em qualquer mês do recorte', () => {
    const ids = filtrarVendas(base, { ...padrao, recorte: 'sem-data', termo: 'jose' }).map((s) => s.id)
    expect(ids).toEqual(['jan'])
  })

  it('a vendedora filtra por nome exato', () => {
    const ids = filtrarVendas(base, { ...padrao, vendedora: 'Aline Muniz' }).map((s) => s.id)
    expect(ids).toEqual(['ago-com-data'])
  })

  it('busca e recorte se somam: termo que não bate esvazia a lista', () => {
    expect(filtrarVendas(base, { ...padrao, termo: 'ninguém com esse nome' })).toEqual([])
  })
})

describe('vendasSemData e vendasSemPaciente', () => {
  it('ignoram cancelada nas duas contagens', () => {
    const lista = [
      venda({ id: 'a', scheduledAt: null, leadId: null }),
      venda({ id: 'b', scheduledAt: null, leadId: null, status: 'cancelada' }),
      venda({ id: 'c', scheduledAt: '2026-09-01T07:00:00Z', leadId: 'l1' }),
    ]
    expect(vendasSemData(lista).map((s) => s.id)).toEqual(['a'])
    expect(vendasSemPaciente(lista).map((s) => s.id)).toEqual(['a'])
  })
})

/**
 * Nota fiscal pendente. Na base real de ago/2026 são 45 cirurgias JÁ REALIZADAS sem
 * nota, R$ 575 mil — e 173 ainda por acontecer, que é fluxo normal. Somar tudo num
 * número só transformaria a pendência fiscal em ruído.
 */
describe('vendasSemNota', () => {
  const base = [
    venda({ id: 'a', status: 'realizada', invoiceIssued: false, valueCents: 3_000_000, soldAt: '2026-03-02' }),
    venda({ id: 'b', status: 'realizada', invoiceIssued: true, valueCents: 4_000_000 }),
    venda({ id: 'c', status: 'vendida', invoiceIssued: false, valueCents: 500_000 }),
    venda({ id: 'd', status: 'cancelada', invoiceIssued: false, valueCents: 900_000 }),
  ]

  it('separa a pendência fiscal do fluxo normal', () => {
    const r = vendasSemNota(base)
    expect(r.todas.map((s) => s.id)).toEqual(['a', 'c'])
    expect(r.realizadas.map((s) => s.id)).toEqual(['a'])
    expect(r.realizadasCents).toBe(3_000_000)
  })

  it('venda cancelada não cobra nota', () => {
    expect(vendasSemNota(base).todas.some((s) => s.id === 'd')).toBe(false)
  })

  it('o recorte da tela lista as pendentes, mais antiga primeiro', () => {
    const filtro: FiltroVendas = {
      recorte: 'sem-nota',
      mes: '2026-08',
      status: 'ativas',
      vendedora: 'todas',
      termo: '',
    }
    // A de março atravessa o mês escolhido de propósito: nota que não saiu em março
    // continua não tendo saído, e é a antiga que ninguém lembra.
    expect(filtrarVendas(base, filtro).map((s) => s.id)).toEqual(['a', 'c'])
  })
})

/**
 * Zerar a fila de pendência. As duas filas nasceram com o passivo da planilha — 9 sem
 * data e 71 sem paciente, 64 destas de cirurgia já realizada —, e fila que nunca chega
 * a zero ninguém abre. Dispensar tira da cobrança sem apagar nada: a venda continua na
 * lista do mês, sem data e sem cadastro, do jeito que está.
 */
describe('vendasDispensadas e a fila que cobra', () => {
  const base = [
    venda({ id: 'a', scheduledAt: null, leadId: null }),
    venda({ id: 'b', scheduledAt: null, leadId: null, noDateDismissedAt: '2026-08-19T13:00:00Z' }),
    venda({
      id: 'c',
      scheduledAt: '2026-09-01T07:00:00Z',
      leadId: null,
      noPatientDismissedAt: '2026-08-19T13:00:00Z',
    }),
  ]

  it('dispensada sai da fila que cobra, e cada fila só responde pela sua dispensa', () => {
    // 'b' foi dispensada de "sem data" e segue cobrando em "sem paciente": são
    // pendências diferentes, e zerar uma não pode zerar a outra de carona.
    expect(vendasSemData(base).map((s) => s.id)).toEqual(['a'])
    expect(vendasSemPaciente(base).map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('o que saiu continua contado, para "zerada" não virar "resolvida"', () => {
    expect(vendasDispensadas(base, 'sem-data').map((s) => s.id)).toEqual(['b'])
    expect(vendasDispensadas(base, 'sem-paciente').map((s) => s.id)).toEqual(['c'])
  })

  const filtro = { mes: '2026-08', status: 'ativas', vendedora: 'todas', termo: '' } as const

  it('a tela mostra a fila ou as dispensadas, nunca as duas misturadas', () => {
    expect(filtrarVendas(base, { ...filtro, recorte: 'sem-data' }).map((s) => s.id)).toEqual(['a'])
    expect(
      filtrarVendas(base, { ...filtro, recorte: 'sem-data', verDispensadas: true }).map((s) => s.id),
    ).toEqual(['b'])
  })

  it('dispensar não tira a venda do mês: some da cobrança, não do sistema', () => {
    expect(filtrarVendas(base, { ...filtro, recorte: 'mes' }).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })
})
