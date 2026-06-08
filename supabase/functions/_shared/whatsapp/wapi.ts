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
    // Ignora eventos não-mensagem (status, connection, etc) quando o payload sinaliza.
    const event = safeString(payload.event ?? payload.type).toLowerCase()
    if (event && !event.includes('message') && !event.includes('msg')) return null

    const messageId = firstString(payload, [
      'messageId',
      'message_id',
      'id',
      'data.messageId',
      'data.id',
      'data.key.id',
      'key.id',
    ])
    if (!messageId) return null

    // W-API normaliza phone como número puro, mas pode vir com sufixo @c.us / @s.whatsapp.net.
    const fromRaw = firstString(payload, [
      'phone',
      'sender.phone',
      'data.phone',
      'from',
      'data.from',
      'data.key.remoteJid',
      'sender.id',
    ])
    const fromRawNormalized = fromRaw.toLowerCase()
    if (fromRawNormalized.includes('@g.us')) return null
    const fromPhone = digitsOnly(fromRaw)
    if (fromPhone.length < 10) return null

    const pushName = firstString(payload, [
      'senderName',
      'sender.name',
      'pushName',
      'data.pushName',
      'data.sender.pushName',
      'contact.name',
    ])
    const fromName = pushName || 'Contato WhatsApp'

    const text = firstString(payload, [
      'message',
      'text',
      'body',
      'data.message',
      'data.text',
      'data.body',
      'data.message.conversation',
      'data.message.extendedTextMessage.text',
    ])

    const finalText = text.trim()
    if (!finalText) return null

    const fromMeRaw = getByPath(payload, 'fromMe') ?? getByPath(payload, 'data.fromMe') ?? getByPath(payload, 'data.key.fromMe')
    const fromMe = Boolean(fromMeRaw)

    const tsRaw =
      Number(getByPath(payload, 'timestamp') ?? getByPath(payload, 'data.timestamp') ?? getByPath(payload, 'data.messageTimestamp') ?? 0) ||
      Math.floor(Date.now() / 1000)
    const tsMs = tsRaw > 1e12 ? tsRaw : tsRaw * 1000
    const happenedAtIso = new Date(tsMs).toISOString()

    const payloadInstanceId = firstString(payload, [
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
      text: finalText,
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
