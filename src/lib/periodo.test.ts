import { describe, expect, it } from 'vitest'

import {
  mesAtual,
  mesComOffset,
  periodoAnterior,
  periodoDoMes,
  periodoEmInstantes,
  periodoPersonalizado,
  periodoUltimosDias,
  rotuloDoMes,
} from './periodo'

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
