import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type PageHeaderProps = {
  title: string
  /** Uma linha (string) ou conteúdo rico. Preferir título + ajuda (PageHelp) em vez de parágrafos longos. */
  description?: ReactNode
  actions?: ReactNode
  className?: string
  titleId?: string
}

/**
 * Título da tela dentro da barra superior.
 *
 * Era `text-3xl font-black uppercase tracking-[0.2em]` com o subtítulo em 10px — o nome
 * da tela (que você já sabe, porque clicou nela) era o maior elemento da página e a
 * frase que a explica era ilegível. Invertido: título em tamanho de leitura e descrição
 * em corpo normal, tudo numa faixa só.
 */
export function PageHeader({ title, description, actions, className, titleId }: PageHeaderProps) {
  const hasDescription = description != null && description !== ''

  return (
    // Quando a tela tem muitas ações, elas quebram para a linha de baixo em vez de
    // espremer o título até virar "Fernand…" — saber onde você está vem primeiro.
    <div className={cn('flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5', className)}>
      <div className="min-w-[7rem] flex-1">
        <h1 id={titleId} className="truncate text-[15px] font-semibold leading-tight text-foreground sm:text-base">
          {title}
        </h1>
        {hasDescription ? (
          <div className="hidden truncate text-xs leading-tight text-muted-foreground md:block [&_p]:m-0">
            {typeof description === 'string' ? <p className="m-0 truncate">{description}</p> : description}
          </div>
        ) : null}
      </div>
      {/* Ações da tela.
          No desktop quebram em linhas quando não cabem (melhor do que espremer o título).
          No celular viram UMA faixa rolável na horizontal: /pedidos tem quatro ações e,
          empilhadas, o cabeçalho sozinho comia 340px dos 812 da tela, deslizar de lado
          custa menos que perder metade do conteúdo. */}
      {actions ? (
        <div
          className={cn(
            'flex min-w-0 items-center gap-1.5',
            'max-sm:w-full max-sm:flex-nowrap max-sm:justify-start max-sm:overflow-x-auto max-sm:pb-0.5',
            'sm:flex-wrap sm:justify-end',
            '[&>div]:flex [&>div]:items-center [&>div]:gap-1.5',
            'max-sm:[&>div]:flex-nowrap sm:[&>div]:flex-wrap sm:[&>div]:justify-end',
            '[&_button]:shrink-0 [&_a]:shrink-0 [&_label]:shrink-0',
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  )
}
