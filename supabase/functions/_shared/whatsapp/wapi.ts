import {
  type NormalizedInboundMessage,
  type SendWhatsappMessageInput,
  type SendWhatsappMessageResult,
  type WhatsappProvider,
  digitsOnly,
} from './types.ts'

/**
 * Provider para a W-API (https://api.w-api.app). Diferente do Evolution/Official,
 * NÃO pega credenciais da env: cada linha em whatsapp_channel_instances guarda
 * seu próprio token + instanceId (W-API entrega 1 token por instância). Por isso
 * a config é injetada no construtor; veja wapiConfig.ts.
 *
 * IMPORTANTE — formato do webhook de entrada ainda não confirmado.
 * `normalizeInbound` tenta os caminhos mais comuns (W-API costuma seguir o mesmo
 * schema do Baileys/Evolution, mas pode usar root keys diferentes). Quando o
 * primeiro evento real chegar, comparar com `payload` no log e ajustar.
 */

export type WapiProviderConfig = {
  /** Base URL da W-API. Default: https://api.w-api.app/v1 (sem barra final). */
  baseUrl: string
  /** Token Bearer da instância (uma instância = um token na W-API). */
  token: string
  /** ID da instância no painel da W-API. Vai como ?instanceId= na URL. */
  instanceId: string
  /** Segredo opcional comparado contra header x-webhook-secret do webhook entrante. */
  webhookSecret: string
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let cur: unknown = obj
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

function firstString(obj: Record<string, unknown>, paths: string[]): string {
  for (const p of paths) {
    const v = safeString(getByPath(obj, p)).trim()
    if (v) return v
  }
  return ''
}

const DEFAULT_WAPI_BASE_URL = 'https://api.w-api.app/v1'

export class WapiProvider implements WhatsappProvider {
  readonly name = 'wapi' as const
  private readonly baseUrl: string
  private readonly token: string
  private readonly instanceId: string
  private readonly webhookSecret: string

  constructor(config: WapiProviderConfig) {
    this.baseUrl = (config.baseUrl?.trim() || DEFAULT_WAPI_BASE_URL).replace(/\/$/, '')
    this.token = config.token.trim()
    this.instanceId = config.instanceId.trim()
    this.webhookSecret = config.webhookSecret.trim()
    if (!this.token) throw new Error('missing_wapi_token')
    if (!this.instanceId) throw new Error('missing_wapi_instance_id')
  }

  validateWebhookSignature(_rawBody: string, headers: Headers): boolean | Promise<boolean> {
    if (!this.webhookSecret) return true
    const headerSecret = headers.get('x-webhook-secret')?.trim() ?? ''
    return Boolean(this.webhookSecret && headerSecret === this.webhookSecret)
  }

  normalizeInbound(payload: Record<string, unknown>, _headers: Headers): NormalizedInboundMessage | null {
    // Formato REAL da W-API (confirmado nos logs de webhook 12/jun): chaves minúsculas
    // e flat — event="webhookReceived", instanceid, messageid, fromme, isgroup,
    // sender:{id,pushname}, chat:{id}, moment (epoch s), msgcontent:{conversation|...}.
    // Mantemos fallbacks p/ nomes camelCase/Baileys por robustez.
    const event = safeString(payload.event ?? payload.type).toLowerCase()
    // Só descarta se for claramente um evento de não-mensagem (status/conexão/presença).
    if (event && /(status|connect|disconnect|presence|qrcode|delivery|ack)/.test(event)) {
      if (!payload.msgcontent && !payload.message) return null
    }

    // Ignora mensagens de grupo (não viram lead/atendimento 1:1).
    const isGroup =
      payload.isGroup === true ||
      payload.isgroup === true ||
      safeString(getByPath(payload, 'chat.id')).toLowerCase().includes('@g.us') ||
      safeString(getByPath(payload, 'key.remoteJid')).toLowerCase().includes('@g.us')
    if (isGroup) return null

    const messageId = firstString(payload, [
      'messageid',
      'messageId',
      'message_id',
      'id',
      'data.messageId',
      'data.id',
      'data.key.id',
      'key.id',
    ])
    if (!messageId) return null

    // Remetente: sender.id (formato real) ou variações. Pode vir com @c.us / @s.whatsapp.net.
    const fromRaw = firstString(payload, [
      'sender.id',
      'sender.phone',
      'phone',
      'data.phone',
      'from',
      'data.from',
      'data.key.remoteJid',
    ])
    if (fromRaw.toLowerCase().includes('@g.us')) return null
    const fromPhone = digitsOnly(fromRaw)
    if (fromPhone.length < 10) return null

    const pushName = firstString(payload, [
      'sender.pushName',
      'sender.pushname',
      'senderName',
      'sender.name',
      'pushName',
      'data.pushName',
      'contact.name',
    ])
    const fromName = pushName || 'Contato WhatsApp'

    // Texto: msgcontent.conversation | extendedTextMessage.text | legenda de mídia.
    let text = firstString(payload, [
      'msgContent.conversation',
      'msgContent.extendedTextMessage.text',
      'msgContent.imageMessage.caption',
      'msgContent.videoMessage.caption',
      'msgContent.documentMessage.caption',
      'msgcontent.conversation',
      'msgcontent.extendedTextMessage.text',
      'msgcontent.imageMessage.caption',
      'msgcontent.videoMessage.caption',
      'msgcontent.documentMessage.caption',
      'message',
      'text',
      'body',
      'data.message',
      'data.text',
      'data.body',
      'data.message.conversation',
      'data.message.extendedTextMessage.text',
    ]).trim()

    // Mídia sem legenda: usa um marcador para não perder a mensagem no chat.
    if (!text) {
      const mc = (payload.msgContent ?? payload.msgcontent ?? payload.message ?? {}) as Record<string, unknown>
      if (mc.imageMessage) text = '📷 Imagem'
      else if (mc.audioMessage || mc.pttMessage) text = '🎤 Áudio'
      else if (mc.videoMessage) text = '🎥 Vídeo'
      else if (mc.documentMessage) text = '📎 Documento'
      else if (mc.stickerMessage) text = '🌟 Figurinha'
      else if (mc.locationMessage) text = '📍 Localização'
      else if (mc.contactMessage || mc.contactsArrayMessage) text = '👤 Contato'
    }
    if (!text) return null

    const fromMe = Boolean(
      payload.fromme ?? getByPath(payload, 'fromMe') ?? getByPath(payload, 'data.fromMe') ?? getByPath(payload, 'data.key.fromMe'),
    )

    const tsRaw =
      Number(
        payload.moment ??
          getByPath(payload, 'timestamp') ??
          getByPath(payload, 'data.timestamp') ??
          getByPath(payload, 'data.messageTimestamp') ??
          0,
      ) || Math.floor(Date.now() / 1000)
    const tsMs = tsRaw > 1e12 ? tsRaw : tsRaw * 1000
    const happenedAtIso = new Date(tsMs).toISOString()

    const payloadInstanceId = firstString(payload, [
      'instanceid',
      'instanceId',
      'instance_id',
      'data.instanceId',
      'data.instance_id',
    ]) || this.instanceId

    return {
      provider: this.name,
      source: 'whatsapp',
      externalMessageId: messageId,
      fromPhone,
      fromName,
      text,
      direction: fromMe ? 'out' : 'in',
      happenedAt: happenedAtIso,
      wapiInstanceId: payloadInstanceId || undefined,
      raw: payload,
    }
  }

  async sendMessage(input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')

    if (input.stickerWebpBase64) {
      // W-API tem endpoint próprio pra sticker; por enquanto não suportado por aqui.
      throw new Error('wapi_sticker_not_implemented')
    }

    const text = input.text.trim()
    if (!text) throw new Error('empty_message')

    // W-API exige instanceId como query param e Bearer token no header.
    const url = `${this.baseUrl}/message/send-text?instanceId=${encodeURIComponent(this.instanceId)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        phone: to,
        message: text,
      }),
    })

    const responseText = await res.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {}
    } catch {
      parsed = { raw: responseText }
    }

    if (!res.ok) {
      throw new Error(`wapi_send_failed_${res.status}: ${responseText.slice(0, 200)}`)
    }

    // W-API às vezes retorna HTTP 200 com corpo de erro (instância desconectada,
    // número inválido/não está no WhatsApp, sessão expirada). Se a gente não checar
    // o body, o CRM marca como enviado, exibe toast verde, e a paciente nunca recebe.
    // Sintomas como "Aline mandou e a paciente não recebeu" caíam aqui em silêncio.
    const apiError =
      safeString(getByPath(parsed, 'error')) ||
      safeString(getByPath(parsed, 'errorMessage')) ||
      safeString(getByPath(parsed, 'data.error')) ||
      safeString(getByPath(parsed, 'message_error'))
    const apiStatusRaw = safeString(
      getByPath(parsed, 'status') ?? getByPath(parsed, 'data.status') ?? '',
    ).toLowerCase()
    const successFlagRaw = getByPath(parsed, 'success') ?? getByPath(parsed, 'data.success')
    const successFlagFalse = successFlagRaw === false || String(successFlagRaw).toLowerCase() === 'false'
    if (apiError || apiStatusRaw === 'error' || apiStatusRaw === 'failed' || successFlagFalse) {
      const detail = apiError || apiStatusRaw || 'unknown_api_error'
      throw new Error(`wapi_send_failed_api: ${detail} | body=${responseText.slice(0, 200)}`)
    }

    const externalMessageId =
      safeString(getByPath(parsed, 'messageId')) ||
      safeString(getByPath(parsed, 'data.messageId')) ||
      safeString(getByPath(parsed, 'id')) ||
      safeString(getByPath(parsed, 'data.id')) ||
      safeString(getByPath(parsed, 'key.id')) ||
      `wapi-${crypto.randomUUID()}`

    return {
      provider: this.name,
      externalMessageId,
      status: 'queued',
      raw: parsed,
    }
  }
}
