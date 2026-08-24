import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TEAM_HOURS,
  describeTeamHours,
  isWithinTeamHours,
  parseTeamHours,
  serializeTeamHours,
} from './teamHours'

/**
 * A tabela-verdade da trava "IA só fora do horário da equipe". A mesma regra está em
 * `supabase/functions/_shared/teamHours.ts`, que é quem decide de verdade; este ficheiro
 * é o único sítio onde ela é testada, por isso cobre também os casos de fronteira do fuso.
 *
 * Datas em UTC de propósito: a Edge corre em UTC e Maringá é UTC−3 — 11:00Z é 08:00 local.
 */
const utc = (iso: string) => new Date(iso)

describe('isWithinTeamHours (seg–sex 08–18, sáb 08–12)', () => {
  it('segunda antes das 8h: a equipe ainda não chegou, a IA atende', () => {
    expect(isWithinTeamHours(utc('2026-08-24T10:59:00Z'))).toBe(false) // 07:59 em SP
  })

  it('segunda às 8h em ponto: começa o turno da equipe', () => {
    expect(isWithinTeamHours(utc('2026-08-24T11:00:00Z'))).toBe(true) // 08:00 em SP
  })

  it('segunda 17:59 ainda é da equipe; 18:00 já é da IA (fim exclusivo)', () => {
    expect(isWithinTeamHours(utc('2026-08-24T20:59:00Z'))).toBe(true) // 17:59
    expect(isWithinTeamHours(utc('2026-08-24T21:00:00Z'))).toBe(false) // 18:00
  })

  it('madrugada de terça é da IA', () => {
    expect(isWithinTeamHours(utc('2026-08-25T06:00:00Z'))).toBe(false) // 03:00
  })

  it('sábado fecha ao meio-dia', () => {
    expect(isWithinTeamHours(utc('2026-08-29T14:59:00Z'))).toBe(true) // 11:59
    expect(isWithinTeamHours(utc('2026-08-29T15:00:00Z'))).toBe(false) // 12:00
    expect(isWithinTeamHours(utc('2026-08-29T21:00:00Z'))).toBe(false) // 18:00
  })

  it('domingo inteiro é da IA', () => {
    expect(isWithinTeamHours(utc('2026-08-30T13:00:00Z'))).toBe(false) // 10:00
    expect(isWithinTeamHours(utc('2026-08-30T18:00:00Z'))).toBe(false) // 15:00
  })

  it('fuso ilegível não pode calar a IA: devolve "equipe ausente"', () => {
    expect(isWithinTeamHours(utc('2026-08-24T13:00:00Z'), DEFAULT_TEAM_HOURS, 'Nao/Existe')).toBe(false)
  })
})

describe('parseTeamHours', () => {
  it('lê o formato gravado no jsonb', () => {
    const s = parseTeamHours({ '1': [['09:00', '13:00']], '6': [['08:00', '12:00']] })
    expect(isWithinTeamHours(utc('2026-08-24T13:00:00Z'), s)).toBe(true) // seg 10:00
    expect(isWithinTeamHours(utc('2026-08-24T17:00:00Z'), s)).toBe(false) // seg 14:00
  })

  it('aceita a forma curta ["08:00","18:00"] escrita à mão', () => {
    const s = parseTeamHours({ '1': ['08:00', '18:00'] })
    expect(s[1]).toEqual([[480, 1080]])
  })

  it('aceita mais de um intervalo por dia (buraco de almoço)', () => {
    const s = parseTeamHours({ '1': [['08:00', '12:00'], ['13:30', '18:00']] })
    expect(isWithinTeamHours(utc('2026-08-24T15:30:00Z'), s)).toBe(false) // 12:30, almoço
    expect(isWithinTeamHours(utc('2026-08-24T17:00:00Z'), s)).toBe(true) // 14:00
  })

  it('config torta cai no padrão em vez de deixar a grade vazia', () => {
    expect(parseTeamHours(null)).toBe(DEFAULT_TEAM_HOURS)
    expect(parseTeamHours('seg a sex')).toBe(DEFAULT_TEAM_HOURS)
    expect(parseTeamHours({ '9': [['08:00', '18:00']] })).toBe(DEFAULT_TEAM_HOURS)
  })

  it('descarta intervalo invertido (fim <= início), que calaria a IA sem querer', () => {
    const s = parseTeamHours({ '1': [['18:00', '08:00']], '2': [['08:00', '18:00']] })
    expect(s[1]).toBeUndefined()
    expect(isWithinTeamHours(utc('2026-08-24T13:00:00Z'), s)).toBe(false) // segunda: ninguém
  })
})

describe('serializeTeamHours', () => {
  it('faz a volta sem perder nada', () => {
    expect(serializeTeamHours(DEFAULT_TEAM_HOURS)).toEqual({
      '1': [['08:00', '18:00']],
      '2': [['08:00', '18:00']],
      '3': [['08:00', '18:00']],
      '4': [['08:00', '18:00']],
      '5': [['08:00', '18:00']],
      '6': [['08:00', '12:00']],
    })
    expect(parseTeamHours(serializeTeamHours(DEFAULT_TEAM_HOURS))).toEqual(DEFAULT_TEAM_HOURS)
  })
})

describe('describeTeamHours', () => {
  it('descreve a grade para o texto do painel', () => {
    expect(describeTeamHours(DEFAULT_TEAM_HOURS)).toContain('segunda 08:00–18:00')
    expect(describeTeamHours(DEFAULT_TEAM_HOURS)).toContain('sábado 08:00–12:00')
    expect(describeTeamHours(DEFAULT_TEAM_HOURS)).not.toContain('domingo')
  })
})
