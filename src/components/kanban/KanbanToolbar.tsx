import { LayoutGrid, List, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { labelForIdName } from '@/lib/selectDisplay'
import { cn } from '@/lib/utils'

type Temperature = 'all' | 'hot' | 'warm' | 'cold'

const TEMP_OPTIONS: { value: Temperature; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'hot', label: 'Quente' },
  { value: 'warm', label: 'Morna' },
  { value: 'cold', label: 'Fria' },
]

type Props = {
  pipelineId: string
  pipelineOptions: { id: string; name: string }[]
  onPipelineChange: (id: string) => void
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
}

export function KanbanToolbar({
  pipelineId,
  pipelineOptions,
  onPipelineChange,
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
}: Props) {
  const pipelineLabel = labelForIdName(
    pipelineId,
    pipelineOptions,
    undefined,
    'Funil',
  )
  const ownerLabel = labelForIdName(
    ownerFilter,
    ownerOptions,
    { value: 'all', label: 'Todos' },
    'Responsável',
  )
  const tagLabel = labelForIdName(
    tagFilter,
    tagOptions,
    { value: 'all', label: 'Todas as etiquetas' },
    'Etiqueta',
  )

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div
          className="inline-flex w-full min-w-0 max-w-full rounded-xl border border-border/70 bg-muted/15 p-0.5 sm:w-auto"
          role="group"
          aria-label="Modo de visualização do quadro"
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              'h-8 flex-1 gap-1.5 rounded-lg sm:flex-none',
              viewMode === 'board' && 'bg-background text-foreground shadow-sm',
            )}
            aria-pressed={viewMode === 'board'}
            onClick={() => onViewModeChange('board')}
            title="Colunas (kanban)"
          >
            <LayoutGrid className="size-3.5 shrink-0" />
            <span className="text-xs font-medium">Colunas</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              'h-8 flex-1 gap-1.5 rounded-lg sm:flex-none',
              viewMode === 'list' && 'bg-background text-foreground shadow-sm',
            )}
            aria-pressed={viewMode === 'list'}
            onClick={() => onViewModeChange('list')}
            title="Lista"
          >
            <List className="size-3.5 shrink-0" />
            <span className="text-xs font-medium">Lista</span>
          </Button>
        </div>

        <Select value={pipelineId} onValueChange={(v) => v && onPipelineChange(v)}>
          <LabeledSelectTrigger
            className="w-full min-w-[12rem] sm:w-[min(100%,13rem)] rounded-xl border-border/70 text-xs font-medium"
            size="default"
          >
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

        <Select value={ownerFilter} onValueChange={(v) => v && onOwnerChange(v)}>
          <LabeledSelectTrigger
            className="w-full min-w-[12rem] sm:w-[min(100%,11rem)] rounded-xl border-border/70 text-xs font-medium"
            size="default"
          >
            {ownerLabel}
          </LabeledSelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {ownerOptions.map((owner) => (
              <SelectItem key={owner.id} value={owner.id}>
                {owner.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={tagFilter} onValueChange={(v) => v && onTagFilterChange(v)}>
          <LabeledSelectTrigger
            className="w-full min-w-[10rem] sm:w-[min(100%,10rem)] rounded-xl border-border/70 text-xs font-medium"
            size="default"
          >
            {tagLabel}
          </LabeledSelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as etiquetas</SelectItem>
            {tagOptions.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <InputGroup className="w-full max-w-md sm:min-w-[14rem] sm:flex-1">
          <InputGroupAddon>
            <Search aria-hidden />
            <span className="sr-only">Buscar</span>
          </InputGroupAddon>
          <InputGroupInput
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar paciente ou resumo"
            aria-label="Buscar paciente ou resumo"
          />
        </InputGroup>

        <div
          role="group"
          aria-label="Filtrar por temperatura"
          className="flex w-full flex-wrap gap-1 rounded-xl border border-border/70 bg-muted/20 p-1 sm:w-auto"
        >
          {TEMP_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={temperatureFilter === opt.value ? 'secondary' : 'ghost'}
              className={cn(
                'h-7 flex-1 rounded-md sm:flex-none',
                temperatureFilter === opt.value && 'bg-background shadow-sm ring-1 ring-border'
              )}
              onClick={() => onTemperatureChange(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
