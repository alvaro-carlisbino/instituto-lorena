import type {
  NormalizedInboundMessage,
  SendWhatsappImageInput,
  SendWhatsappMessageInput,
  SendWhatsappMessageResult,
  WhatsappProvider,
} from './types.ts'
import { digitsOnly } from './types.ts'
import { attributionFromMetaReferral } from '../attribution.ts'

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
  /**
   * Credenciais da LINHA (`whatsapp_channel_instances`). Quando vazias, cai no env global —
   * que só serve enquanto existir uma WABA só. Com dois polos, o token do app da clínica
   * mandaria pela WABA da clínica mesmo com a linha de vendas resolvida.
   */
  accessToken?: string
  appSecret?: string
  wabaId?: string
}

export class OfficialWhatsappProvider implements WhatsappProvider {
  readonly name = 'official' as const
  private readonly phoneNumberId: string
  private readonly accessToken: string
  private readonly appSecret: string
  private readonly apiVersion: string
  readonly wabaId: string

  constructor(opts?: OfficialWhatsappProviderOptions) {
    this.phoneNumberId = (opts?.phoneNumberId ?? envTrim('WHATSAPP_CLOUD_PHONE_NUMBER_ID')).trim()
    this.accessToken = (opts?.accessToken ?? '').trim() || envTrim('WHATSAPP_CLOUD_ACCESS_TOKEN')
    this.appSecret = (opts?.appSecret ?? '').trim() || envTrim('WHATSAPP_CLOUD_APP_SECRET')
    this.wabaId = (opts?.wabaId ?? '').trim() || envTrim('WHATSAPP_CLOUD_WABA_ID')
    this.apiVersion = envTrim('WHATSAPP_CLOUD_API_VERSION') || 'v21.0'
  }

  async validateWebhookSignature(rawBody: string, headers: Headers): Promise<boolean> {
    // FALHA FECHADA. Antes, sem app secret configurado isto devolvia `true` — e o
    // crm-whatsapp-webhook é público (verify_jwt = false). Qualquer um que soubesse a URL
    // podia forjar uma mensagem de paciente, criar lead e fazer a Sofia responder. Sem
    // segredo não há como distinguir a Meta de um estranho, então a resposta é não.
    if (!this.appSecret) {
      console.error('[official] app secret ausente: webhook recusado (configure meta_app_secret na linha ou WHATSAPP_CLOUD_APP_SECRET)')
      return false
    }
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
    }

    // Mídia. A Cloud API não manda o ficheiro no webhook — manda um `id` que expira em 5
    // dias e precisa ser trocado por URL autenticada (ver officialMediaDownload.ts). Sem
    // registrar o id aqui a foto do laudo vira "[whatsapp image]" e some.
    const mediaItems: NonNullable<NormalizedInboundMessage['mediaItems']> = []
    const MEDIA_KINDS: Record<string, 'audio' | 'image' | 'video' | 'document' | 'other'> = {
      audio: 'audio',
      voice: 'audio',
      image: 'image',
      video: 'video',
      document: 'document',
      sticker: 'other',
    }
    const mediaKind = MEDIA_KINDS[type]
    if (mediaKind) {
      const m = asRecord(msg[type])
      const caption = safeString(m?.caption).trim()
      mediaItems.push({
        type: mediaKind,
        mimeType: safeString(m?.mime_type) || undefined,
        externalMediaId: safeString(m?.id) || undefined,
        caption: caption || undefined,
      })
      if (caption) text = caption
    }

    if (!text) text = `[whatsapp ${type}]`
    const finalText = text.trim() || `[whatsapp ${type || 'mensagem'}]`

    const tsRaw = Number(msg.timestamp ?? 0)
    const happenedAtIso = Number.isFinite(tsRaw) && tsRaw > 0
      ? new Date(tsRaw > 1e12 ? tsRaw : tsRaw * 1000).toISOString()
      : new Date().toISOString()

