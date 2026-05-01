export type ProviderMessageDirection = 'in' | 'out'

export type SendWhatsappMessageInput = {
  to: string
  text: string
  leadId?: string
  /** Base64 do ficheiro WebP (com ou sem prefixo data:image/webp;base64,). Só WhatsApp (Evolution / Cloud). */
  stickerWebpBase64?: string
  metadata?: Record<string, unknown>
}

export type SendWhatsappMessageResult = {
  provider: 'evolution' | 'official'
  externalMessageId: string
  status: 'queued' | 'sent' | 'delivered' | 'failed'
  raw?: Record<string, unknown>
}

export type NormalizedInboundMessage = {
  provider: 'evolution' | 'official'
  source: 'whatsapp'
  externalMessageId: string
  fromPhone: string
  fromName: string
  text: string
  direction: ProviderMessageDirection
  happenedAt: string
  /** Evolution API: instance that received/sent the message, for multi-line routing. */
  evolutionInstanceName?: string
  /** Meta Cloud API: metadata.phone_number_id (roteamento multi-linha oficial). */
  metaPhoneNumberId?: string
  mediaItems?: Array<{
    type: 'audio' | 'image' | 'video' | 'document' | 'other'
    mimeType?: string
    externalMediaId?: string
    caption?: string
  }>
  raw: Record<string, unknown>
}

export interface WhatsappProvider {
  readonly name: 'evolution' | 'official'
  sendMessage(input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult>
  normalizeInbound(payload: Record<string, unknown>, headers: Headers): NormalizedInboundMessage | null
  /** Evolution: síncrono. Meta Cloud: pode ser assíncrono (HMAC Web Crypto). */
  validateWebhookSignature(rawBody: string, headers: Headers): boolean | Promise<boolean>
}

export function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

