import { useMemo, useState } from 'react'

import { SearchField } from '@/components/ui/search-field'
import { Button } from '@/components/ui/button'
import {
  EMOJI_CATEGORIES,
  buscarEmojis,
  guardarEmojiRecente,
  lerEmojisRecentes,
} from '@/lib/emojiData'
import { cn } from '@/lib/utils'

type Props = {
  onPick: (emoji: string) => void
  /** Compacto: usado na barra de reação rápida, sem abas nem busca. */
  compact?: boolean
}

/**
 * O seletor de emojis do compositor: categorias, busca em português e os últimos usados
 * em primeiro. O painel fecha sozinho? Não — quem fecha é o menu que o embrulha. Aqui a
 * escolha é deliberada: numa mensagem entram vários emojis seguidos, e um painel que
 * fechasse a cada clique obrigava a reabrir para cada um.
 */
export function EmojiPicker({ onPick, compact = false }: Props) {
  const [termo, setTermo] = useState('')
  const [aba, setAba] = useState(() => (lerEmojisRecentes().length ? 'recentes' : 'rostos'))
  const [recentes, setRecentes] = useState<string[]>(() => lerEmojisRecentes())

  const resultadoBusca = useMemo(() => (termo.trim() ? buscarEmojis(termo) : null), [termo])

  const escolher = (emoji: string) => {
    setRecentes(guardarEmojiRecente(emoji))
    onPick(emoji)
  }

  const categoriaAtual = EMOJI_CATEGORIES.find((c) => c.id === aba) ?? EMOJI_CATEGORIES[1]
  const emojisVisiveis =
    resultadoBusca ?? (categoriaAtual.id === 'recentes' ? recentes : categoriaAtual.emojis)

  if (compact) {
    return (
      <div className="grid grid-cols-8 gap-0.5">
        {(recentes.length ? recentes.slice(0, 16) : EMOJI_CATEGORIES[1].emojis.slice(0, 16)).map((em) => (
          <Button
            key={em}
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-md text-base font-normal leading-none hover:bg-muted"
            onClick={() => escolher(em)}
          >
            {em}
          </Button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex w-[min(100vw-2rem,20rem)] flex-col gap-2">
      <SearchField
        value={termo}
        onChange={setTermo}
        label="Buscar emoji"
        placeholder="Buscar emoji (ex.: coração, festa, agenda)"
      />

      {!resultadoBusca && (
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border pb-1">
          {EMOJI_CATEGORIES.map((cat) => {
            if (cat.id === 'recentes' && recentes.length === 0) return null
            return (
              <Button
                key={cat.id}
                type="button"
                variant="ghost"
                size="icon"
                title={cat.label}
                aria-label={cat.label}
                aria-pressed={aba === cat.id}
                onClick={() => setAba(cat.id)}
                className={cn(
                  'shrink-0 rounded-md text-base font-normal leading-none',
                  aba === cat.id ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                {cat.icon}
              </Button>
            )
          })}
        </div>
      )}

      <div className="max-h-56 overflow-y-auto">
        {emojisVisiveis.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            {resultadoBusca
              ? 'Nada com esse nome. Tente outra palavra ou escolha pela categoria.'
              : 'Os emojis que você usar aparecem aqui.'}
          </p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {emojisVisiveis.map((em, i) => (
              <Button
                key={`${em}-${i}`}
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-md text-lg font-normal leading-none hover:bg-muted"
                onClick={() => escolher(em)}
              >
                {em}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