    const attribution = attributionFromMetaReferral(msg.referral, 'ctwa_whatsapp') ?? undefined

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
      mediaItems: mediaItems.length ? mediaItems : undefined,
      attribution,
      raw: payload,
    }
  }

  /** Troca o `id` do webhook pelos bytes do ficheiro. A URL da Meta exige o Bearer. */
  async fetchMediaBase64(mediaId: string): Promise<{ base64: string; mimeType: string } | null> {
    const id = String(mediaId ?? '').trim()
    if (!id || !this.accessToken) return null
    const metaRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/${id}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    })
    if (!metaRes.ok) return null
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string }
    const url = safeString(meta.url)
    if (!url) return null
    // O CDN da Meta devolve 401 sem o token — não é URL pública, apesar do domínio.
    const binRes = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } })
    if (!binRes.ok) return null
    const bytes = new Uint8Array(await binRes.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return { base64: btoa(bin), mimeType: safeString(meta.mime_type) || 'application/octet-stream' }
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
    // Cópia para um ArrayBuffer próprio: `Uint8Array` genérico não satisfaz `BlobPart`
    // (pode estar sobre SharedArrayBuffer) e o type-check quebra.
    const buf = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buf).set(bytes)
    const form = new FormData()
    form.set('messaging_product', 'whatsapp')
    form.set('type', 'image/webp')
    form.set('file', new Blob([buf], { type: 'image/webp' }), 'sticker.webp')

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

  /** POST /{phone_number_id}/messages — o único caminho de saída da Cloud API. */
  private async postMessage(
    payload: Record<string, unknown>,
    idPrefix: string,
  ): Promise<SendWhatsappMessageResult> {
    if (!this.phoneNumberId) throw new Error('missing_WHATSAPP_CLOUD_PHONE_NUMBER_ID')
    if (!this.accessToken) throw new Error('missing_WHATSAPP_CLOUD_ACCESS_TOKEN')

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
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
    return {
      provider: 'official',
      externalMessageId: safeString(m0?.id) || `${idPrefix}-${crypto.randomUUID()}`,
      status: 'sent',
      raw: parsed,
    }
  }

  async sendMessage(input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')

    const stickerRaw = String(input.stickerWebpBase64 ?? '').trim()
    if (stickerRaw) {
      const mediaId = await this.uploadStickerMedia(stickerRaw)
      return this.postMessage({ to, type: 'sticker', sticker: { id: mediaId } }, 'wa-cloud-sticker')
    }

    const bodyText = input.text.trim()
    if (!bodyText) throw new Error('empty_message')
    return this.postMessage(
      { to, type: 'text', text: { preview_url: false, body: bodyText } },
      'wa-cloud',
    )
  }

  async sendImageMessage(input: SendWhatsappImageInput): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const link = String(input.imageUrl ?? '').trim()
    if (!link) throw new Error('missing_image_url')
    const caption = String(input.caption ?? '').trim()
    return this.postMessage(
      { to, type: 'image', image: caption ? { link, caption } : { link } },
      'wa-cloud-image',
    )
  }

  /**
   * Mensagem de MODELO aprovado — o único jeito de falar com alguém fora da janela de 24h.
   * Follow-up, reengajamento, NPS e lembrete de cirurgia caem todos aqui: a Meta aceita e
   * dropa em silêncio se mandarmos texto livre com a janela fechada.
   */
  async sendTemplateMessage(input: {
    to: string
    templateName: string
    languageCode?: string
    /** Variáveis {{1}}, {{2}}… do corpo, na ordem. */
    bodyParams?: string[]
  }): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const name = String(input.templateName ?? '').trim()
    if (!name) throw new Error('missing_template_name')

    const components = (input.bodyParams ?? []).length
      ? [{
        type: 'body',
        parameters: (input.bodyParams ?? []).map((t) => ({ type: 'text', text: String(t) })),
      }]
      : undefined

    return this.postMessage(
      {
        to,
        type: 'template',
        template: {
          name,
          language: { code: (input.languageCode ?? 'pt_BR').trim() },
          ...(components ? { components } : {}),
        },
      },
      'wa-cloud-template',
    )
  }

  /** Templates aprovados desta WABA — para o painel escolher em vez de adivinhar o nome. */
  async listTemplates(): Promise<Array<{ name: string; language: string; status: string; category: string }>> {
    if (!this.wabaId || !this.accessToken) return []
    const url =
      `https://graph.facebook.com/${this.apiVersion}/${this.wabaId}/message_templates?limit=200&fields=name,language,status,category`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } })
    if (!res.ok) return []
    const body = (await res.json()) as { data?: unknown }
    const rows = Array.isArray(body.data) ? body.data : []
    return rows.map((r) => {
      const rec = asRecord(r) ?? {}
      return {
        name: safeString(rec.name),
        language: safeString(rec.language),
        status: safeString(rec.status),
        category: safeString(rec.category),
      }
    }).filter((t) => t.name)
  }
}
