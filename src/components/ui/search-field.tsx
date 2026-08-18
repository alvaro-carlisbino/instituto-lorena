import { useId } from 'react'
import { Search, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Props = {
  value: string
  onChange: (valor: string) => void
  /**
   * O que a busca procura, em uma frase. Vira o placeholder E o rótulo lido pelo
   * leitor de tela: campo de busca sem rótulo é anunciado como "editar texto" e
   * quem não vê a lupa não descobre para que serve.
   */
  label: string
  placeholder?: string
  /** Quantos resultados o termo achou. Anunciado em região viva, sem roubar o foco. */
  resultados?: number
  className?: string
  disabled?: boolean
  autoFocus?: boolean
}

/**
 * Barra de busca das telas de lista.
 *
 * Antes cada tela repetia `div.relative` + lupa absoluta + Input, e o rótulo
 * acessível dependia de quem lembrasse de escrever `aria-label` na mão. Aqui o
 * rótulo é obrigatório por tipo, Esc limpa (o reflexo de todo mundo), e existe
 * um botão de limpar de verdade — o "x" nativo do `type=search` não aparece no
 * Firefox e não tem nome acessível em lugar nenhum.
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  resultados,
  className,
  disabled,
  autoFocus,
}: Props) {
  const id = useId()
  const temTermo = value.length > 0

  return (
    <div className={cn('relative min-w-0', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={id}
        type="search"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={label}
        placeholder={placeholder ?? label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && temTermo) {
            e.preventDefault()
            onChange('')
          }
        }}
        className={cn('pl-8 [&::-webkit-search-cancel-button]:appearance-none', temTermo && 'pr-8')}
      />
      {temTermo && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={`Limpar busca de ${label.toLowerCase()}`}
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
      {/* Sem isto, quem usa leitor de tela digita e não recebe notícia nenhuma da lista. */}
      <span aria-live="polite" className="sr-only">
        {temTermo && resultados != null
          ? `${resultados} ${resultados === 1 ? 'resultado' : 'resultados'} para ${value}`
          : ''}
      </span>
    </div>
  )
}
