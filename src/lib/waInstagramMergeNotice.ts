import type { Interaction } from '@/mocks/crmMock'

/** Mirror `supabase/functions/_shared/waInstagramMergeNotice.ts` — keep text identical. */
export const WA_INSTAGRAM_MERGE_NOTICE_CONTENT =
  'Canal WhatsApp vinculado: contacto reconhecido via Instagram. Telefone real atualizado.' as const

export function isWaInstagramMergeNotice(
  interaction: Pick<Interaction, 'channel' | 'direction' | 'content'>,
): boolean {
  return (
    interaction.channel === 'system' &&
    interaction.direction === 'system' &&
    interaction.content === WA_INSTAGRAM_MERGE_NOTICE_CONTENT
  )
}

const toastedWaIgMergeIds = new Set<string>()
const RECENT_TOAST_MS = 12 * 60 * 1000

/** Returns true once per interaction id when event is recent enough for a live toast. */
export function tryConsumeWaInstagramMergeToast(
  interaction: Pick<Interaction, 'id' | 'happenedAt'>,
): boolean {
  const age = Date.now() - new Date(interaction.happenedAt).getTime()
  if (age > RECENT_TOAST_MS || age < -60_000) return false
  if (toastedWaIgMergeIds.has(interaction.id)) return false
  toastedWaIgMergeIds.add(interaction.id)
  return true
}
