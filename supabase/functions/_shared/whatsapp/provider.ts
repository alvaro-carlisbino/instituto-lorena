import { EvolutionProvider } from './evolution.ts'
import { OfficialWhatsappProvider } from './official.ts'
import type { WhatsappProvider } from './types.ts'

export function getWhatsappProviderFromEnv(): WhatsappProvider {
  const provider = (Deno.env.get('WHATSAPP_PROVIDER') ?? 'evolution').trim().toLowerCase()
  if (provider === 'official') return new OfficialWhatsappProvider()
  return new EvolutionProvider()
}

