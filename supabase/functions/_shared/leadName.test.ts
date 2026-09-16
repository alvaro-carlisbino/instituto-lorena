import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { applyLeadName, firstNameOrEmpty } from './leadName.ts'

Deno.test('e-mail no lugar do nome não vira vocativo (caso de 16/09/2026)', () => {
  assertEquals(firstNameOrEmpty('Osvaldodonizetebarbosa@gm'), '')
  assertEquals(firstNameOrEmpty('joao.silva@gmail.com'), '')
  assertEquals(
    applyLeadName('Boa tarde, {nome}!\n\nFicou alguma dúvida?', 'Osvaldodonizetebarbosa@gm', 'nome'),
    'Boa tarde!\n\nFicou alguma dúvida?',
  )
})

Deno.test('número, ponto e sublinhado no meio do nome também não passam', () => {
  // Na ponta é sujeira do perfil e sai no corte; no meio, não é nome.
  assertEquals(firstNameOrEmpty('Maria2024'), 'Maria')
  assertEquals(firstNameOrEmpty('jo4o'), '')
  assertEquals(firstNameOrEmpty('ana_paula'), '')
  assertEquals(firstNameOrEmpty('dr.carlos'), '')
})

Deno.test('nome de gente continua saindo, inclusive com acento, hífen e apóstrofo', () => {
  assertEquals(firstNameOrEmpty('MARIA DAS GRAÇAS'), 'Maria')
  assertEquals(firstNameOrEmpty('neusabarbosa'), 'Neusabarbosa')
  assertEquals(firstNameOrEmpty('Ana-Clara Souza'), 'Ana-Clara')
  assertEquals(firstNameOrEmpty("D'Ávila"), "D'Ávila")
  assertEquals(firstNameOrEmpty('Leda💃🏽'), 'Leda')
  assertEquals(firstNameOrEmpty('Contato WhatsApp'), '')
})
