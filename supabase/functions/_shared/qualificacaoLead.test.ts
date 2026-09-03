import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { qualificar, resumoQualificacao, SEM_QUALIFICACAO } from './qualificacaoLead.ts'

Deno.test('a régua é a mesma do formulário: 4 semanas em Maringá é quente', () => {
  const q = qualificar({ prazo: '4semanas', cidade: 'maringa', avaliacao: 'pres_maringa' })
  assertEquals(q?.score, 90)
  assertEquals(q?.temperatura, 'hot')
  assertEquals(q?.foraDePraca, false)
})

Deno.test('resumo cabe no card: diz cidade, prazo e nota', () => {
  const q = qualificar({ prazo: '4semanas', cidade: 'maringa', avaliacao: 'pres_maringa' })!
  const r = resumoQualificacao(q)
  assertStringIncludes(r, 'QUENTE (90)')
  assertStringIncludes(r, 'Maringá')
  assertStringIncludes(r, 'quer nas próximas 4 semanas')
})

Deno.test('fora da praça vira aviso no resumo, não descarte', () => {
  const q = qualificar({ prazo: '4semanas', cidade: 'outro_estado', avaliacao: 'pres_maringa' })!
  assertEquals(q.foraDePraca, true)
  assertEquals(q.score, 70) // 90 menos 20
  assertStringIncludes(resumoQualificacao(q), 'fora da praça')
})

Deno.test('quem é de fora mas aceita online não é penalizado', () => {
  const q = qualificar({ prazo: '4semanas', cidade: 'outro_estado', avaliacao: 'online' })!
  assertEquals(q.foraDePraca, false)
  assertEquals(q.score, 90)
  assertStringIncludes(resumoQualificacao(q), 'aceita online')
})

Deno.test('só pesquisando não vira prioridade da Aline', () => {
  const q = qualificar({ prazo: 'pesquisando', cidade: 'maringa' })!
  assertEquals(q.score, 40)
  assertEquals(q.temperatura, 'warm')
  assertStringIncludes(resumoQualificacao(q), 'só pesquisando')
})

Deno.test('a conversa pode responder SÓ o prazo, sem cidade', () => {
  // Perguntar duas coisas e receber uma é o caso comum no WhatsApp. A regra é
  // seguir com o que veio: qualificação não pode virar pedágio.
  const q = qualificar({ prazo: '1a3meses' })
  assertEquals(q?.score, 75)
  assertEquals(q?.temperatura, 'hot')
})

Deno.test('prazo que a IA não conseguiu classificar não vira nota inventada', () => {
  assertEquals(qualificar({ prazo: 'semana que vem talvez', cidade: 'maringa' }), null)
  assertEquals(qualificar({ cidade: 'maringa' }), null)
})

Deno.test('sem qualificação nenhuma, o padrão continua morno', () => {
  assertEquals(SEM_QUALIFICACAO.temperatura, 'warm')
  assertEquals(SEM_QUALIFICACAO.score, 50)
})

// 03/09/2026: a pergunta passou a ser feita na saudação e a resposta mais comum
// é só a cidade. Sem prazo não há nota, mas a cidade não pode se perder.
import { qualificarParcial, resumoParcial } from './qualificacaoLead.ts'

Deno.test('só a cidade grava a cidade e avisa fora da praça, sem inventar nota', () => {
  const p = qualificarParcial({ cidade: 'outro_estado' })!
  assertEquals(p.foraDePraca, true)
  const r = resumoParcial(p)
  assertStringIncludes(r, 'outro estado')
  assertStringIncludes(r, 'prazo não informado')
  assertStringIncludes(r, 'fora da praça')
})

Deno.test('só a cidade, de Maringá, não é fora da praça', () => {
  const p = qualificarParcial({ cidade: 'maringa' })!
  assertEquals(p.foraDePraca, false)
  assertStringIncludes(resumoParcial(p), 'Maringá')
})

Deno.test('cidade fora da lista não vira qualificação parcial', () => {
  assertEquals(qualificarParcial({ cidade: 'sao_paulo' }), null)
  assertEquals(qualificarParcial({}), null)
})
