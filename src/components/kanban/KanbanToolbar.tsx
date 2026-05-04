import { LayoutGrid, List, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { labelForIdName } from '@/lib/selectDisplay'
import { cn } from '@/lib/utils'

type Temperature = 'all' | 'hot' | 'warm' | 'cold'
export type SortOption = 'position' | 'idle_time' | 'score'

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
  sortOrder: SortOption
  onSortOrderChange: (order: SortOption) => void
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
  sortOrder,
  onSortOrderChange,
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
    <div className="flex flex-col gap-5 border-b border-border/20 pb-6 mb-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center flex-1 min-w-0">
          <div
            className="inline-flex shrink-0 rounded-xl bg-muted/40 p-1.5 backdrop-blur-sm"
            role="group"
            aria-label="Modo de visualização"
          >
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                'h-8 px-4 gap-2 rounded-lg transition-all duration-200',
                viewMode === 'board' 
                  ? 'bg-background text-primary shadow-sm ring-1 ring-border/50' 
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => onViewModeChange('board')}
            >
              <LayoutGrid className="size-3.5" />
              <span className="text-[11px] font-bold uppercase tracking-wider">Quadro</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                'h-8 px-4 gap-2 rounded-lg transition-all duration-200',
                viewMode === 'list' 
                  ? 'bg-background text-primary shadow-sm ring-1 ring-border/50' 
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => onViewModeChange('list')}
            >
              <List className="size-3.5" />
              <span className="text-[11px] font-bold uppercase tracking-wider">Lista</span>
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Select value={pipelineId} onValueChange={(v) => v && onPipelineChange(v)}>
              <LabeledSelectTrigger
                className="min-w-[140px] rounded-xl border-border/40 bg-muted/20 text-xs font-bold uppercase tracking-tight"
                size="default"
              >
                {pipelineLabel}
              </LabeledSelectTrigger>
              <SelectContent className="rounded-xl">
                {pipelineOptions.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id} className="text-xs uppercase font-bold tracking-tight">
                    {pipeline.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={ownerFilter} onValueChange={(v) => v && onOwnerChange(v)}>
              <LabeledSelectTrigger
                className="min-w-[140px] rounded-xl border-border/40 bg-muted/20 text-xs font-bold uppercase tracking-tight"
                size="default"
              >
                {ownerLabel}
              </LabeledSelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="text-xs uppercase font-bold tracking-tight">Todos</SelectItem>
                {ownerOptions.map((owner) => (
                  <SelectItem key={owner.id} value={owner.id} className="text-xs uppercase font-bold tracking-tight">
                    {owner.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={tagFilter} onValueChange={(v) => v && onTagFilterChange(v)}>
              <LabeledSelectTrigger
                className="min-w-[140px] rounded-xl border-border/40 bg-muted/20 text-xs font-bold uppercase tracking-tight"
                size="default"
              >
                {tagLabel}
              </LabeledSelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="text-xs uppercase font-bold tracking-tight">Todas as etiquetas</SelectItem>
                {tagOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs uppercase font-bold tracking-tight">
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sortOrder} onValueChange={(v) => v && onSortOrderChange(v as SortOption)}>
              <LabeledSelectTrigger
                className="min-w-[140px] rounded-xl border-border/40 bg-muted/20 text-xs font-bold uppercase tracking-tight"
                size="default"
              >
                {sortOrder === 'idle_time' ? '⏳ Mais tempo sem resposta' : sortOrder === 'score' ? '⭐ Melhor Score' : '📋 Ordem Padrão'}
              </LabeledSelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="position" className="text-xs uppercase font-bold tracking-tight">📋 Ordem Padrão</SelectItem>
                <SelectItem value="idle_time" className="text-xs uppercase font-bold tracking-tight">⏳ Mais tempo sem resposta</SelectItem>
                <SelectItem value="score" className="text-xs uppercase font-bold tracking-tight">⭐ Melhor Score</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 lg:shrink-0">
          <InputGroup className="w-full sm:w-[260px]">
            <InputGroupAddon className="bg-muted/20 border-border/40 rounded-l-xl">
              <Search className="size-3.5 opacity-50" />
            </InputGroupAddon>
            <InputGroupInput
              value={searchTerm}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar paciente..."
              className="rounded-r-xl border-border/40 bg-muted/10 text-xs font-medium placeholder:text-muted-foreground/50"
            />
          </InputGroup>

          <div
            className="flex items-center gap-1 rounded-xl bg-muted/40 p-1.5 backdrop-blur-sm"
          >
            {TEMP_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  'h-8 px-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all duration-200',
                  temperatureFilter === opt.value 
                    ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50' 
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => onTemperatureChange(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
