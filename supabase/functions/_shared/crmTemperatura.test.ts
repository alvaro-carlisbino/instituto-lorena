import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { proximaTemperatura } from './crm.ts'

/**
 * O que estes testes protegem: a temperatura é o que faz a equipe escolher para quem
 * ligar primeiro na segunda de manhã. O caso que motivou a guarda saiu de produção
 * (29/ago/2026): lead da landing /consulta com "quero resolver ESTE MÊS", score 75 de
 * 77 possíveis, gravado QUENTE pelo `crm-agendar-publico` e rebaixado para morno vinte
 * segundos depois, quando respondeu "Ok" no WhatsApp e o webhook de entrada reescreveu
 * o lead sem override, caindo no padrão `warm` do canal.
 */

Deno.test('o padrão do canal não esfria quem a triagem marcou como quente', () => {
  // O webhook do WhatsApp deriva 'warm' e não manda override.
  assertEquals(proximaTemperatura('hot', 'warm', undefined), null)
})

Deno.test('o padrão do canal esquenta quem estava frio', () => {
  // Lead frio que começa a falar no WhatsApp vira morno. Isto é desejado.
  assertEquals(proximaTemperatura('cold', 'warm', undefined), 'warm')
  assertEquals(proximaTemperatura('warm', 'hot', undefined), 'hot')
})

Deno.test('temperatura igual não vira escrita', () => {
  assertEquals(proximaTemperatura('warm', 'warm', undefined), null)
  assertEquals(proximaTemperatura('hot', 'hot', undefined), null)
})

Deno.test('override explícito manda, inclusive para esfriar', () => {
  // Quem manda override é a triagem da landing ou uma pessoa: as duas estão decidindo.
  assertEquals(proximaTemperatura('hot', 'cold', 'cold'), 'cold')
  assertEquals(proximaTemperatura('cold', 'hot', 'hot'), 'hot')
})

Deno.test('lead sem temperatura válida recebe a derivada', () => {
  for (const vazio of [null, undefined, '', 'quente', 0, {}]) {
    assertEquals(proximaTemperatura(vazio, 'warm', undefined), 'warm')
  }
})
