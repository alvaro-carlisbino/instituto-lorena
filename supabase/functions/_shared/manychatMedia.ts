/**
 * Extrai URLs de mídia do payload enviado pelo ManyChat External Request.
 *
 * O ManyChat tem várias formas de expor mídia recebida via WhatsApp/Instagram:
 *   - `attachments` (array de `{ type, url|payload.url, ... }`) — formato oficial Messenger
 *   - `last_input_attachments` (array idem)
 *   - Campos individuais: `media_url`, `image_url`, `audio_url`, `video_url`,
 *     `document_url`, `file_url`, `voice_url`
 *   - URL única no `text` quando o flow do ManyChat empurra `{{last_input_text}}` e
 *     o anexo aparece dentro do texto (fallback mais bagunçado)
 *
 * As URLs S3 do ManyChat seguem o domínio `manybot-files.s3.eu-central-1.amazonaws.com`
 * e ficam públicas por meses — guardamos a URL crua em `storage_path` e renderizamos
 * direto no chat (sem precisar baixar/encodar base64).
 */

export type ManychatMediaType = 'image' | 'audio' | 'video' | 'document' | 'other'

export type ExtractedMedia = {
  url: string
  type: ManychatMediaType
  mimeType?: string
  caption?: string
  name?: string
}

const MANYBOT_HOST_RX = /manybot-files\.s3[.-][^/]+amazonaws\.com/i
const URL_RX = /https?:\/\/[^\s"'<>)]+/gi

function classifyByExtension(urlOrName: string): ManychatMediaType {
  const u = urlOrName.toLowerCase()
  if (/\.(jpe?g|png|gif|webp|bmp|heic|heif)(\?|$)/i.test(u)) return 'image'
  if (/\.(mp3|ogg|opus|wav|m4a|aac|amr)(\?|$)/i.test(u)) return 'audio'
  if (/\.(mp4|mov|webm|mkv|avi|m4v|3gp)(\?|$)/i.test(u)) return 'video'
  if (/\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar)(\?|$)/i.test(u)) return 'document'
  return 'other'
}

function classifyByMime(mime: string | undefined): ManychatMediaType | null {
  if (!mime) return null
  const m = mime.toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('application/') || m.startsWith('text/')) return 'document'
  return null
}

function classifyByManychatType(t: string | undefined): ManychatMediaType | null {
  if (!t) return null
  const k = t.toLowerCase().trim()
  if (k === 'image' || k === 'photo' || k === 'picture') return 'image'
  if (k === 'audio' || k === 'voice' || k === 'voice_message') return 'audio'
  if (k === 'video') return 'video'
  if (k === 'file' || k === 'document') return 'document'
  return null
}

function pushIfNew(out: ExtractedMedia[], item: ExtractedMedia, seen: Set<string>) {
  if (!item.url) return
  if (seen.has(item.url)) return
  seen.add(item.url)
  out.push(item)
}

function readUrlFromObject(obj: Record<string, unknown>): string | null {
  const candidates = [obj.url, obj.URL, obj.href, obj.link]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  const payload = obj.payload
  if (payload && typeof payload === 'object') {
    const p = readUrlFromObject(payload as Record<string, unknown>)
    if (p) return p
  }
  return null
}

function readMimeFromObject(obj: Record<string, unknown>): string | undefined {
  const m = obj.mime_type ?? obj.mimeType ?? obj.contentType ?? obj.content_type
  return typeof m === 'string' ? m : undefined
}

function readCaptionFromObject(obj: Record<string, unknown>): string | undefined {
  const c = obj.caption ?? obj.title ?? obj.description ?? obj.name
  return typeof c === 'string' ? c : undefined
}

function classify(raw: Record<string, unknown>, url: string): ManychatMediaType {
  const explicit = classifyByManychatType(
    typeof raw.type === 'string'
      ? raw.type
      : typeof raw.media_type === 'string'
        ? raw.media_type
        : undefined,
  )
  if (explicit) return explicit
  const byMime = classifyByMime(readMimeFromObject(raw))
  if (byMime) return byMime
  return classifyByExtension(url)
}

function pushFromArrayLike(out: ExtractedMedia[], seen: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const obj = entry as Record<string, unknown>
    const url = readUrlFromObject(obj)
    if (!url) continue
    pushIfNew(out, {
      url,
      type: classify(obj, url),
      mimeType: readMimeFromObject(obj),
      caption: readCaptionFromObject(obj),
    }, seen)
  }
}

const SINGLE_URL_FIELDS: Array<{ key: string; type?: ManychatMediaType }> = [
  { key: 'media_url' },
  { key: 'attachment_url' },
  { key: 'file_url', type: 'document' },
  { key: 'image_url', type: 'image' },
  { key: 'photo_url', type: 'image' },
  { key: 'audio_url', type: 'audio' },
  { key: 'voice_url', type: 'audio' },
  { key: 'video_url', type: 'video' },
  { key: 'document_url', type: 'document' },
  { key: 'last_input_image_url', type: 'image' },
  { key: 'last_input_audio_url', type: 'audio' },
  { key: 'last_input_video_url', type: 'video' },
]

export function extractManychatMedia(body: Record<string, unknown>): ExtractedMedia[] {
  const out: ExtractedMedia[] = []
  const seen = new Set<string>()

  pushFromArrayLike(out, seen, body.attachments)
  pushFromArrayLike(out, seen, body.last_input_attachments)
  pushFromArrayLike(out, seen, body.media)
  pushFromArrayLike(out, seen, (body as { last_input?: Record<string, unknown> }).last_input?.attachments)

  for (const f of SINGLE_URL_FIELDS) {
    const v = body[f.key]
    if (typeof v === 'string' && v.trim()) {
      const url = v.trim()
      pushIfNew(out, {
        url,
        type: f.type ?? classifyByExtension(url),
      }, seen)
    }
  }

  // Último recurso: se o texto contém uma URL do bucket do ManyChat (manybot-files.s3...),
  // capta-a como mídia. Útil quando o cliente só mapeou `{{last_input_text}}`.
  const text = String(body.text ?? body.message ?? '')
  if (text) {
    const matches = text.match(URL_RX) ?? []
    for (const url of matches) {
      if (!MANYBOT_HOST_RX.test(url)) continue
      pushIfNew(out, { url, type: classifyByExtension(url) }, seen)
    }
  }

  return out
}

/**
 * Remove URLs do bucket do ManyChat do corpo do texto — usado quando a URL já foi capturada
 * como mídia e queremos uma `interactions.content` limpa.
 */
export function stripManybotUrlsFromText(text: string): string {
  if (!text) return text
  return text
    .split(/\s+/)
    .filter((token) => !MANYBOT_HOST_RX.test(token))
    .join(' ')
    .trim()
}
