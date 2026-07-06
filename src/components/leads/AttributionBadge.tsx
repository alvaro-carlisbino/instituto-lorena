import { cn } from '@/lib/utils'
import type { Lead } from '@/mocks/crmMock'

const PILL = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider'

/**
 * Selo de ORIGEM DE MÍDIA PAGA do lead no card do Kanban:
 *  - 📋 Form Meta  → formulário Lead Ads (crm-meta-leadform-webhook; attribution.channel='lead_ads')
 *  - 🎯 CTWA       → anúncio de clique pro WhatsApp/Instagram (attribution.channel='ctwa_*')
 *  - 🌐 Site·Ads   → compra/lead do site com UTM/fbclid de anúncio (custom_fields.attribution.first)
 * Sem atribuição → null (não polui o card). O tooltip traz campanha/anúncio quando existem.
 */
export function AttributionBadge({ lead, className }: { lead: Pick<Lead, 'customFields'>; className?: string }) {
  const cf = (lead.customFields ?? {}) as Record<string, unknown>
  const att = (cf.attribution ?? {}) as Record<string, unknown>
  const channel = String(att.channel ?? '')
  const campaign = String(att.campaign ?? '').trim()
  const headline = String(att.headline ?? '').trim()

  let emoji = ''
  let label = ''
  let style = ''
  if (channel === 'lead_ads') {
    emoji = '📋'
    label = 'Form Meta'
    style = 'bg-blue-500/10 text-blue-700 ring-1 ring-blue-500/25 dark:text-blue-300'
  } else if (channel.startsWith('ctwa')) {
    emoji = '🎯'
    label = 'CTWA'
    style = 'bg-fuchsia-500/10 text-fuchsia-700 ring-1 ring-fuchsia-500/25 dark:text-fuchsia-300'
  } else {
    // Lead do SITE: checkout grava attribution {first:{utm_*, fbclid}, last:{...}} (first-touch).
    const first = (att.first ?? {}) as Record<string, unknown>
    const utmSource = String(first.utm_source ?? att.utm_source ?? '').toLowerCase()
    const hasAdClick = Boolean(first.fbclid ?? att.fbclid)
    if (String(cf.origin ?? '') === 'site' && (utmSource || hasAdClick)) {
      emoji = '🌐'
      label = utmSource ? `Site·${utmSource}` : 'Site·Ads'
      style = 'bg-teal-500/10 text-teal-700 ring-1 ring-teal-500/25 dark:text-teal-300'
    }
  }
  if (!label) return null

  const tooltip = ['Origem da campanha', campaign && `Campanha: ${campaign}`, headline && `Anúncio: ${headline}`]
    .filter(Boolean)
    .join(' · ')
  return (
    <span className={cn(PILL, style, className)} title={tooltip}>
      {emoji} {label}
    </span>
  )
}
