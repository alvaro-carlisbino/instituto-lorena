import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { juntarPixNaResposta, separarPixDaResposta } from './pixCopiaECola.ts'

// Payload real do caso Eloísa (16/09/2026).
const CODIGO =
  '00020101021226770014BR.GOV.BCB.PIX2555api.itau/pix/qr/v2/6c3591d2-7cfd-4615-a411-1350fb42622a5204000053039865802BR5913HB COSMETICOS6007MARINGA62070503***6304341A'

Deno.test('código sai do texto e vai sozinho', () => {
  const resposta = juntarPixNaResposta('Claro, Eloísa. Segue o Pix de R$ 582,15:', CODIGO)
  const out = separarPixDaResposta(resposta, CODIGO)
  assert(out)
  assertEquals(out.codigo, CODIGO)
  assert(!out.texto.includes(CODIGO))
  assert(!out.texto.includes('000201'))
  assert(out.texto.startsWith('Claro, Eloísa.'))
  assert(out.texto.includes('mensagem logo abaixo'))
  assert(out.texto.endsWith('Assim que o pagamento cair eu confirmo aqui, viu? 💚'))
  assert(!out.texto.includes('\n\n\n'))
})

Deno.test('nota do op continua no texto', () => {
  const resposta = juntarPixNaResposta('Perfeito!', CODIGO, '📍 Retirada na clínica, Av. Nóbrega, 814.')
  const out = separarPixDaResposta(resposta, CODIGO)
  assert(out)
  assert(out.texto.includes('📍 Retirada na clínica'))
  assert(!out.texto.includes(CODIGO))
})

Deno.test('código fora do rótulo padrão também sai', () => {
  const out = separarPixDaResposta(`Segue: ${CODIGO}\nObrigada!`, CODIGO)
  assert(out)
  assert(!out.texto.includes(CODIGO))
  assert(out.texto.includes('Obrigada!'))
})

Deno.test('sem o código no texto, não mexe', () => {
  assertEquals(separarPixDaResposta('Oi, tudo bem?', CODIGO), null)
  assertEquals(separarPixDaResposta('Oi', ''), null)
})

Deno.test('sem travessão no texto do cliente', () => {
  const out = separarPixDaResposta(juntarPixNaResposta('Oi', CODIGO), CODIGO)
  assert(out)
  assert(!out.texto.includes('—'))
  assert(!juntarPixNaResposta('Oi', CODIGO).includes('—'))
})
