import type {
  NormalizedInboundMessage,
  SendWhatsappMessageInput,
  SendWhatsappMessageResult,
  WhatsappProvider,
} from './types.ts'

export class OfficialWhatsappProvider implements WhatsappProvider {
  readonly name = 'official' as const

  validateWebhookSignature(): boolean {
    return false
  }

  normalizeInbound(): NormalizedInboundMessage | null {
    return null
  }

  async sendMessage(_input: SendWhatsappMessageInput): Promise<SendWhatsappMessageResult> {
    void _input
    throw new Error('official_provider_not_implemented')
  }
}

