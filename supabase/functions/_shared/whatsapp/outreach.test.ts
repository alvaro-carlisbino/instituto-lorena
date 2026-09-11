// Quando a apresentação da Sofia pode sair. Rode com:
//   deno test --allow-env --allow-net supabase/functions/_shared/whatsapp/outreach.test.ts
//
// O que estes casos protegem: o pedido da clínica de 11/09/2026. Dentro do turno o primeiro
// contato é da equipe; a fila só fala no plantão da IA E dentro da janela da linha (8h às 20h,
// sem domingo). Se um destes testes ficar vermelho, ou a Sofia voltou a atropelar a Aline de
// dia, ou a fila passou a segurar lead para sempre.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { parseTeamHours } from '../teamHours.ts'
import { type PrimeiroContatoTurno, proximaAberturaDaSofia } from './outreach.ts'

// Turno da clínica desde 11/09/2026: segunda 07–18, terça a sexta 08–18, sábado 08–12.
const CLINICA: PrimeiroContatoTurno = {
  esperaEquipe: true,
  schedule: parseTeamHours({
    '1': [['07:00', '18:00']],
    '2': [['08:00', '18:00']],
    '3': [['08:00', '18:00']],
    '4': [['08:00', '18:00']],
    '5': [['08:00', '18:00']],
    '6': [['08:00', '12:00']],
  }),
}
const JANELA = { janelaInicio: 8, janelaFim: 20, permiteDomingo: false }

// A saída leva um empurrão aleatório de até 20 minutos, então o teste confere a faixa.
function naFaixa(d: Date, deIso: string, ateIso: string): boolean {
  return d.getTime() >= Date.parse(deIso) && d.getTime() <= Date.parse(ateIso)
}

Deno.test('formulário às 10h de terça espera o fim do turno: sai entre 18h e 18h20', () => {
  const r = proximaAberturaDaSofia(JANELA, CLINICA, new Date('2026-09-15T13:00:00Z'))
  assert(naFaixa(r, '2026-09-15T21:00:00Z', '2026-09-15T21:20:00Z'), r.toISOString())
})

Deno.test('polo sem a trava: o formulário das 10h sai na hora, como antes', () => {
  const agora = new Date('2026-09-15T13:00:00Z')
  const r = proximaAberturaDaSofia(JANELA, { ...CLINICA, esperaEquipe: false }, agora)
  assertEquals(r.getTime(), agora.getTime())
})

Deno.test('às 19h de terça o turno acabou e a linha está aberta: sai na hora', () => {
  const agora = new Date('2026-09-15T22:00:00Z')
  assertEquals(proximaAberturaDaSofia(JANELA, CLINICA, agora).getTime(), agora.getTime())
})

Deno.test('às 21h de terça a linha fechou e a manhã de quarta é da equipe: quarta 18h', () => {
  const r = proximaAberturaDaSofia(JANELA, CLINICA, new Date('2026-09-16T00:00:00Z'))
  assert(naFaixa(r, '2026-09-16T21:00:00Z', '2026-09-16T21:20:00Z'), r.toISOString())
})

Deno.test('sábado 9h: a equipe fica até o meio-dia, a Sofia sai entre 12h e 12h20', () => {
  const r = proximaAberturaDaSofia(JANELA, CLINICA, new Date('2026-09-19T12:00:00Z'))
  assert(naFaixa(r, '2026-09-19T15:00:00Z', '2026-09-19T15:20:00Z'), r.toISOString())
})

Deno.test('sábado 21h: domingo a linha não dispara e segunda (desde as 7h) é da equipe: segunda 18h', () => {
  const r = proximaAberturaDaSofia(JANELA, CLINICA, new Date('2026-09-20T00:00:00Z'))
  assert(naFaixa(r, '2026-09-21T21:00:00Z', '2026-09-21T21:20:00Z'), r.toISOString())
})
