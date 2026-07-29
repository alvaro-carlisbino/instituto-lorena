import { Loader2, Scale, Sparkles, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
    hint: 'A assistente pode responder sozinha, conforme limites e horários nas Configurações.',
    icon: Sparkles,
  },
  {
    id: 'auto',
    label: 'Misto',
    hint: 'Regras (horário, limites) decidem quando a IA responde ou quando fica aguardando a equipe.',
    icon: Scale,
  },
]

type Props = {
  value: ConversationOwnerMode
  loading?: boolean
  onChange: (next: ConversationOwnerMode) => void
  className?: string
  /** Título curto acima do grupo (só na variante 'full'). */
  title?: string
  /** Texto de ajuda por baixo, sincronizado com a opção ativa (só na variante 'full'). */
  showFooterHint?: boolean
  /**
   * 'compact' — controle segmentado de uma linha, para o cabeçalho da conversa.
   * 'full' — com título e explicação, para a tela de Configurações.
   */
  variant?: 'compact' | 'full'
}

/**
 * Escolha de quem responde a conversa.
 *
 * Na tela de chat era um bloco de três botões grandes com título e parágrafo de ajuda:
 * junto com os chips de canal, consumia ~450px dos 812 do celular ANTES da primeira
 * mensagem — numa tela cuja razão de existir é ler a conversa. A explicação continua
 * disponível (tooltip aqui, texto completo nas Configurações), mas não ocupa mais a
 * tela toda a cada conversa aberta.
 */
export function ConversationModeSwitch({
  value,
  loading = false,
  onChange,
  className,
  title = 'Modo de atendimento',
  showFooterHint = true,
  variant = 'full',
}: Props) {
  if (variant === 'compact') {
    return (
      <div
        className={cn('relative inline-flex shrink-0 items-center rounded-lg bg-muted/60 p-0.5', className)}
        role="radiogroup"
        aria-label="Modo de atendimento: humano, assistente, ou misto"
      >
        {loading ? (
          <span className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/70" aria-live="polite" aria-busy>
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
            <span className="sr-only">Salvando…</span>
          </span>
        ) : null}
        {MODES.map((mode) => {
          const active = value === mode.id
          const Icon = mode.icon
          return (
            <Tooltip key={mode.id}>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={loading}
                    onClick={() => onChange(mode.id)}
                    role="radio"
                    aria-checked={active}
                    aria-label={`${mode.label}. ${mode.hint}`}
                    className={cn(
                      'h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium',
                      active
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className={cn('size-3.5 shrink-0', active && 'text-primary')} aria-hidden />
                    {mode.label}
                  </Button>
                }
              />
              <TooltipContent className="max-w-64">{mode.hint}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    )
  }

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
            <span className="sr-only">Salvando…</span>
          </div>
        ) : null}
        <div
          className="flex w-full flex-col gap-2 min-[360px]:flex-row min-[360px]:gap-1.5 min-[360px]:rounded-2xl min-[360px]:border min-[360px]:border-border/80 min-[360px]:bg-muted/20 min-[360px]:p-1.5"
          role="radiogroup"
          aria-label="Modo de atendimento: humano, assistente, ou misto"
        >
          {MODES.map((m) => {
            const active = value === m.id
            const Icon = m.icon
            return (
              <Button
                key={m.id}
                type="button"
                variant="ghost"
                title={m.hint}
                disabled={loading}
                onClick={() => onChange(m.id)}
                className={cn(
                  'h-auto min-h-12 flex-1 justify-center gap-2 rounded-2xl border-2 px-3 py-2.5 text-sm font-semibold transition-all sm:min-h-0 sm:py-3',
                  active
                    ? 'border-primary bg-primary text-primary-foreground shadow-md ring-1 ring-primary/25 hover:bg-primary hover:text-primary-foreground min-[360px]:shadow-sm'
                    : 'border-border/60 bg-card text-foreground shadow-sm hover:border-primary/45 hover:bg-muted/50 hover:text-foreground',
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
              </Button>
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
