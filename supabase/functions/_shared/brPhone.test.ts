import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { normalizeBrPhone, resolveWhatsappDestino } from './brPhone.ts'

/**
 * O que estes testes protegem: o telefone que a pessoa DIGITOU no formulário do anúncio é a
 * única porta de contato de um lead pago. Cada FORMATO aqui saiu de `leads.phone` em produção
 * (20/ago/2026, 88 leads inalcançáveis), mas os dígitos são sintéticos de propósito: este repo
 * é público e número de paciente não entra em commit.
 */

Deno.test('celular já correto passa intacto', () => {
  assertEquals(normalizeBrPhone('+5544900000001').phone, '5544900000001')
  assertEquals(normalizeBrPhone('5544900000001').ok, true)
})

Deno.test('devolve o 9º dígito do celular escrito com 8', () => {
  assertEquals(normalizeBrPhone('+554390000001').phone, '5543990000001')
  assertEquals(normalizeBrPhone('+556590000002').phone, '5565990000002')
  assertEquals(normalizeBrPhone('+554490000003').phone, '5544990000003')
})

Deno.test('tira o zero do DDD, antes e depois do DDI', () => {
  assertEquals(normalizeBrPhone('+55041900000004').phone, '5541900000004')
  assertEquals(normalizeBrPhone('+062900000005').phone, '5562900000005')
  assertEquals(normalizeBrPhone('(018) 90000-0006').phone, '5518900000006')
})

Deno.test('põe o DDI quando falta e aceita o que veio formatado', () => {
  assertEquals(normalizeBrPhone('46900000007').phone, '5546900000007')
  assertEquals(normalizeBrPhone('(41) 90000-0008').phone, '5541900000008')
  assertEquals(normalizeBrPhone('+55(41) 900000009').phone, '5541900000009')
})

Deno.test('DDD 55 com 11 dígitos é Santa Maria, não DDI sem DDD', () => {
  // A armadilha: 55900000010 parece "DDI + número". É DDD 55 + celular.
  assertEquals(normalizeBrPhone('+55900000010').phone, '5555900000010')
  assertEquals(normalizeBrPhone('5555900000010').phone, '5555900000010')
})

Deno.test('fixo continua com 8 dígitos, sem ganhar o 9', () => {
  assertEquals(normalizeBrPhone('554430000001').phone, '554430000001')
  assertEquals(normalizeBrPhone('4430000001').phone, '554430000001')
})

Deno.test('estrangeiro passa intacto, não vira brasileiro inventado', () => {
  // Oito leads reais de Portugal/França/EUA estavam sendo condenados, e dois já tinham
  // virado número brasileiro que não existe.
  const pt = normalizeBrPhone('+351900000001')
  assertEquals(pt.ok, true)
  assertEquals(pt.estrangeiro, true)
  assertEquals(pt.phone, '351900000001')

  assertEquals(normalizeBrPhone('+15550000002').phone, '15550000002')
  assertEquals(normalizeBrPhone('+33700000003').phone, '33700000003')
})

Deno.test('DDI só é consultado depois de a leitura brasileira falhar', () => {
  // +062900000005 é Goiânia com zero sobrando. Se o DDI viesse primeiro, viraria Indonésia.
  const goiania = normalizeBrPhone('+062900000005')
  assertEquals(goiania.phone, '5562900000005')
  assertEquals(goiania.estrangeiro, false)
  // Começa com 55: é tentativa de brasileiro torto, nunca estrangeiro.
  assertEquals(normalizeBrPhone('+555900000011').ok, false)
  assertEquals(normalizeBrPhone('+5553900000000000').estrangeiro, false)
})

Deno.test('o que não dá para salvar volta ok:false, nunca um número inventado', () => {
  const longo = normalizeBrPhone('+5553900000000000')
  assertEquals(longo.ok, false)
  assertEquals(longo.phone, '5553900000000000') // dígitos crus, rastreáveis

  assertEquals(normalizeBrPhone('+55449000000012').ok, false) // 10 dígitos depois do DDD
  assertEquals(normalizeBrPhone('+552090000001').ok, false)   // DDD 20 não existe
  assertEquals(normalizeBrPhone('15550000002').ok, false)     // sem `+`, não vale de estrangeiro
  assertEquals(normalizeBrPhone('').ok, false)
})

/**
 * Saída (`resolveWhatsappDestino`): para onde a mensagem VAI. Aqui o número quase sempre já
 * veio do próprio WhatsApp, então o `+` não existe — e era exatamente por exigir o `+` (e 12
 * dígitos) que a guarda de envio recusava toda conversa estrangeira. Os formatos abaixo saíram
 * de `leads.phone` em 08/set/2026; os dígitos são sintéticos porque este repo é público.
 */

Deno.test('saída: estrangeiro sem `+` sai como veio, e não é recusado', () => {
  const eua = resolveWhatsappDestino('15550100000')
  assertEquals(eua.ok, true)
  assertEquals(eua.estrangeiro, true)
  assertEquals(eua.phone, '15550100000')

  // Chile (56) e Polónia (48) não estavam na lista de DDIs da entrada — por isso a saída
  // não tem lista nenhuma: quem falha a leitura brasileira sai intacto.
  assertEquals(resolveWhatsappDestino('56900000001').phone, '56900000001')
  assertEquals(resolveWhatsappDestino('48700000002').phone, '48700000002')
  assertEquals(resolveWhatsappDestino('59890000003').phone, '59890000003')
})

Deno.test('saída: Brasil vem PRIMEIRO — 44 é Maringá, não o Reino Unido', () => {
  const maringa = resolveWhatsappDestino('44991000004')
  assertEquals(maringa.ok, true)
  assertEquals(maringa.estrangeiro, false)
  assertEquals(maringa.phone, '5544991000004')

  // Guardado com 10 dígitos (celular antigo, sem o 9º): ganha o 9 e o DDI.
  assertEquals(resolveWhatsappDestino('4491000005').phone, '5544991000005')
  // Já completo: não ganha nem perde nada.
  assertEquals(resolveWhatsappDestino('5544991000006').phone, '5544991000006')
})

Deno.test('saída: o sintético do ManyChat continua barrado', () => {
  const fake = resolveWhatsappDestino('8880011234567890')
  assertEquals(fake.ok, false)
  assertEquals(fake.phone.startsWith('888'), true)
})

Deno.test('saída: fora da faixa do E.164 não vira envio', () => {
  assertEquals(resolveWhatsappDestino('123456789').ok, false)        // 9 dígitos
  assertEquals(resolveWhatsappDestino('1234567890123456').ok, false) // 16, acima do E.164
  assertEquals(resolveWhatsappDestino('').ok, false)
})

Deno.test('saída: entre 10 e 15 dígitos, o que não é do Brasil sai como estrangeiro', () => {
  // Escolha consciente: aqui NÃO se adivinha. `4400000007` não é um brasileiro (o número
  // depois do DDD 44 começa com 0), então sai intacto e quem responde é a W-API. Inventar
  // dígito para "consertar" mandaria a mensagem para outra pessoa — pior do que um erro.
  const indefinido = resolveWhatsappDestino('4400000007')
  assertEquals(indefinido.ok, true)
  assertEquals(indefinido.estrangeiro, true)
  assertEquals(indefinido.phone, '4400000007')
})
