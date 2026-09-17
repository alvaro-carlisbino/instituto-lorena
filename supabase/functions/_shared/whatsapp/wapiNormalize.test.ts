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
import {
  ehEnvioPelaApi,
  extractContactProfilePicture,
  extractInboundEdit,
  extractInboundRevoke,
  extractMessageStatus,
  WapiProvider,
} from './wapi.ts'

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

// ── Edição vinda de fora (26/ago/26) ─────────────────────────────────────────
// A pessoa corrige a própria mensagem no telemóvel e o CRM continuava a mostrar a frase
// antiga: o evento não tem texto no sítio do costume, `normalizeInbound` devolvia null e
// ele morria no "event skipped". Quem responde lê o texto errado sem saber que é errado.
// O embrulho muda conforme quem serializa, por isso o extrator aceita mais de um formato.

Deno.test('edição: protocolMessage direto no msgContent', () => {
  const evento = {
    msgContent: {
      protocolMessage: {
        key: { id: 'ALVO123' },
        type: 'MESSAGE_EDIT',
        editedMessage: { conversation: 'por pombo correio' },
      },
    },
  }
  assertEquals(extractInboundEdit(evento), { targetMessageId: 'ALVO123', text: 'por pombo correio' })
})

Deno.test('edição: embrulhada em editedMessage.message', () => {
  const evento = {
    msgcontent: {
      editedMessage: {
        message: {
          protocolMessage: {
            key: { id: 'ALVO456' },
            type: 14,
            editedMessage: { message: { conversation: 'texto corrigido' } },
          },
        },
      },
    },
  }
  assertEquals(extractInboundEdit(evento), { targetMessageId: 'ALVO456', text: 'texto corrigido' })
})

Deno.test('edição: texto longo chega por extendedTextMessage', () => {
  const evento = {
    msgContent: {
      protocolMessage: {
        key: { id: 'ALVO789' },
        editedMessage: { extendedTextMessage: { text: 'agora com link https://a.b' } },
      },
    },
  }
  assertEquals(extractInboundEdit(evento), {
    targetMessageId: 'ALVO789',
    text: 'agora com link https://a.b',
  })
})

Deno.test('apagar para todos não é confundido com edição', () => {
  const revoke = {
    msgContent: { protocolMessage: { key: { id: 'ALVO000' }, type: 'REVOKE' } },
  }
  assertEquals(extractInboundEdit(revoke), null)
  assertEquals(extractInboundRevoke(revoke), { targetMessageId: 'ALVO000' })
})

Deno.test('mensagem normal não vira edição', () => {
  assertEquals(extractInboundEdit(payload({ msgContent: { conversation: 'oi' } })), null)
})

/**
 * STATUS e `@lid`, descobertos em 08/set/2026 lendo payload de verdade no log da linha da
 * clínica. Os dois vinham com `isGroup:false` e passavam direto pelo caminho de mensagem.
 */

Deno.test('status não é mensagem: story de contato não vira lead nem acorda a IA', () => {
  // Payload REAL (dígitos trocados): quem publica um story cai aqui com chat.id "status".
  // Enquanto isto passou, a "Aline Comercial" virou lead com 29 mensagens que eram os
  // stories da própria clínica, e a Sofia respondeu story de gente com as boas-vindas.
  const status = provider.normalizeInbound(
    payload({ chat: { id: 'status' }, msgcontent: { conversation: 'Olha como foi o dia da sua cirurgia!' } }),
    headers,
  )
  assertEquals(status, null)

  const broadcast = provider.normalizeInbound(
    payload({ chat: { id: 'status@broadcast' }, msgcontent: { conversation: 'Parte 2' } }),
    headers,
  )
  assertEquals(broadcast, null)

  // Canal (newsletter) também não é conversa com ninguém.
  assertEquals(
    provider.normalizeInbound(payload({ chat: { id: '120363000000000000@newsletter' } }), headers),
    null,
  )
})

Deno.test('lid vem SEPARADO do telefone quando o payload traz os dois', () => {
  // É este par, presente na mensagem normal, que monta o índice lid↔telefone de graça.
  const n = provider.normalizeInbound(
    payload({ sender: { id: `${PACIENTE}@c.us`, senderLid: '78159932330227@lid', pushname: 'Joana' } }),
    headers,
  )
  assertEquals(n?.fromPhone, PACIENTE)
  assertEquals(n?.fromLid, '78159932330227')
  assertEquals(n?.fromIsLid, false)
})

Deno.test('lid sozinho vira a chave da conversa, mas carimbado como lid', () => {
  // Sem telefone no payload, o lid é o único jeito de falar com a pessoa — e enviar para
  // ele FUNCIONA. O que não pode é o CRM chamar aquilo de telefone.
  const n = provider.normalizeInbound(
    payload({ sender: { id: '78159932330227@lid', senderLid: '78159932330227@lid', pushname: 'Joana' } }),
    headers,
  )
  assertEquals(n?.fromPhone, '78159932330227')
  assertEquals(n?.fromLid, '78159932330227')
  assertEquals(n?.fromIsLid, true)
})

