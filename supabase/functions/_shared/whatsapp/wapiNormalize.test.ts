// Normalização do webhook da W-API. Rode com:
//   deno test --allow-env supabase/functions/_shared/whatsapp/wapiNormalize.test.ts
//
// O caso que originou o teste: em 23/ago/26 descobrimos que tudo que a equipe manda pelo
// celular ou pelo WhatsApp Web era invisível no CRM. O ramo que grava essa saída existia
// desde sempre e nunca tinha disparado, então nunca tinha sido exercitado — e escondia um
// erro: em mensagem NOSSA (`fromme`), `sender` é a própria clínica. Gravar por ali criaria
// um lead com o número do próprio consultório e carimbaria a resposta na conversa errada.
// Quem identifica o outro lado nesse caso é o `chat`.
//
// Os dois primeiros testes são a rede de segurança do que já funcionava: a entrada é o
// caminho quente das duas linhas em produção e não pode mudar de comportamento.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { WapiProvider } from './wapi.ts'

const provider = new WapiProvider({
  baseUrl: '',
  token: 'tok',
  instanceId: 'LITE-FAKE',
  webhookSecret: '',
})

const headers = new Headers()
const CLINICA = '554491493656'
const PACIENTE = '554499887766'

/** Payload no formato real da W-API (chaves minúsculas e flat). */
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: 'webhookReceived',
    instanceid: 'LITE-FAKE',
    messageid: 'MSG-1',
    fromme: false,
    isgroup: false,
    sender: { id: `${PACIENTE}@c.us`, pushname: 'Joana' },
    chat: { id: `${PACIENTE}@c.us` },
    moment: 1_756_000_000,
    msgcontent: { conversation: 'oi, queria saber o valor' },
    ...over,
  }
}

Deno.test('entrada: segue o sender e preserva o nome de quem escreveu', () => {
  const n = provider.normalizeInbound(payload(), headers)
  assertEquals(n?.direction, 'in')
  assertEquals(n?.fromPhone, PACIENTE)
  assertEquals(n?.fromName, 'Joana')
  assertEquals(n?.text, 'oi, queria saber o valor')
})

Deno.test('entrada sem pushname: cai no placeholder, não quebra', () => {
  const n = provider.normalizeInbound(payload({ sender: { id: `${PACIENTE}@c.us` } }), headers)
  assertEquals(n?.direction, 'in')
  assertEquals(n?.fromPhone, PACIENTE)
  assertEquals(n?.fromName, 'Contato WhatsApp')
})

Deno.test('saída da equipe: usa o chat, nunca o número da própria clínica', () => {
  const n = provider.normalizeInbound(
    payload({
      fromme: true,
      sender: { id: `${CLINICA}@c.us`, pushname: 'Instituto Lorena' },
      chat: { id: `${PACIENTE}@c.us` },
      msgcontent: { conversation: 'oi Joana, a consulta custa...' },
    }),
    headers,
  )
  assertEquals(n?.direction, 'out')
  assertEquals(n?.fromPhone, PACIENTE)
  // O pushname aqui é o da clínica: usá-lo renomearia a paciente.
  assertEquals(n?.fromName, 'Contato WhatsApp')
})

Deno.test('saída da equipe sem chat: cai no sender em vez de perder a mensagem', () => {
  const p = payload({ fromme: true, sender: { id: `${PACIENTE}@c.us` }, msgcontent: { conversation: 'ok' } })
  delete p.chat
  const n = provider.normalizeInbound(p, headers)
  assertEquals(n?.direction, 'out')
  assertEquals(n?.fromPhone, PACIENTE)
})

Deno.test('grupo não vira atendimento, nas duas direções', () => {
  const entrada = provider.normalizeInbound(
    payload({ isgroup: true, chat: { id: '120363000000000000@g.us' } }),
    headers,
  )
  assertEquals(entrada, null)

  const saida = provider.normalizeInbound(
    payload({ fromme: true, isgroup: true, chat: { id: '120363000000000000@g.us' } }),
    headers,
  )
  assertEquals(saida, null)
})

Deno.test('recibo de entrega não vira mensagem: sem isso, ACK viraria lead', () => {
  const ack = {
    event: 'webhookDelivery',
    instanceid: 'LITE-FAKE',
    messageid: 'MSG-1',
    fromme: true,
    status: 'delivered',
    sender: { id: `${CLINICA}@c.us` },
    chat: { id: `${PACIENTE}@c.us` },
  }
  assertEquals(provider.normalizeInbound(ack, headers), null)
})

Deno.test('saída só com mídia: marcador entra, mensagem não se perde', () => {
  const n = provider.normalizeInbound(
    payload({ fromme: true, sender: { id: `${CLINICA}@c.us` }, msgcontent: { imageMessage: {} } }),
    headers,
  )
  assertEquals(n?.direction, 'out')
  assertEquals(n?.fromPhone, PACIENTE)
  assertEquals(n?.text, '📷 Imagem')
})
