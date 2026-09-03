import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { escolheLeadPeloFone } from './crm.ts'

// Caso Daniele 31/08/2026: lead da clínica (julho, sem o 9º dígito) e lead da loja (mesmo dia,
// número exato). O mais antigo ganhava; agora o número exato ganha.
Deno.test('número exato vence o palpite do 9º dígito, mesmo sendo mais novo', () => {
  const rows = [
    { id: 'lead-clinica', phone: '554396827443', created_at: '2026-07-08T13:54:56Z' },
    { id: 'lead-loja', phone: '5543996827443', created_at: '2026-08-31T16:00:33Z' },
  ]
  assertEquals(escolheLeadPeloFone(rows, '5543996827443'), 'lead-loja')
})

Deno.test('±55 conta como exato', () => {
  const rows = [
    { id: 'lead-sem-9', phone: '554396827443', created_at: '2026-07-08T13:54:56Z' },
    { id: 'lead-sem-55', phone: '43996827443', created_at: '2026-08-31T16:00:33Z' },
  ]
  assertEquals(escolheLeadPeloFone(rows, '5543996827443'), 'lead-sem-55')
})

Deno.test('entre exatos, o mais antigo continua ganhando', () => {
  const rows = [
    { id: 'novo', phone: '5543996827443', created_at: '2026-08-31T16:00:33Z' },
    { id: 'velho', phone: '5543996827443', created_at: '2026-07-08T13:54:56Z' },
  ]
  assertEquals(escolheLeadPeloFone(rows, '5543996827443'), 'velho')
})

Deno.test('só palpite: o mais antigo ganha, como antes', () => {
  const rows = [
    { id: 'b', phone: '554396827443', created_at: '2026-08-01T00:00:00Z' },
    { id: 'a', phone: '554396827443', created_at: '2026-07-01T00:00:00Z' },
  ]
  assertEquals(escolheLeadPeloFone(rows, '5543996827443'), 'a')
})

Deno.test('lista vazia', () => {
  assertEquals(escolheLeadPeloFone([], '5543996827443'), null)
  assertEquals(escolheLeadPeloFone(null, '5543996827443'), null)
})
