import {
  type NormalizedInboundMessage,
  type SendWhatsappImageInput,
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

  /** Envia uma IMAGEM por URL (W-API: /message/send-image). Usado p/ o QR do Pix. */
  async sendImageMessage(input: SendWhatsappImageInput): Promise<SendWhatsappMessageResult> {
    const to = digitsOnly(input.to)
    if (to.length < 10) throw new Error('invalid_phone')
    const image = String(input.imageUrl ?? '').trim()
    if (!image) throw new Error('empty_image')

    const url = `${this.baseUrl}/message/send-image?instanceId=${encodeURIComponent(this.instanceId)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        phone: to,
        image,
        caption: (input.caption ?? '').trim() || undefined,
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
      throw new Error(`wapi_send_image_failed_${res.status}: ${responseText.slice(0, 200)}`)
    }
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
      throw new Error(`wapi_send_image_failed_api: ${detail} | body=${responseText.slice(0, 200)}`)
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

  /**
   * Baixa+descriptografa uma mídia INBOUND via W-API (/message/download-media). O body é
   * flat com os campos de descriptografia do WhatsApp (mediaKey/directPath/url/mimetype/...).
   * Devolve base64 + mimeType. `debug` sempre preenchido (status/erro) para diagnóstico.
   */
  async downloadMedia(
    messageId: string,
    type: 'image' | 'video' | 'audio' | 'document',
    media: Record<string, unknown>,
  ): Promise<{ ok: boolean; base64?: string; mimeType?: string; debug: string }> {
    const body: Record<string, unknown> = {
      messageId,
      type,
      mediaKey: media.mediaKey,
      directPath: media.directPath,
      url: media.url,
      mimetype: media.mimetype ?? media.mimeType,
      fileEncSha256: media.fileEncSha256,
      fileSha256: media.fileSha256,
    }
    let status = 0
    let bodyText = ''
    try {
      const res = await fetch(`${this.baseUrl}/message/download-media?instanceId=${encodeURIComponent(this.instanceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify(body),
        // 45s: a W-API às vezes demora pra preparar a mídia; 20s estourava (áudios "sumiam").
        // Roda em background no webhook, então o tempo extra não atrasa a resposta.
        signal: AbortSignal.timeout(45000),
      })
      status = res.status
      bodyText = await res.text()
      let parsed: Record<string, unknown> = {}
      try {
        parsed = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {}
      } catch {
        parsed = {}
      }
      if (!res.ok || parsed.error) {
        return { ok: false, debug: `http_${status}:${bodyText.slice(0, 180)}` }
      }
      const mimeType =
        safeString(getByPath(parsed, 'mimetype')) ||
        safeString(getByPath(parsed, 'mimeType')) ||
        String(media.mimetype ?? media.mimeType ?? 'image/jpeg')
      // 1) base64 direto em algum campo comum.
      const b64raw =
        safeString(getByPath(parsed, 'fileBase64')) ||
        safeString(getByPath(parsed, 'base64')) ||
        safeString(getByPath(parsed, 'data')) ||
        safeString(getByPath(parsed, 'media')) ||
        safeString(getByPath(parsed, 'mediaBase64')) ||
        safeString(getByPath(parsed, 'data.base64')) ||
        safeString(getByPath(parsed, 'data.fileBase64'))
      if (b64raw && b64raw.length > 100) {
        const clean = b64raw.includes('base64,') ? b64raw.split('base64,')[1] : b64raw
        return { ok: true, base64: clean, mimeType, debug: `ok_base64_${status}` }
      }
      // 2) URL hospedada → baixa e converte. O W-API devolve `fileLink` (URL que EXPIRA),
      // então baixamos os bytes agora e guardamos em base64 (permanente).
      const mediaUrl =
        safeString(getByPath(parsed, 'fileLink')) ||
        safeString(getByPath(parsed, 'url')) ||
        safeString(getByPath(parsed, 'link')) ||
        safeString(getByPath(parsed, 'fileUrl')) ||
        safeString(getByPath(parsed, 'mediaUrl')) ||
        safeString(getByPath(parsed, 'data.fileLink')) ||
        safeString(getByPath(parsed, 'data.url'))
      if (mediaUrl && mediaUrl.startsWith('http')) {
        const r = await fetch(mediaUrl, { signal: AbortSignal.timeout(40000) })
        if (!r.ok) return { ok: false, debug: `media_url_http_${r.status}` }
        const buf = await r.arrayBuffer()
        // Guarda de tamanho: base64 vai no DB (fetch global do chat) — pula arquivos grandes.
        if (buf.byteLength > 6_000_000) return { ok: false, debug: `too_large_${buf.byteLength}` }
        const bytes = new Uint8Array(buf)
        let bin = ''
        const ch = 0x8000
        for (let i = 0; i < bytes.length; i += ch) bin += String.fromCharCode(...bytes.subarray(i, i + ch))
        const ctype = safeString(r.headers.get('content-type')).split(';')[0].trim() || mimeType
        return { ok: true, base64: btoa(bin), mimeType: ctype, debug: `ok_url_${status}` }
      }
      return { ok: false, debug: `no_media_in_resp_${status}:${bodyText.slice(0, 180)}` }
    } catch (e) {
      return { ok: false, debug: `exception:${(e instanceof Error ? e.message : String(e)).slice(0, 150)}` }
    }
  }
}

/**
 * Extrai a mídia inbound do payload W-API (imagem/figurinha, áudio/ptt, vídeo, documento),
 * com os campos de descriptografia para o download-media. Devolve o tipo + objeto, ou null.
 */
export function extractInboundMedia(
  payload: Record<string, unknown>,
): { mediaType: 'image' | 'audio' | 'video' | 'document'; caption: string; media: Record<string, unknown> } | null {
  const mc = (payload?.msgContent ?? payload?.msgcontent ?? payload?.message ?? {}) as Record<string, unknown>
  const pick = (k: string) => (mc[k] && typeof mc[k] === 'object' ? (mc[k] as Record<string, unknown>) : null)
  const found =
    (pick('imageMessage') ?? pick('stickerMessage')) ? { mediaType: 'image' as const, media: (pick('imageMessage') ?? pick('stickerMessage'))! }
      : (pick('audioMessage') ?? pick('pttMessage')) ? { mediaType: 'audio' as const, media: (pick('audioMessage') ?? pick('pttMessage'))! }
        : pick('videoMessage') ? { mediaType: 'video' as const, media: pick('videoMessage')! }
          : pick('documentMessage') ? { mediaType: 'document' as const, media: pick('documentMessage')! }
            : null
  if (!found) return null
  const m = found.media
  const caption = typeof m.caption === 'string' ? m.caption : typeof m.fileName === 'string' ? m.fileName : ''
  return { mediaType: found.mediaType, caption, media: m }
}

/**
 * Marcadores de mídia SEM legenda — quando o cliente manda só uma foto/áudio/etc., o
 * texto inbound vira só "📷 Imagem". A IA não "vê" o conteúdo, então o bot NÃO deve
 * responder (em vez de dizer "não consigo ver"). Com legenda, o texto é a legenda real.
 */
const WAPI_MEDIA_ONLY_MARKERS = new Set([
  '📷 Imagem',
  '🎤 Áudio',
  '🎥 Vídeo',
  '📎 Documento',
  '🌟 Figurinha',
  '📍 Localização',
  '👤 Contato',
])
export function isMediaOnlyMarker(text: string): boolean {
  return WAPI_MEDIA_ONLY_MARKERS.has(String(text ?? '').trim())
}
