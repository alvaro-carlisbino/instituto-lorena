import { describe, expect, it } from 'vitest'

import { agruparPorDia, mesclarAgenda } from './agendaCirurgica'

const STAFF = new Map([
  [1, 'Lorena Visentainer'],
  [2, 'Matheus Amaral'],
  [9, 'Isabela Maeda'],
])

const venda = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'v1',
    lead_id: 'lead-1',
    patient_name: 'NILSON SANTIAGO',
    procedure_label: 'Tc Frontal/ Coroa',
    performing_doctor: 'Lorena Visentainer',
    seller_doctor: null,
    attending_doctor: null,
    anesthetist: null,
    value_cents: 3_000_000,
    scheduled_at: '2026-08-13T10:00:00+00:00',
    status: 'agendada',
    room: null,
    city: 'Maringá',
    hotel_needed: false,
    srg_surgery_id: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const espelho = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 303,
    paciente_nome: 'Nilson Santiago',
    dia: '2026-08-13',
    hora_inicio: '2026-08-13T10:41:48+00:00',
    status: 'FINALIZADA',
    sala: '02',
    meta: 4500,
    total_implantados: 4600,
    medico_id: 1,
    anestesista_id: 9,
    lead_id: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

/**
 * A agenda cirúrgica junta duas fontes que enxergam metades diferentes da mesma
 * cirurgia: a venda (o que foi combinado) e o espelho do centro cirúrgico (o que
 * aconteceu). Estes testes travam a regra de quem manda em quê.
 */
describe('mesclarAgenda', () => {
  it('junta venda e espelho numa linha só quando há vínculo', () => {
    const linhas = mesclarAgenda([venda({ srg_surgery_id: 303 })], [espelho()], STAFF)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].origem).toBe('ambos')
    // a venda manda no combinado, o espelho manda no fato consumado
    expect(linhas[0].procedimento).toBe('Tc Frontal/ Coroa')
    expect(linhas[0].valorCents).toBe(3_000_000)
    expect(linhas[0].sala).toBe('02')
    expect(linhas[0].implantados).toBe(4600)
    expect(linhas[0].statusSala).toBe('FINALIZADA')
  })

  it('não duplica a cirurgia vinculada na varredura do espelho', () => {
    const linhas = mesclarAgenda([venda({ srg_surgery_id: 303 })], [espelho()], STAFF)
    expect(linhas.filter((l) => l.srgId === 303)).toHaveLength(1)
  })

  it('mostra a cirurgia que a sala registrou e o CRM não vendeu', () => {
    const linhas = mesclarAgenda([], [espelho()], STAFF)
    expect(linhas).toHaveLength(1)
    expect(linhas[0].origem).toBe('sala')
    expect(linhas[0].saleId).toBeNull()
    // sem venda não há valor: bloco de sala ocupado não é faturamento
    expect(linhas[0].valorCents).toBeNull()
  })

  it('mostra a venda marcada que a sala ainda não registrou', () => {
    const linhas = mesclarAgenda([venda()], [], STAFF)
    expect(linhas[0].origem).toBe('venda')
    expect(linhas[0].srgId).toBeNull()
    expect(linhas[0].statusSala).toBeNull()
  })

  it('resolve nome de médico e anestesista pelo id do espelho', () => {
    const linhas = mesclarAgenda([], [espelho()], STAFF)
    expect(linhas[0].medico).toBe('Lorena Visentainer')
    expect(linhas[0].anestesista).toBe('Isabela Maeda')
  })

  it('quando a sala confirmou, o dia é o dela — remarcação que não voltou para a venda não some', () => {
    const linhas = mesclarAgenda(
      [venda({ srg_surgery_id: 303, scheduled_at: '2026-08-13T10:00:00+00:00' })],
      [espelho({ dia: '2026-08-20' })],
      STAFF,
    )
    expect(linhas[0].dia).toBe('2026-08-20')
  })

  it('venda sem data não entra na agenda', () => {
    expect(mesclarAgenda([venda({ scheduled_at: null })], [], STAFF)).toHaveLength(0)
  })

  it('a hora 10:00 UTC da venda não vira dia 12 no fuso da clínica', () => {
    // toda venda importada da planilha ficou com a MESMA hora (10:00Z) porque a
    // planilha só tinha a data. 10:00Z é 07:00 em Maringá: mesmo dia, e é isso que
    // a agenda precisa mostrar.
    const linhas = mesclarAgenda([venda({ scheduled_at: '2026-08-13T10:00:00+00:00' })], [], STAFF)
    expect(linhas[0].dia).toBe('2026-08-13')
  })

  it('ordena por dia', () => {
    const linhas = mesclarAgenda(
      [
        venda({ id: 'v2', scheduled_at: '2026-08-20T10:00:00+00:00', patient_name: 'B' }),
        venda({ id: 'v1', scheduled_at: '2026-08-13T10:00:00+00:00', patient_name: 'A' }),
      ],
      [],
      STAFF,
    )
    expect(linhas.map((l) => l.dia)).toEqual(['2026-08-13', '2026-08-20'])
  })
})

describe('agruparPorDia', () => {
  it('põe as três cirurgias do mesmo dia na mesma célula do calendário', () => {
    const linhas = mesclarAgenda(
      [
        venda({ id: 'a', patient_name: 'JULIANA' }),
        venda({ id: 'b', patient_name: 'AMANDA' }),
        venda({ id: 'c', patient_name: 'ISMAEL', scheduled_at: '2026-08-14T10:00:00+00:00' }),
      ],
      [],
      STAFF,
    )
    const mapa = agruparPorDia(linhas)
    expect(mapa.get('2026-08-13')).toHaveLength(2)
    expect(mapa.get('2026-08-14')).toHaveLength(1)
    expect(mapa.get('2026-08-15')).toBeUndefined()
  })
})
