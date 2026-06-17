/**
 * Estilos coloridos para badges de canal (mensagem) e origem (lead) — usados em
 * LeadChatThread, KanbanLeadCard/ListView, ChatWorkspacePage, HistoryPage e LeadDetailPage.
 *
 * As classes aqui devolvidas já trazem cor, ring suave e tipografia consistente; só falta
 * aplicar num <span> ou <Badge> existente. Para identificação rápida na UI usamos cores
 * tradicionais da marca de cada canal (verde WhatsApp, rosa Instagram, azul Facebook).
 */

export type ChannelKey = 'whatsapp' | 'meta' | 'instagram' | 'facebook' | 'ai' | 'system' | 'manual' | string

type Style = {
  label: string
  /** Classes Tailwind completas para um <span>/<Badge> pequeno (px-1.5 py-0.5 text-[10px]) */
  pill: string
  /** Classe só para o ponto colorido (size-1.5 rounded-full) quando se quer só o dot */
  dot: string
}

const STYLES: Record<string, Style> = {
  whatsapp: {
    label: 'WhatsApp',
    pill:
      'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-400 dark:bg-emerald-500/15',
    dot: 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]',
  },
  meta: {
    // 'meta' nas interactions = Instagram via ManyChat (ver LeadChatThread CHANNEL_SHORT)
    label: 'Instagram',
    pill:
      'bg-pink-500/10 text-pink-700 ring-1 ring-pink-500/25 dark:text-pink-400 dark:bg-pink-500/15',
    dot: 'bg-pink-500 shadow-[0_0_6px_rgba(236,72,153,0.5)]',
  },
  instagram: {
    label: 'Instagram',
    pill:
      'bg-pink-500/10 text-pink-700 ring-1 ring-pink-500/25 dark:text-pink-400 dark:bg-pink-500/15',
    dot: 'bg-pink-500 shadow-[0_0_6px_rgba(236,72,153,0.5)]',
  },
  facebook: {
    label: 'Facebook',
    pill:
      'bg-blue-500/10 text-blue-700 ring-1 ring-blue-500/25 dark:text-blue-400 dark:bg-blue-500/15',
    dot: 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.5)]',
  },
  ai: {
    label: 'IA',
    pill:
      'bg-violet-500/10 text-violet-700 ring-1 ring-violet-500/25 dark:text-violet-400 dark:bg-violet-500/15',
    dot: 'bg-violet-500',
  },
  system: {
    label: 'Sistema',
    pill:
      'bg-slate-500/10 text-slate-600 ring-1 ring-slate-500/20 dark:text-slate-400 dark:bg-slate-500/15',
    dot: 'bg-slate-400',
  },
  manual: {
    label: 'Manual',
    pill:
      'bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-400 dark:bg-amber-500/15',
    dot: 'bg-amber-500',
  },
}

const FALLBACK: Style = {
  label: 'Outro',
  pill: 'bg-muted text-muted-foreground ring-1 ring-border/40',
  dot: 'bg-muted-foreground/50',
}

/** Devolve label curto + classes Tailwind para o canal de uma mensagem (interactions.channel). */
export function getChannelStyle(channel: string | null | undefined): Style {
  const key = String(channel ?? '').trim().toLowerCase()
  if (!key) return FALLBACK
  return STYLES[key] ?? FALLBACK
}

/** Devolve label + classes para a origem de um lead (Lead['source']). */
export function getSourceStyle(source: string | null | undefined): Style {
  const key = String(source ?? '').trim().toLowerCase()
  if (key === 'meta_whatsapp' || key === 'whatsapp') return STYLES.whatsapp
  if (key === 'meta_instagram' || key === 'instagram') return STYLES.instagram
  if (key === 'meta_facebook' || key === 'facebook') return STYLES.facebook
  if (key === 'manual') return STYLES.manual
  return FALLBACK
}

/** Versão curta do label para badges de mensagem (WA, Insta, IA, …). */
export function getChannelShortLabel(channel: string | null | undefined): string {
  const key = String(channel ?? '').trim().toLowerCase()
  if (key === 'whatsapp') return 'WA'
  if (key === 'meta' || key === 'instagram') return 'Insta'
  if (key === 'facebook') return 'FB'
  if (key === 'ai') return 'IA'
  if (key === 'system') return 'Sys'
  if (!key) return '—'
  return key.slice(0, 4).toUpperCase()
}
