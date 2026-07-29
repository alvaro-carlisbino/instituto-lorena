import { useState, type ReactNode } from 'react'
import { ListFilter, Search, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type FilterOption = { value: string; label: string }

export type FilterDef = {
  id: string
  label: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
  disabled?: boolean
  /** Valor que significa "sem filtro". Padrão 'all'. */
  emptyValue?: string
}

type FilterBarProps = {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  searchLabel?: string
  filters?: FilterDef[]
  /** Controle sempre visível antes da busca (ex.: qual funil o quadro mostra). */
  leading?: ReactNode
  /** Controles extras à direita (alternar visão, exportar, colunas). */
  trailing?: ReactNode
  className?: string
}

/**
 * Barra de filtros padrão das telas de lista.
 *
 * Substitui os blocos de filtro que ficavam sempre abertos ocupando ~300px de altura —
 * em /leads a tabela começava em 765px num viewport de 720px, ou seja, nenhum lead
 * aparecia sem rolar. Aqui a busca fica sempre à mão, os seletores só abrem quando
 * pedidos, e o que está filtrado agora vira etiqueta visível (antes você precisava
 * reler cada seletor para descobrir por que a lista estava curta).
 */
export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Buscar…',
  searchLabel = 'Buscar',
  filters = [],
  leading,
  trailing,
  className,
}: FilterBarProps) {
  const [open, setOpen] = useState(false)

  const isSet = (filter: FilterDef) => filter.value !== (filter.emptyValue ?? 'all')
  const active = filters.filter(isSet)

  const labelFor = (filter: FilterDef) =>
    filter.options.find((option) => option.value === filter.value)?.label ?? filter.value

  const clearAll = () => {
    for (const filter of filters) filter.onChange(filter.emptyValue ?? 'all')
    onSearchChange('')
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {leading ? <div className="flex shrink-0 items-center gap-2">{leading}</div> : null}
        <div className="relative min-w-0 flex-1 basis-56">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
            className="h-9 pl-9 pr-8"
          />
          {searchValue ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Limpar busca"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>

        {filters.length > 0 ? (
          <Button
            type="button"
            variant={active.length > 0 ? 'secondary' : 'outline'}
            size="sm"
            className="h-9 shrink-0"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ListFilter className="size-4" aria-hidden />
            Filtros
            {active.length > 0 ? (
              <Badge className="ml-0.5 h-5 min-w-5 justify-center px-1 tabular-nums">{active.length}</Badge>
            ) : null}
          </Button>
        ) : null}

        {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
      </div>

      {/* Etiquetas do que está filtrado: dá para ver e desfazer sem abrir o painel. */}
      {active.length > 0 || searchValue ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {searchValue ? (
            <Badge variant="secondary" className="gap-1 font-normal">
              <span className="max-w-40 truncate">Busca: {searchValue}</span>
              <button type="button" onClick={() => onSearchChange('')} aria-label="Remover filtro de busca">
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          ) : null}
          {active.map((filter) => (
            <Badge key={filter.id} variant="secondary" className="gap-1 font-normal">
              <span className="max-w-48 truncate">
                {filter.label}: {labelFor(filter)}
              </span>
              <button
                type="button"
                onClick={() => filter.onChange(filter.emptyValue ?? 'all')}
                aria-label={`Remover filtro ${filter.label}`}
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clearAll}>
            Limpar tudo
          </Button>
        </div>
      ) : null}

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleContent>
          <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
            {filters.map((filter) => (
              <div key={filter.id} className="flex min-w-0 flex-col gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">{filter.label}</Label>
                <Select
                  value={filter.value}
                  onValueChange={(value) => value && filter.onChange(value)}
                  disabled={filter.disabled}
                >
                  <LabeledSelectTrigger aria-label={`Filtrar por ${filter.label}`} className="h-9" size="default">
                    {labelFor(filter)}
                  </LabeledSelectTrigger>
                  <SelectContent>
                    {filter.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
