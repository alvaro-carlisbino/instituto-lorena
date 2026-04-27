import { Loader2, Scale, Sparkles, User } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ConversationOwnerMode } from '@/services/conversationControl'

type ModeOption = {
  id: ConversationOwnerMode
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
}

const MODES: ModeOption[] = [
  {
    id: 'human',
    label: 'Humano',
    hint: 'Só a equipe responde. A IA não envia mensagens automáticas.',
    icon: User,
  },
  {
    id: 'ai',
    label: 'IA',
    hint: 'A assistente pode responder sozinha, consoante limites e horários nas Configurações.',
    icon: Sparkles,
  },
  {
    id: 'auto',
    label: 'Misto',
    hint: 'Regras (horário, limites) decidem quando a IA responde ou quando fica a aguardar a equipe.',
    icon: Scale,
  },
]

type Props = {
  value: ConversationOwnerMode
  loading?: boolean
  onChange: (next: ConversationOwnerMode) => void
  className?: string
  /** Título curto acima do grupo */
  title?: string
  /** Texto de ajuda por baixo, sincronizado com a opção activa */
  showFooterHint?: boolean
}

export function ConversationModeSwitch({
  value,
  loading = false,
  onChange,
  className,
  title = 'Modo de atendimento',
  showFooterHint = true,
}: Props) {
  return (
    <div className={cn('w-full', className)}>
      <p className="m-0 mb-2 text-xs font-medium tracking-wide text-muted-foreground sm:text-sm">{title}</p>
      <div className="relative w-full max-w-2xl">
        {loading ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/60 backdrop-blur-sm dark:bg-background/80"
            aria-live="polite"
            aria-busy
          >
            <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
            <span className="sr-only">A guardar…</span>
          </div>
        ) : null}
        <div
          className="flex w-full flex-col gap-2 min-[420px]:flex-row min-[420px]:gap-1.5 min-[420px]:rounded-2xl min-[420px]:border min-[420px]:border-border/80 min-[420px]:bg-muted/20 min-[420px]:p-1.5"
          role="radiogroup"
          aria-label="Modo de atendimento: humano, assistente, ou misto"
        >
          {MODES.map((m) => {
            const active = value === m.id
            const Icon = m.icon
            return (
              <button
                key={m.id}
                type="button"
                title={m.hint}
                disabled={loading}
                onClick={() => onChange(m.id)}
                className={cn(
                  'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border-2 px-3 py-2.5 text-sm font-semibold transition-all sm:min-h-0 sm:py-3',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed',
                  active
                    ? 'border-primary bg-primary text-primary-foreground shadow-md ring-1 ring-primary/25 min-[420px]:shadow-sm'
                    : 'border-border/60 bg-card text-foreground shadow-sm hover:border-primary/45 hover:bg-muted/50',
                )}
                role="radio"
                aria-checked={active}
                aria-label={`${m.label}. ${m.hint}`}
              >
                <Icon
                  className={cn('size-4 shrink-0 sm:size-5', active ? 'text-primary-foreground' : 'text-primary')}
                  aria-hidden
                />
                {m.label}
              </button>
            )
          })}
        </div>
        {showFooterHint ? (
          <p className="m-0 mt-2.5 text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
            {MODES.find((m) => m.id === value)?.hint}
          </p>
        ) : null}
      </div>
    </div>
  )
}
