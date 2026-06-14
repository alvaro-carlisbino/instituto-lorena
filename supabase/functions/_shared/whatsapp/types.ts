import type { LeadAttribution } from '../attribution.ts'

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
  provider: 'evolution' | 'official' | 'wapi'
  externalMessageId: string
  status: 'queued' | 'sent' | 'delivered' | 'failed'
  raw?: Record<string, unknown>
}

export type SendWhatsappImageInput = {
  to: string
  /** URL pública da imagem (ex.: PNG do QR Pix do PagBank). */
  imageUrl: string
  caption?: string
  leadId?: string
}

export type NormalizedInboundMessage = {
  provider: 'evolution' | 'official' | 'wapi'
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
  /** W-API: id da instância no painel deles, para casar com whatsapp_channel_instances.wapi_instance_id. */
  wapiInstanceId?: string
  mediaItems?: Array<{
    type: 'audio' | 'image' | 'video' | 'document' | 'other'
    mimeType?: string
    externalMediaId?: string
    caption?: string
  }>
  /** Atribuição Click-to-WhatsApp (msg.referral). Só presente na 1ª mensagem pós-clique. */
  attribution?: LeadAttribution
  raw: Record<string, unknown>
}

export interface WhatsappProvider {
  readonly name: 'evolution' | 'official' | 'wapi'
  sendMessage(input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult>
  /** Opcional: envia uma IMAGEM (ex.: QR Pix). Só implementado onde a API suporta (W-API). */
  sendImageMessage?(input: SendWhatsappImageInput): Promise<SendWhatsappMessageResult>
  normalizeInbound(payload: Record<string, unknown>, headers: Headers): NormalizedInboundMessage | null
  /** Evolution: síncrono. Meta Cloud: pode ser assíncrono (HMAC Web Crypto). */
  validateWebhookSignature(rawBody: string, headers: Headers): boolean | Promise<boolean>
}

export function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

