import type {
  NormalizedInboundMessage,
  SendWhatsappMessageInput,
  SendWhatsappMessageResult,
  WhatsappProvider,
} from './types.ts'
import { digitsOnly } from './types.ts'

function envTrim(key: string): string {
  return (Deno.env.get(key) ?? '').trim()
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeStickerBase64(raw: string): string {
  const t = raw.trim()
  const m = t.match(/^data:image\/webp;base64,(.+)$/i)
  return (m ? m[1] : t).replace(/\s/g, '')
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const na = a.trim().toLowerCase()
  const nb = b.trim().toLowerCase()
  if (na.length !== nb.length) return false
  let out = 0
  for (let i = 0; i < na.length; i += 1) {
    out |= na.charCodeAt(i) ^ nb.charCodeAt(i)
  }
  return out === 0
}

export type OfficialWhatsappProviderOptions = {
  phoneNumberId?: string
}

export class OfficialWhatsappProvider implements WhatsappProvider {
  readonly name = 'official' as const
  private readonly phoneNumberId: string
  private readonly accessToken: string
  private readonly appSecret: string
  private readonly apiVersion: string

  constructor(opts?: OfficialWhatsappProviderOptions) {
    this.phoneNumberId = (opts?.phoneNumberId ?? envTrim('WHATSAPP_CLOUD_PHONE_NUMBER_ID')).trim()
    this.accessToken = envTrim('WHATSAPP_CLOUD_ACCESS_TOKEN')
    this.appSecret = envTrim('WHATSAPP_CLOUD_APP_SECRET')
    this.apiVersion = envTrim('WHATSAPP_CLOUD_API_VERSION') || 'v21.0'
  }

  async validateWebhookSignature(rawBody: string, headers: Headers): Promise<boolean> {
    if (!this.appSecret) return true
    const sigHeader = headers.get('x-hub-signature-256') ?? ''
    if (!sigHeader.startsWith('sha256=')) return false
    const expectedHex = sigHeader.slice(7)
    const hex = await hmacSha256Hex(this.appSecret, rawBody)
    return timingSafeEqualHex(hex, expectedHex)
  }

  normalizeInbound(payload: Record<string, unknown>, _headers: Headers): NormalizedInboundMessage | null {
    void _headers
    if (safeString(payload.object).toLowerCase() !== 'whatsapp_business_account') return null
    const entry = Array.isArray(payload.entry) ? (payload.entry as unknown[])[0] : null
    const entryRec = asRecord(entry)
    if (!entryRec) return null
    const changes = Array.isArray(entryRec.changes) ? (entryRec.changes as unknown[])[0] : null
    const changeRec = asRecord(changes)
    if (!changeRec || safeString(changeRec.field).toLowerCase() !== 'messages') return null
    const value = asRecord(changeRec.value)
    if (!value) return null

    const metadata = asRecord(value.metadata)
    const metaPhoneNumberId = safeString(metadata?.phone_number_id)

    const messages = Array.isArray(value.messages) ? (value.messages as unknown[]) : []
    const msg = asRecord(messages[0])
    if (!msg) return null

    const externalMessageId = safeString(msg.id)
    const fromPhone = digitsOnly(safeString(msg.from))
    if (!externalMessageId || fromPhone.length < 10) return null

    const contacts = Array.isArray(value.contacts) ? (value.contacts as unknown[]) : []
    const contact0 = asRecord(contacts[0])
    const profile = asRecord(contact0?.profile)
    const fromName = safeString(profile?.name) || `+${fromPhone}`

    const type = safeString(msg.type).toLowerCase()
    let text = ''
    if (type === 'text') {
      const t = asRecord(msg.text)
      text = safeString(t?.body)
    } else if (type === 'button') {
      const b = asRecord(msg.button)
      text = safeString(b?.text)
    } else if (type === 'interactive') {
      const ir = asRecord(msg.interactive)
      const reply = asRecord(ir?.button_reply) ?? asRecord(ir?.list_reply)
      text = safeString(reply?.title) || safeString(reply?.id)
    } else {
      text = `[whatsapp ${type}]`
    }
    const finalText = text.trim() || `[whatsapp ${type || 'mensagem'}]`

    const tsRaw = Number(msg.timestamp ?? 0)
    const happenedAtIso = Number.isFinite(tsRaw) && tsRaw > 0
      ? new Date(tsRaw > 1e12 ? tsRaw : tsRaw * 1000).toISOString()
      : new Date().toISOString()

    return {
      provider: 'official',
      source: 'whatsapp',
      externalMessageId,
      fromPhone,
      fromName,
      text: finalText,
      direction: 'in',
      happenedAt: happenedAtIso,
      metaPhoneNumberId: metaPhoneNumberId || undefined,
      raw: payload,
    }
  }

  private stickerBase64ToBytes(b64: string): Uint8Array {
    try {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
      return bytes
    } catch {
      throw new Error('invalid_sticker_base64')
    }
  }

  /** Upload WebP → id para mensagem type sticker (WhatsApp Cloud). */
  private async uploadStickerMedia(stickerInput: string): Promise<string> {
    const b64 = normalizeStickerBase64(stickerInput)
    if (b64.length < 32) throw new Error('invalid_sticker')
    if (b64.length > 700_000) throw new Error('sticker_too_large')
    const bytes = this.stickerBase64ToBytes(b64)
    const form = new FormData()
    form.set('messaging_product', 'whatsapp')
    form.set('type', 'image/webp')
    form.set('file', new Blob([bytes], { type: 'image/webp' }), 'sticker.webp')

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/media`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form,
    })
    const responseText = await res.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = responseText ? (JSON.parse(responseText) as Record<string, unknown>) : {}
    } catch {
      parsed = { raw: responseText }
    }
    if (!res.ok) {
      const errMsg = safeString((parsed.error as Record<string, unknown>)?.message ?? parsed.error ?? responseText)
        .slice(0, 240)
      throw new Error(`whatsapp_cloud_sticker_upload_${res.status}:${errMsg}`)
    }
    const id = safeString(parsed.id)
    if (!id) throw new Error('whatsapp_cloud_sticker_upload_no_id')
    return id
  }

  async sendMessage(input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult> {
    if (!this.phoneNumberId) throw new Error('missing_WHATSAPP_CLOUD_PHONE_NUMBER_ID')
    if (!this.accessToken) throw new Error('missing_WHATSAPP_CLOUD_ACCESS_TOKEN')
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')

    const stickerRaw = String(input.stickerWebpBase64 ?? '').trim()
    if (stickerRaw) {
      const mediaId = await this.uploadStickerMedia(stickerRaw)
      const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'sticker',
          sticker: { id: mediaId },
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
        const errMsg = safeString((parsed.error as Record<string, unknown>)?.message ?? parsed.error ?? responseText)
          .slice(0, 240)
        throw new Error(`whatsapp_cloud_send_failed_${res.status}:${errMsg}`)
      }
      const messages = Array.isArray(parsed.messages) ? (parsed.messages as unknown[]) : []
      const m0 = asRecord(messages[0])
      const externalMessageId = safeString(m0?.id) || `wa-cloud-sticker-${crypto.randomUUID()}`
      return {
        provider: 'official',
        externalMessageId,
        status: 'sent',
        raw: parsed,
      }
    }

    const bodyText = input.text.trim()
    if (!bodyText) throw new Error('empty_message')

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: bodyText },
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
      const errMsg = safeString((parsed.error as Record<string, unknown>)?.message ?? parsed.error ?? responseText)
        .slice(0, 240)
      throw new Error(`whatsapp_cloud_send_failed_${res.status}:${errMsg}`)
    }
    const messages = Array.isArray(parsed.messages) ? (parsed.messages as unknown[]) : []
    const m0 = asRecord(messages[0])
    const externalMessageId = safeString(m0?.id) || `wa-cloud-${crypto.randomUUID()}`
    return {
      provider: 'official',
      externalMessageId,
      status: 'sent',
      raw: parsed,
    }
  }
}
