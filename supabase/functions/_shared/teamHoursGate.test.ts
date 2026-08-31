import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { DEFAULT_TEAM_HOURS, deveCalarPeloTurno, parseTeamHours } from './teamHours.ts'

// Turno real da clínica: seg–sex 08–18, sáb 08–12, domingo é da IA.
const CLINICA = parseTeamHours({
  '1': [['08:00', '18:00']],
  '2': [['08:00', '18:00']],
  '3': [['08:00', '18:00']],
  '4': [['08:00', '18:00']],
  '5': [['08:00', '18:00']],
  '6': [['08:00', '12:00']],
})

// Segunda-feira, 31/08/2026, 10:50 em Maringá (13:50 UTC): dentro do turno.
const segundaDeManha = new Date('2026-08-31T13:50:00Z')
// Segunda-feira, 22:30 em Maringá (01:30 UTC de terça): fora do turno.
const segundaANoite = new Date('2026-09-01T01:30:00Z')

Deno.test('lead novo é atendido pela IA mesmo no horário da equipe', () => {
  // É o ponto da mudança de 31/08: 54% dos leads chegam nesta faixa e chegavam
  // crus na atendente, sem triagem nem qualificação.
  assertEquals(
    deveCalarPeloTurno({ offHoursOnly: true, humanoJaFalou: false, agora: segundaDeManha, schedule: CLINICA }),
    false,
  )
})

Deno.test('depois que a equipe fala, a IA cala no turno e a sequência é da Aline', () => {
  assertEquals(
    deveCalarPeloTurno({ offHoursOnly: true, humanoJaFalou: true, agora: segundaDeManha, schedule: CLINICA }),
    true,
  )
})

Deno.test('fora do turno a IA responde mesmo com humano já tendo falado', () => {
  assertEquals(
    deveCalarPeloTurno({ offHoursOnly: true, humanoJaFalou: true, agora: segundaANoite, schedule: CLINICA }),
    false,
  )
})

Deno.test('sem a trava ligada (Tricopill roda 24h) nada disso se aplica', () => {
  assertEquals(
    deveCalarPeloTurno({ offHoursOnly: false, humanoJaFalou: true, agora: segundaDeManha, schedule: CLINICA }),
    false,
  )
})

Deno.test('domingo é da IA, mesmo com humano já tendo falado', () => {
  // Domingo, 30/08/2026, 10:00 em Maringá. A escala não tem entrada para o dia 0.
  const domingo = new Date('2026-08-30T13:00:00Z')
  assertEquals(
    deveCalarPeloTurno({ offHoursOnly: true, humanoJaFalou: true, agora: domingo, schedule: CLINICA }),
    false,
  )
})

Deno.test('a escala padrão continua valendo para quem não configurou', () => {
  assertEquals(
    deveCalarPeloTurno({ offHoursOnly: true, humanoJaFalou: true, agora: segundaDeManha, schedule: DEFAULT_TEAM_HOURS }),
    true,
  )
})
