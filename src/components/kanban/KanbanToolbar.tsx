import { useMemo } from 'react'
import { LayoutGrid, List } from 'lucide-react'

import { FilterBar, type FilterDef } from '@/components/page/FilterBar'
import { Button } from '@/components/ui/button'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { labelForIdName } from '@/lib/selectDisplay'
import { DELIVERY_FILTER_OPTIONS, type DeliveryKind } from '@/lib/deliveryType'
import { cn } from '@/lib/utils'

type Temperature = 'all' | 'hot' | 'warm' | 'cold'
export type SortOption = 'position' | 'idle_time' | 'score'

export type ConversationFilterOption = 'all' | 'new' | 'ai_triaging' | 'waiting_human' | 'human_active'

const TEMP_OPTIONS: { value: Temperature; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'hot', label: 'Quente' },
  { value: 'warm', label: 'Morna' },
  { value: 'cold', label: 'Fria' },
]

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'position', label: 'Ordem padrão' },
  { value: 'idle_time', label: 'Mais tempo sem resposta' },
  { value: 'score', label: 'Melhor score' },
]

const CONVERSATION_OPTIONS: { value: ConversationFilterOption; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'new', label: 'Novo' },
  { value: 'ai_triaging', label: 'Triagem IA' },
  { value: 'waiting_human', label: 'Aguardando SDR' },
  { value: 'human_active', label: 'Atendimento humano' },
]

type Props = {
  pipelineId: string
  pipelineOptions: { id: string; name: string }[]
  onPipelineChange: (id: string) => void
  /** Filtro de Polo (tenant). Só renderiza quando há ≥2 polos visíveis. */
  poloFilter?: string
  onPoloChange?: (value: string) => void
  poloOptions?: { id: string; name: string }[]
  searchTerm: string
  onSearchChange: (value: string) => void
  temperatureFilter: Temperature
  onTemperatureChange: (value: Temperature) => void
  ownerFilter: string
  onOwnerChange: (value: string) => void
  ownerOptions: { id: string; name: string }[]
  tagFilter: string
  onTagFilterChange: (value: string) => void
  tagOptions: { id: string; name: string }[]
  viewMode: 'board' | 'list'
  onViewModeChange: (mode: 'board' | 'list') => void
  sortOrder: SortOption
  onSortOrderChange: (order: SortOption) => void
  conversationFilter: ConversationFilterOption
  onConversationFilterChange: (value: ConversationFilterOption) => void
  deliveryFilter: 'all' | DeliveryKind
  onDeliveryFilterChange: (value: 'all' | DeliveryKind) => void
}

/**
 * Barra do quadro de leads.
 *
 * Antes eram seis seletores de 140px disputando a linha com uma busca de 560px fixos:
 * em 1280px eles empilhavam e passavam por cima do alternador Quadro/Lista — a primeira
 * coisa que se via ao abrir o funil era a barra quebrada. Agora usa a mesma FilterBar
 * das outras listas: o funil (que define QUAL quadro você vê) fica sempre à mão, os
 * filtros abrem sob demanda e o que está ativo aparece como etiqueta.
 */
