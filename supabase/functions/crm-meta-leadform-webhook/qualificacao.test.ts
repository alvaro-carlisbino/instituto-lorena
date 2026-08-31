import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { SEM_QUALIFICACAO, qualificar } from './qualificacao.ts'

Deno.test('quem quer começar em 4 semanas sobe para quente', () => {
  const q = qualificar({ prazo: '4semanas', cidade: 'maringa', avaliacao: 'pres_maringa' })
  assertEquals(q?.nivel, 'QUENTE')
  assertEquals(q?.score, 90)
  assertEquals(q?.temperatura, 'hot')
  assertEquals(q?.foraDePraca, false)
})

Deno.test('quem só está pesquisando não vira prioridade', () => {
  const q = qualificar({ prazo: 'pesquisando', cidade: 'londrina', avaliacao: 'pres_londrina' })
  assertEquals(q?.nivel, 'FRIO')
  assertEquals(q?.score, 40)
})

Deno.test('outro estado sem querer online é fora de praça e perde 20 pontos', () => {
  const q = qualificar({ prazo: '4semanas', cidade: 'outro_estado', avaliacao: 'pres_maringa' })
  assertEquals(q?.foraDePraca, true)
  assertEquals(q?.score, 70)
})

Deno.test('outro estado que aceita online continua valendo o prazo cheio', () => {
  const q = qualificar({ prazo: '4semanas', cidade: 'outro_estado', avaliacao: 'online' })
  assertEquals(q?.foraDePraca, false)
  assertEquals(q?.score, 90)
})

Deno.test('formulário antigo, sem as perguntas, não é qualificado nem rebaixado', () => {
  assertEquals(qualificar({ full_name: 'Fulano', email: 'a@b.c' }), null)
})

Deno.test('resposta desconhecida não derruba o lead', () => {
  assertEquals(qualificar({ prazo: 'valor_que_nao_existe' }), null)
})

Deno.test('sem qualificação o lead entra morno, nunca quente', () => {
  // O padrão era 'hot' com 70, e era ele que enchia a fila: 786 de 865 leads de
  // formulário nasciam quentes sem responder nada, e agendavam 2,6%.
  assertEquals(SEM_QUALIFICACAO.temperatura, 'warm')
  assertEquals(SEM_QUALIFICACAO.score, 50)
})

Deno.test('quem respondeu continua podendo ser quente, que é o ponto', () => {
  const q = qualificar({ prazo: '4semanas', cidade: 'maringa', avaliacao: 'pres_maringa' })
  assertEquals(q?.temperatura, 'hot')
  // E o quente respondido vale mais que o morno padrão, senão qualificar não muda nada.
  assertEquals((q?.score ?? 0) > SEM_QUALIFICACAO.score, true)
})
