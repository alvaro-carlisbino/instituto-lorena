import { format, isSameYear, isToday, isYesterday } from 'date-fns'
import { ptBR } from 'date-fns/locale'

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Carimbo curto da lista de conversas: hora se for hoje, "ontem", senão dd/MM
 * (dd/MM/yy em anos anteriores). Mostra a DATA da conversa, não só a hora.
 */
export function formatConversationStamp(iso: string | null | undefined): string {
  const d = toDate(iso)
  if (!d) return ''
  if (isToday(d)) return format(d, 'HH:mm', { locale: ptBR })
  if (isYesterday(d)) return 'ontem'
  return format(d, isSameYear(d, new Date()) ? 'dd/MM' : 'dd/MM/yy', { locale: ptBR })
}

/**
 * Data + hora da última mensagem, para o cabeçalho da conversa aberta.
 */
export function formatConversationHeaderStamp(iso: string | null | undefined): string {
  const d = toDate(iso)
  if (!d) return ''
  const time = format(d, 'HH:mm', { locale: ptBR })
  if (isToday(d)) return `Hoje · ${time}`
  if (isYesterday(d)) return `Ontem · ${time}`
  if (isSameYear(d, new Date())) return format(d, "d 'de' MMM · HH:mm", { locale: ptBR })
  return format(d, "dd/MM/yyyy · HH:mm", { locale: ptBR })
}

/**
 * Rótulo do separador de dia entre grupos de mensagens (estilo WhatsApp):
 * "Hoje", "Ontem", "18 de junho" (ou com ano se for de outro ano).
 */
export function formatDaySeparator(iso: string | null | undefined): string {
  const d = toDate(iso)
  if (!d) return ''
  if (isToday(d)) return 'Hoje'
  if (isYesterday(d)) return 'Ontem'
  if (isSameYear(d, new Date())) return format(d, "d 'de' MMMM", { locale: ptBR })
  return format(d, "d 'de' MMMM 'de' yyyy", { locale: ptBR })
}
