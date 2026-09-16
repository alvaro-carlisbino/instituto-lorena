import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mesAtual,
  mesComOffset,
  periodoAnterior,
  periodoDaSemana,
  periodoDoDia,
  periodoDoMes,
  periodoDoMesInteiro,
  periodoEmInstantes,
  periodoPersonalizado,
  periodoUltimosDias,
  rotuloDoMes,
} from './periodo'

describe('períodos de agenda (olham para frente)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('amanhã é o dia seguinte no fuso da clínica, mesmo às 22h de Maringá', () => {
    vi.useFakeTimers()
    // 22h de 16/set em Maringá já é 17/set em UTC.
    vi.setSystemTime(new Date('2026-09-17T01:00:00Z'))
    expect(periodoDoDia(0)).toMatchObject({ de: '2026-09-16', ate: '2026-09-16', rotulo: 'Hoje' })
    expect(periodoDoDia(1)).toMatchObject({ de: '2026-09-17', ate: '2026-09-17', rotulo: 'Amanhã' })
  })

  it('a semana vai de segunda a domingo e inclui os dias que ainda não chegaram', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T15:00:00Z')) // quarta-feira
    expect(periodoDaSemana(0)).toMatchObject({ de: '2026-09-14', ate: '2026-09-20' })
    expect(periodoDaSemana(1)).toMatchObject({ de: '2026-09-21', ate: '2026-09-27', rotulo: 'Semana que vem' })
  })

  it('no domingo, "esta semana" ainda é a que começou na segunda anterior', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T15:00:00Z')) // domingo
    expect(periodoDaSemana(0)).toMatchObject({ de: '2026-09-14', ate: '2026-09-20' })
  })

  it('a semana que atravessa o mês não é cortada', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T15:00:00Z')) // quinta-feira
    expect(periodoDaSemana(0)).toMatchObject({ de: '2026-09-28', ate: '2026-10-04' })
  })

  it('o mês inteiro vai até o último dia, mesmo sendo o mês corrente', () => {
    expect(periodoDoMesInteiro('2026-09')).toMatchObject({ de: '2026-09-01', ate: '2026-09-30', rotulo: 'Setembro/2026' })
  })
})

describe('mesComOffset', () => {
  it('atravessa a virada do ano para trás', () => {
    expect(mesComOffset('2026-01', -1)).toBe('2025-12')
  })

  it('atravessa a virada do ano para frente', () => {
    expect(mesComOffset('2026-12', 1)).toBe('2027-01')
  })

  it('anda mais de doze meses', () => {
    expect(mesComOffset('2026-08', -14)).toBe('2025-06')
  })
})

describe('periodoDoMes', () => {
  it('fevereiro de ano bissexto termina no dia 29', () => {
    expect(periodoDoMes('2024-02')).toMatchObject({ de: '2024-02-01', ate: '2024-02-29' })
  })

  it('fevereiro comum termina no dia 28', () => {
    expect(periodoDoMes('2025-02')).toMatchObject({ de: '2025-02-01', ate: '2025-02-28' })
  })

  it('mês de 30 dias não vira 31', () => {
    expect(periodoDoMes('2026-04').ate).toBe('2026-04-30')
  })

  it('o mês CORRENTE para em hoje: somar dia que não aconteceu afunda a média por dia', () => {
    const p = periodoDoMes(mesAtual())
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    expect(p.ate).toBe(hoje)
  })

  it('o rótulo vai junto, porque relatório exportado sem o mês não serve', () => {
    expect(periodoDoMes('2026-07').rotulo).toBe('Julho/2026')
    expect(rotuloDoMes('2026-03')).toBe('Março/2026')
  })
})

describe('periodoUltimosDias', () => {
  it('hoje conta como um dos dias: 7 dias são 6 para trás mais hoje', () => {
    const p = periodoUltimosDias(7)
    const dias = Math.round(
      (Date.parse(`${p.ate}T12:00:00Z`) - Date.parse(`${p.de}T12:00:00Z`)) / 86_400_000,
    )
    expect(dias).toBe(6)
  })
})

describe('periodoPersonalizado', () => {
  it('endireita o intervalo invertido em vez de devolver lista vazia', () => {
    expect(periodoPersonalizado('2026-08-31', '2026-08-01')).toMatchObject({
      de: '2026-08-01',
      ate: '2026-08-31',
    })
  })
})

describe('periodoAnterior', () => {
  it('devolve janela do MESMO tamanho, colada antes', () => {
    const anterior = periodoAnterior(periodoPersonalizado('2026-08-01', '2026-08-10'))
    expect(anterior).toMatchObject({ de: '2026-07-22', ate: '2026-07-31' })
  })
})

describe('periodoEmInstantes', () => {
  it('cobre o dia inteiro no fuso da clínica, não em UTC', () => {
    const { start, end } = periodoEmInstantes(periodoPersonalizado('2026-08-01', '2026-08-01'))
    // 00:00 de Maringá é 03:00 UTC. Usar UTC cru jogaria fora as 3 primeiras horas
    // do dia e perderia o que entrou de madrugada.
    expect(start.toISOString()).toBe('2026-08-01T03:00:00.000Z')
    expect(end.toISOString()).toBe('2026-08-02T02:59:59.000Z')
  })
})