Deno.test('saída da equipe com chat em lid: o lid não é confundido com número', () => {
  const p = payload({
    fromme: true,
    sender: { id: `${CLINICA}@c.us`, senderLid: '218790449176647@lid' },
    chat: { id: '78159932330227@lid' },
    msgcontent: { conversation: 'oi' },
  })
  const n = provider.normalizeInbound(p, headers)
  assertEquals(n?.direction, 'out')
  assertEquals(n?.fromIsLid, true)
  assertEquals(n?.fromPhone, '78159932330227')
})

// ── Formato REAL do webhookDelivery, capturado em produção em 17/set/2026 ──────────────────
// Camel case (`msgContent`, `fromMe`, `messageId`, `instanceId`). A checagem antiga só aceitava
// `msgcontent` minúsculo nos eventos de entrega, e por isso NENHUMA mensagem mandada pelo
// celular virava interação, em linha nenhuma.
function entrega(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: 'webhookDelivery',
    instanceId: 'LITE-FAKE',
    connectedPhone: CLINICA,
    isGroup: false,
    messageId: '3EB0A99D4658F83018C23A',
    fromMe: true,
    chat: { id: PACIENTE, profilePicture: 'https://pps.whatsapp.net/v/foto-paciente.jpg' },
    sender: { id: CLINICA, profilePicture: 'https://pps.whatsapp.net/v/foto-clinica.jpg', pushName: 'Atendimento Comercial' },
    moment: 1_789_645_829,
    fromApi: false,
    msgContent: { conversation: 'Victor, sobre o investimento da consulta' },
    ...over,
  }
}

Deno.test('entrega pelo celular (msgContent camelCase): vira saída para a paciente', () => {
  const n = provider.normalizeInbound(entrega(), headers)
  assertEquals(n?.direction, 'out')
  assertEquals(n?.fromPhone, PACIENTE)
  assertEquals(n?.text, 'Victor, sobre o investimento da consulta')
  assertEquals(n?.externalMessageId, '3EB0A99D4658F83018C23A')
})

Deno.test('eco do que o CRM mandou pela API é reconhecido para ser ignorado', () => {
  assertEquals(ehEnvioPelaApi(entrega({ fromApi: true })), true)
  assertEquals(ehEnvioPelaApi(entrega()), false)
})

Deno.test('foto de perfil: na saída é a do chat (contato), na entrada é a do sender', () => {
  assertEquals(extractContactProfilePicture(entrega()), 'https://pps.whatsapp.net/v/foto-paciente.jpg')
  assertEquals(
    extractContactProfilePicture({ fromMe: false, sender: { profilePicture: 'https://pps.whatsapp.net/v/x.jpg' } }),
    'https://pps.whatsapp.net/v/x.jpg',
  )
  assertEquals(extractContactProfilePicture({ fromMe: false }), '')
})

Deno.test('recibo webhookStatus (formato real): READ vira lida; entrega sem conteúdo não vira mensagem', () => {
  const recibo = {
    event: 'webhookStatus',
    instanceId: 'LITE-FAKE',
    status: 'READ',
    messageId: '3EB03C1C48012B6B99EF3A',
    fromMe: true,
    moment: 1_789_645_802,
    chat: { id: PACIENTE },
    isGroup: false,
  }
  assertEquals(extractMessageStatus(recibo), { messageId: '3EB03C1C48012B6B99EF3A', status: 'read' })
  assertEquals(extractMessageStatus({ ...recibo, status: 'DELIVERY_ACK' }), { messageId: '3EB03C1C48012B6B99EF3A', status: 'delivered' })
  assertEquals(extractMessageStatus({ ...recibo, status: 'PLAYED' })?.status, 'played')
  assertEquals(extractMessageStatus(entrega()), null)
  assertEquals(provider.normalizeInbound(recibo, headers), null)
})

Deno.test('saída pelo celular para contato que só aparece por lid: lid é o do CHAT, nunca o da linha', () => {
  const n = provider.normalizeInbound(
    entrega({
      chat: { id: '70613725143196@lid' },
      sender: { id: CLINICA, senderLid: '99128197513321@lid', pushName: 'Aline Comercial' },
      msgContent: { conversation: 'Guilherme, conseguiu verificar minha ultima mensagem ?' },
    }),
    headers,
  )
  assertEquals(n?.direction, 'out')
  assertEquals(n?.fromIsLid, true)
  assertEquals(n?.fromLid, '70613725143196')
  assertEquals(n?.fromPhone, '70613725143196')
})

