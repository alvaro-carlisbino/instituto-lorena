import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  answersQualification,
  buildInitialTriageMessage,
  buildTriageOptionAckMessage,
  inferTriageOptionFromText,
} from './crmAiAutoReply.ts'

// 03/09/2026: cidade e prazo saem do Passo 2b (que alcançava 14% dos leads) e
// entram na saudação, a única mensagem da Sofia que a maioria recebe.

Deno.test('a saudação termina perguntando cidade e prazo', () => {
  const m = buildInitialTriageMessage('Carlos Eduardo')
  assertStringIncludes(m, 'Olá, Carlos!')
  assertStringIncludes(m, '5️⃣ Transplante de Sobrancelha')
  assertStringIncludes(m, 'de Maringá, de Londrina ou de outra cidade')
  assertStringIncludes(m, 'ainda tá pesquisando')
})

Deno.test('o eco da opção DIRECIONA o médico e não pergunta qual', () => {
  const lorena = buildTriageOptionAckMessage('Ana', '1', false)
  assertStringIncludes(lorena, 'Dra. Lorena Visentainer')
  assert(!lorena.includes('Com qual profissional'), 'a pergunta proibida voltou')
  assert(!lorena.includes('Dr. Matheus'), 'não lista os três médicos')
  assertStringIncludes(lorena, 'de Maringá, de Londrina ou de outra cidade')

  assertStringIncludes(buildTriageOptionAckMessage('Ana', '2', false), 'Dra. Lorena Visentainer')
  assertStringIncludes(buildTriageOptionAckMessage('Ana', '5', false), 'Dra. Lorena Visentainer')
  assertStringIncludes(buildTriageOptionAckMessage('Ana', '3', false), 'Dr. Matheus Amaral')
  assertStringIncludes(buildTriageOptionAckMessage('Ana', '4', false), 'Dra. Jaqueline Augusto')
})

Deno.test('o eco com intro se apresenta como Sofia uma vez só', () => {
  const m = buildTriageOptionAckMessage('Ana', '1', true)
  assertEquals(m.split('Sofia').length - 1, 1)
  assertStringIncludes(m, 'Seja muito bem-vindo(a)')
})

Deno.test('opção sozinha não conta como resposta de cidade/prazo', () => {
  for (const t of ['1', 'opção 2', 'Transplante Capilar Masculino', '5\n', 'quero a 3']) {
    assertEquals(answersQualification(t), false, t)
  }
})

Deno.test('opção junto com cidade ou prazo vai para a IA, não para o eco', () => {
  for (const t of [
    '1, sou de Maringá',
    '2 quero fazer esse mês',
    'Sou de Curitiba, opção 1',
    '1. moro em Londrina e tô pesquisando ainda',
    '3, sou de outra cidade',
  ]) {
    assertEquals(answersQualification(t), true, t)
  }
})

Deno.test('dígito com pontuação no começo ainda é a opção do menu (o lead muda de etapa)', () => {
  assertEquals(inferTriageOptionFromText('1, sou de Maringá'), '1')
  assertEquals(inferTriageOptionFromText('3. moro em Londrina'), '3')
  assertEquals(inferTriageOptionFromText('5 - quero fazer esse mês'), '5')
  assertEquals(inferTriageOptionFromText('Sou de Curitiba, opção 1'), '1')
  // Sem pontuação o dígito é ambíguo ("5 anos de queda" não é sobrancelha).
  assertEquals(inferTriageOptionFromText('5 anos de queda de cabelo'), null)
})
