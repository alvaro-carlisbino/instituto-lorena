import {
  type NormalizedInboundMessage,
  type SendWhatsappMessageInput,
  type SendWhatsappMessageResult,
  type WhatsappProvider,
  digitsOnly,
} from './types.ts'

function envOrThrow(key: string): string {
  const value = (Deno.env.get(key) ?? '').trim()
  if (!value) throw new Error(`missing_env_${key}`)
  return value
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizePhone(raw: string): string {
  return digitsOnly(raw)
}

export class EvolutionProvider implements WhatsappProvider {
  readonly name = 'evolution' as const
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly instance: string
  private readonly webhookSecret: string

  constructor() {
    this.baseUrl = envOrThrow('EVOLUTION_API_BASE').replace(/\/$/, '')
    this.apiKey = envOrThrow('EVOLUTION_API_KEY')
    this.instance = envOrThrow('EVOLUTION_INSTANCE')
    this.webhookSecret = (Deno.env.get('EVOLUTION_WEBHOOK_SECRET') ?? '').trim()
  }

  validateWebhookSignature(_rawBody: string, headers: Headers): boolean {
    if (!this.webhookSecret) return true
    const headerSecret = headers.get('x-webhook-secret')?.trim() ?? ''
    return Boolean(this.webhookSecret && headerSecret === this.webhookSecret)
  }

  normalizeInbound(payload: Record<string, unknown>): NormalizedInboundMessage | null {
    const event = safeString(payload.event).toLowerCase()
    if (event && !event.includes('message')) return null

    const messageId =
      safeString(getByPath(payload, 'data.key.id')) ||
      safeString(getByPath(payload, 'data.messageId')) ||
      safeString(getByPath(payload, 'id'))
    if (!messageId) return null

    const fromRaw =
      safeString(getByPath(payload, 'data.key.remoteJid')) ||
      safeString(getByPath(payload, 'data.from')) ||
      safeString(getByPath(payload, 'sender'))
    const fromRawNormalized = fromRaw.toLowerCase()
    if (fromRawNormalized.includes('@g.us')) return null
    const fromPhone = normalizePhone(fromRaw)
    if (fromPhone.length < 10) return null

    const pushName =
      safeString(getByPath(payload, 'data.pushName')) ||
      safeString(getByPath(payload, 'data.sender.pushName')) ||
      safeString(getByPath(payload, 'senderName'))
    const fromName = pushName || 'Contato WhatsApp'

    const text =
      safeString(getByPath(payload, 'data.message.conversation')) ||
      safeString(getByPath(payload, 'data.message.extendedTextMessage.text')) ||
      safeString(getByPath(payload, 'data.message.imageMessage.caption')) ||
      safeString(getByPath(payload, 'data.message.videoMessage.caption')) ||
      safeString(getByPath(payload, 'data.message.documentMessage.caption')) ||
      safeString(getByPath(payload, 'data.body')) ||
      safeString(getByPath(payload, 'message'))

    const messageObj = asRecord(getByPath(payload, 'data.message')) ?? {}
    const mediaItems: NormalizedInboundMessage['mediaItems'] = []
    const pushMedia = (
      key: string,
      type: 'audio' | 'image' | 'video' | 'document' | 'other',
      mimePath: string,
      idPath: string,
      captionPath?: string,
    ) => {
      const node = asRecord(messageObj[key])
      if (!node) return
      mediaItems.push({
        type,
        mimeType: safeString(getByPath(node, mimePath)),
        externalMediaId: safeString(getByPath(node, idPath)),
        caption: captionPath ? safeString(getByPath(node, captionPath)) : '',
      })
    }
    pushMedia('audioMessage', 'audio', 'mimetype', 'mediaKey')
    pushMedia('documentMessage', 'document', 'mimetype', 'mediaKey', 'caption')
    pushMedia('imageMessage', 'image', 'mimetype', 'mediaKey', 'caption')
    pushMedia('videoMessage', 'video', 'mimetype', 'mediaKey', 'caption')

    const hasMedia = mediaItems.length > 0
    const finalText = text.trim() || (hasMedia ? `[mídia recebida: ${mediaItems.map((m) => m.type).join(', ')}]` : '')
    if (!finalText) return null

    const fromMe = Boolean(getByPath(payload, 'data.key.fromMe') ?? false)
    const happenedAtRaw = Number(getByPath(payload, 'data.messageTimestamp') ?? Date.now() / 1000)
    const happenedAtIso = Number.isFinite(happenedAtRaw)
      ? new Date(happenedAtRaw > 1e12 ? happenedAtRaw : happenedAtRaw * 1000).toISOString()
      : new Date().toISOString()

    return {
      provider: this.name,
      source: 'whatsapp',
      externalMessageId: messageId,
      fromPhone,
      fromName,
      text: finalText,
      direction: fromMe ? 'out' : 'in',
      happenedAt: happenedAtIso,
      mediaItems,
      raw: payload,
    }
  }

  async sendMessage(input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult> {
    const to = normalizePhone(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const text = input.text.trim()
    if (!text) throw new Error('empty_message')

    const url = `${this.baseUrl}/message/sendText/${this.instance}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
      },
      body: JSON.stringify({
        number: to,
        text,
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
      throw new Error(`evolution_send_failed_${res.status}`)
    }

    const externalMessageId =
      safeString(getByPath(parsed, 'key.id')) ||
      safeString(getByPath(parsed, 'data.key.id')) ||
      safeString(getByPath(parsed, 'messageId')) ||
      `evo-${crypto.randomUUID()}`

    return {
      provider: this.name,
      externalMessageId,
      status: 'queued',
      raw: parsed,
    }
  }
}

