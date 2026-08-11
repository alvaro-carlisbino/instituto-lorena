import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type PickerItem = {
  id: string
  label: string
  /** Segunda linha: telefone, categoria, SKU — o que desempata dois nomes iguais. */
  hint?: string
  /** Canto direito: preço, saldo, sessões. */
  meta?: string
  /** Texto extra que a busca enxerga mas a tela não mostra (CPF, código). */
  searchable?: string
}

type Props = {
  /** Item escolhido hoje, para o botão mostrar em vez do placeholder. */
  value?: PickerItem | null
  onPick: (item: PickerItem) => void
  onClear?: () => void
  /** Lista pronta em memória — filtro no cliente. Use `onSearch` quando a lista é grande demais para carregar. */
  items?: PickerItem[]
  /** Busca no servidor (paciente: são 2.620). Recebe o termo já com 2+ caracteres. */
  onSearch?: (term: string) => Promise<PickerItem[]>
  placeholder?: string
  /** Título do modal. */
  title?: string
  searchPlaceholder?: string
  emptyLabel?: string
  disabled?: boolean
  className?: string
  /** Altura do botão, para caber em linha de tabela (h-8). */
  size?: 'sm' | 'default'
}

const normalizar = (v: string) =>
  v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * Escolha de paciente, protocolo, produto e afins: botão que abre um MODAL DE BUSCA.
 *
 * O que substitui: `<Select>` com a lista inteira dentro. Funciona com dez opções e
 * desmonta com duzentas — escolher paciente virava rolar 200 nomes num popover, sem
 * digitar, sem telefone à vista para desempatar homônimo. Em tela de clínica isso não é
 * incômodo, é risco: paciente errado escolhido é procedimento no prontuário errado.
 *
 * Aqui: digita, vê nome + telefone/categoria, navega com as setas e confirma com Enter.
 * A busca ignora acento e caixa, e enxerga `searchable` (CPF, SKU) sem poluir a tela.
 *
 * Dois modos: `items` (lista em memória, filtro no cliente) ou `onSearch` (servidor).
 */
export function SearchPicker({
  value,
  onPick,
  onClear,
  items,
  onSearch,
  placeholder = 'Escolher…',
  title,
  searchPlaceholder = 'Digite para buscar…',
  emptyLabel = 'Nada encontrado.',
  disabled,
  className,
  size = 'default',
}: Props) {
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [remotos, setRemotos] = useState<PickerItem[]>([])
  const [buscando, setBuscando] = useState(false)
  const [cursor, setCursor] = useState(0)
  const listaRef = useRef<HTMLDivElement>(null)

  // Busca no servidor, com respiro de 180ms para não disparar a cada tecla.
  useEffect(() => {
    if (!onSearch || !aberto) return
    const q = termo.trim()
    if (q.length < 2) {
      setRemotos([])
      return
    }
    let cancelado = false
    setBuscando(true)
    const t = window.setTimeout(() => {
      onSearch(q)
        .then((r) => !cancelado && setRemotos(r))
        .catch(() => !cancelado && setRemotos([]))
        .finally(() => !cancelado && setBuscando(false))
    }, 180)
    return () => {
      cancelado = true
      window.clearTimeout(t)
    }
  }, [termo, aberto, onSearch])

  const resultados = useMemo(() => {
    if (onSearch) return remotos
    const base = items ?? []
    const q = normalizar(termo.trim())
    if (!q) return base.slice(0, 100)
    return base
      .filter((i) => normalizar(`${i.label} ${i.hint ?? ''} ${i.searchable ?? ''}`).includes(q))
      .slice(0, 100)
  }, [items, onSearch, remotos, termo])

  useEffect(() => setCursor(0), [termo, aberto])

  // Mantém o item sob o cursor visível quando se navega pelo teclado.
  useEffect(() => {
    const el = listaRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const escolher = (item: PickerItem) => {
    onPick(item)
    setAberto(false)
    setTermo('')
  }

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, resultados.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && resultados[cursor]) {
      e.preventDefault()
      escolher(resultados[cursor])
    }
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => setAberto(true)}
          className={cn(
            'w-full justify-between gap-2 font-normal',
            size === 'sm' && 'h-8 text-xs',
            !value && 'text-muted-foreground',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Search className="size-3.5 shrink-0 opacity-60" aria-hidden />
            <span className="truncate">{value ? value.label : placeholder}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
        </Button>
        {value && onClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('shrink-0 px-2', size === 'sm' && 'h-8')}
            aria-label="Limpar seleção"
            onClick={onClear}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{title ?? placeholder}</DialogTitle>
          </DialogHeader>

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              autoFocus
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={teclado}
              placeholder={searchPlaceholder}
              aria-label={title ?? placeholder}
              className="h-11 pl-9"
            />
          </div>

          <div ref={listaRef} className="max-h-80 overflow-y-auto rounded-md border border-border">
            {resultados.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {buscando
                  ? 'Buscando…'
                  : onSearch && termo.trim().length < 2
                    ? 'Digite ao menos 2 letras.'
                    : emptyLabel}
              </p>
            ) : (
              resultados.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  data-idx={idx}
                  onMouseEnter={() => setCursor(idx)}
                  onClick={() => escolher(item)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5 text-left last:border-0',
                    idx === cursor && 'bg-muted',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    {item.hint && (
                      <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {item.meta && <span className="text-xs text-muted-foreground">{item.meta}</span>}
                    {value?.id === item.id && <Check className="size-3.5 text-primary" />}
                  </span>
                </button>
              ))
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Setas para navegar, Enter para escolher, Esc para fechar.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
