export type ProviderMessageDirection = 'in' | 'out'

export type SendWhatsappMessageInput = {
  to: string
  text: string
  leadId?: string
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
  raw: Record<string, unknown>
}

export interface WhatsappProvider {
  readonly name: 'evolution' | 'official'
  sendMessage(input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult>
  normalizeInbound(payload: Record<string, unknown>, headers: Headers): NormalizedInboundMessage | null
  validateWebhookSignature(rawBody: string, headers: Headers): boolean
}

export function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

