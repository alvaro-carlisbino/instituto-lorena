import { describe, expect, it } from 'vitest'
import type { Interaction } from '@/mocks/crmMock'
import { isAiReplyLikelyPending, teamHoursGateFromAiConfig } from './aiTypingIndicator'

// Segunda 14/09/2026, 10:00 em Maringá (13:00 UTC): dentro do turno da clínica.
const NO_TURNO = new Date('2026-09-14T13:00:00Z')
// A mesma segunda, 21:00 em Maringá (00:00 UTC de terça): fora do turno.
const FORA_DO_TURNO = new Date('2026-09-15T00:00:00Z')

function entradaDoPaciente(agora: Date): Interaction {
  return {
    id: 'i1',
    leadId: 'l1',
    patientName: 'Paciente',
    channel: 'whatsapp',
    direction: 'in',
    author: 'Paciente',
    content: 'Oi, quero saber da consulta',
    happenedAt: new Date(agora.getTime() - 5_000).toISOString(),
  } as Interaction
}

const TURNO_CLINICA = { ai_offhours_only: true, ai_team_hours: { '1': [['07:00', '18:00']] } }

function gate(cfg: Parameters<typeof teamHoursGateFromAiConfig>[0]) {
  return { ownerMode: 'auto' as const, aiEnabled: true, ...teamHoursGateFromAiConfig(cfg) }
}

describe('isAiReplyLikelyPending com o turno da equipe', () => {
  it('regra de 31/08: lead novo no turno, a Sofia responde e o indicador aparece', () => {
    expect(
      isAiReplyLikelyPending({ history: [entradaDoPaciente(NO_TURNO)], gate: gate(TURNO_CLINICA), now: NO_TURNO }),
    ).toBe(true)
  })

  it('clínica desde 11/09: lead novo no turno fica com a equipe e o indicador não aparece', () => {
    const g = gate({ ...TURNO_CLINICA, ai_first_touch_in_team_hours: false })
    expect(isAiReplyLikelyPending({ history: [entradaDoPaciente(NO_TURNO)], gate: g, now: NO_TURNO })).toBe(false)
  })

  it('clínica desde 11/09: fora do turno a IA é plantonista e o indicador aparece', () => {
    const g = gate({ ...TURNO_CLINICA, ai_first_touch_in_team_hours: false })
    expect(
      isAiReplyLikelyPending({ history: [entradaDoPaciente(FORA_DO_TURNO)], gate: g, now: FORA_DO_TURNO }),
    ).toBe(true)
  })
})
