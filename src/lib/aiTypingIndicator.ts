import type { Interaction } from '@/mocks/crmMock'
import type { ConversationOwnerMode } from '@/services/conversationControl'

export type AiConversationGate = {
  ownerMode: ConversationOwnerMode
  aiEnabled: boolean
  /** Hora local 0–23 início da janela em modo `auto` (omissão 8) */
  businessHoursStartHour?: number
  /** Hora local exclusiva fim (omissão 20 → activo até 19:59) */
  businessHoursEndHour?: number
}

function parseHourFromConfig(value: string | null | undefined, fallback: number): number {
  if (!value || typeof value !== 'string') return fallback
  const h = Number.parseInt(value.split(':')[0] ?? '', 10)
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : fallback
}

export function businessHoursFromAiConfig(cfg: {
  business_hours_start?: string | null
  business_hours_end?: string | null
}): { startHour: number; endHour: number } {
  return {
    startHour: parseHourFromConfig(cfg.business_hours_start, 8),
    endHour: parseHourFromConfig(cfg.business_hours_end, 20),
  }
}

function isWithinBusinessHoursLocal(now: Date, startHour: number, endHour: number): boolean {
  const h = now.getHours()
  return h >= startHour && h < endHour
}

function isFromAiAssistant(author: string): boolean {
  return /assistente\s*ia/i.test(author.trim())
}

/**
 * Indica se é provável que a IA automática esteja a gerar/enviar resposta ao paciente.
 * Evita que a equipa responda em duplicado nos segundos após uma entrada WhatsApp/Meta.
 */
export function isAiReplyLikelyPending(args: {
  history: Interaction[]
  gate: AiConversationGate
  now?: Date
  /** Máx. tempo após a última entrada do paciente para mostrar o indicador */
  windowMs?: number
}): boolean {
  const now = args.now ?? new Date()
  const windowMs = args.windowMs ?? 95_000

  if (!args.gate.aiEnabled) return false
  if (args.gate.ownerMode === 'human') return false

  const startH = args.gate.businessHoursStartHour ?? 8
  const endH = args.gate.businessHoursEndHour ?? 20
  if (args.gate.ownerMode === 'auto' && !isWithinBusinessHoursLocal(now, startH, endH)) {
    return false
  }

  const sorted = [...args.history].sort(
    (a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime(),
  )
  const last = sorted[sorted.length - 1]
  if (!last || last.direction !== 'in') return false
  if (last.channel !== 'whatsapp' && last.channel !== 'meta') return false

  const lastTs = new Date(last.happenedAt).getTime()
  if (now.getTime() - lastTs > windowMs) return false

  const afterOrAtInbound = sorted.filter((i) => new Date(i.happenedAt).getTime() >= lastTs - 500)

  const aiOutAfter = afterOrAtInbound.some((i) => i.direction === 'out' && isFromAiAssistant(i.author))
  if (aiOutAfter) return false

  const humanOutAfter = afterOrAtInbound.some(
    (i) => i.direction === 'out' && !isFromAiAssistant(i.author),
  )
  if (humanOutAfter) return false

  return true
}