export function KanbanToolbar({
  pipelineId,
  pipelineOptions,
  onPipelineChange,
  poloFilter,
  onPoloChange,
  poloOptions,
  searchTerm,
  onSearchChange,
  temperatureFilter,
  onTemperatureChange,
  ownerFilter,
  onOwnerChange,
  ownerOptions,
  tagFilter,
  onTagFilterChange,
  tagOptions,
  viewMode,
  onViewModeChange,
  sortOrder,
  onSortOrderChange,
  conversationFilter,
  onConversationFilterChange,
  deliveryFilter,
  onDeliveryFilterChange,
}: Props) {
  const showPolo = !!poloOptions && poloOptions.length >= 2 && !!onPoloChange

  const pipelineLabel = labelForIdName(pipelineId, pipelineOptions, undefined, 'Funil')

  const filters = useMemo<FilterDef[]>(() => {
    const defs: FilterDef[] = []

    if (showPolo) {
      defs.push({
        id: 'polo',
        label: 'Polo',
        value: poloFilter ?? 'all',
        onChange: (value) => onPoloChange?.(value),
        options: [
          { value: 'all', label: 'Todos os polos' },
          ...(poloOptions ?? []).map((polo) => ({ value: polo.id, label: polo.name })),
        ],
      })
    }

    defs.push(
      {
        id: 'owner',
        label: 'Responsável',
        value: ownerFilter,
        onChange: onOwnerChange,
        options: [
          { value: 'all', label: 'Todos' },
          ...ownerOptions.map((owner) => ({ value: owner.id, label: owner.name })),
        ],
      },
      {
        id: 'temperature',
        label: 'Interesse',
        value: temperatureFilter,
        onChange: (value) => onTemperatureChange(value as Temperature),
        options: TEMP_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
      },
      {
        id: 'tag',
        label: 'Etiqueta',
        value: tagFilter,
        onChange: onTagFilterChange,
        options: [
          { value: 'all', label: 'Todas as etiquetas' },
          ...tagOptions.map((tag) => ({ value: tag.id, label: tag.name })),
        ],
      },
      {
        id: 'conversation',
        label: 'Conversa',
        value: conversationFilter,
        onChange: (value) => onConversationFilterChange(value as ConversationFilterOption),
        options: CONVERSATION_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
      },
      {
        id: 'delivery',
        label: 'Entrega',
        value: deliveryFilter,
        onChange: (value) => onDeliveryFilterChange(value as 'all' | DeliveryKind),
        options: [{ value: 'all', label: 'Todas' }, ...DELIVERY_FILTER_OPTIONS],
      },
      {
        id: 'sort',
        label: 'Ordenar por',
        value: sortOrder,
        onChange: (value) => onSortOrderChange(value as SortOption),
        // 'position' é a ordem natural do quadro, então conta como "sem ordenação".
        emptyValue: 'position',
        options: SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
      },
    )

    return defs
  }, [
    showPolo,
    poloFilter,
    poloOptions,
    onPoloChange,
    ownerFilter,
    onOwnerChange,
    ownerOptions,
    temperatureFilter,
    onTemperatureChange,
    tagFilter,
    onTagFilterChange,
    tagOptions,
    conversationFilter,
    onConversationFilterChange,
    deliveryFilter,
    onDeliveryFilterChange,
    sortOrder,
    onSortOrderChange,
  ])

  return (
    <FilterBar
      className="mb-4 border-b border-border/40 pb-4"
      searchValue={searchTerm}
      onSearchChange={onSearchChange}
      searchPlaceholder="Buscar por nome, telefone ou resumo…"
      searchLabel="Buscar paciente no funil"
      filters={filters}
      leading={
        <Select value={pipelineId} onValueChange={(value) => value && onPipelineChange(value)}>
          <LabeledSelectTrigger aria-label="Escolher funil" className="h-9 w-44" size="default">
            {pipelineLabel}
          </LabeledSelectTrigger>
          <SelectContent>
            {pipelineOptions.map((pipeline) => (
              <SelectItem key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      trailing={
        <div className="inline-flex shrink-0 rounded-lg bg-muted/60 p-0.5" role="group" aria-label="Modo de visualização">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={viewMode === 'board'}
            className={cn(
              'h-8 gap-1.5 rounded-md px-3',
              viewMode === 'board' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
            )}
            onClick={() => onViewModeChange('board')}
          >
            <LayoutGrid className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Quadro</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={viewMode === 'list'}
            className={cn(
              'h-8 gap-1.5 rounded-md px-3',
              viewMode === 'list' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
            )}
            onClick={() => onViewModeChange('list')}
          >
            <List className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">Lista</span>
          </Button>
        </div>
      }
    />
  )
}
