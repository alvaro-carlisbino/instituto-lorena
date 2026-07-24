import { LayoutGrid, List, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
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
  const poloLabel = labelForIdName(
    poloFilter ?? 'all',
    poloOptions ?? [],
    { value: 'all', label: 'Todos os polos' },
    'Polo',
  )
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

  const deliveryLabel =
    deliveryFilter === 'all'
      ? 'Entrega'
      : DELIVERY_FILTER_OPTIONS.find((o) => o.value === deliveryFilter)?.label ?? 'Entrega'

  const conversationLabel =
    conversationFilter === 'all'
      ? 'Conversa'
      : conversationFilter === 'ai_triaging'
        ? 'Triagem IA'
        : conversationFilter === 'waiting_human'
          ? 'Aguardando SDR'
          : conversationFilter === 'human_active'
            ? 'Humano ativo'
            : 'Novo'

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
            {showPolo ? (
              <Select value={poloFilter ?? 'all'} onValueChange={(v) => v && onPoloChange!(v)}>
                <LabeledSelectTrigger
                  className="min-w-[140px] rounded-xl border-primary/30 bg-primary/[0.06] text-xs font-bold uppercase tracking-tight"
                  size="default"
                >
                  {poloLabel}
                </LabeledSelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all" className="text-xs uppercase font-bold tracking-tight">
                    Todos os polos
                  </SelectItem>
                  {poloOptions!.map((polo) => (
                    <SelectItem key={polo.id} value={polo.id} className="text-xs uppercase font-bold tracking-tight">
                      {polo.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

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
                {sortOrder === 'idle_time' ? 'Mais tempo sem resposta' : sortOrder === 'score' ? 'Melhor Score' : 'Ordem Padrão'}
              </LabeledSelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="position" className="text-xs uppercase font-bold tracking-tight">Ordem Padrão</SelectItem>
                <SelectItem value="idle_time" className="text-xs uppercase font-bold tracking-tight">Mais tempo sem resposta</SelectItem>
                <SelectItem value="score" className="text-xs uppercase font-bold tracking-tight">Melhor Score</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={conversationFilter}
              onValueChange={(v) => v && onConversationFilterChange(v as ConversationFilterOption)}
            >
              <LabeledSelectTrigger
                className="min-w-[160px] rounded-xl border-border/40 bg-muted/20 text-xs font-bold uppercase tracking-tight"
                size="default"
              >
                {conversationLabel}
              </LabeledSelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="text-xs uppercase font-bold tracking-tight">
                  Todas (conversa)
                </SelectItem>
                <SelectItem value="new" className="text-xs uppercase font-bold tracking-tight">
                  Novo
                </SelectItem>
                <SelectItem value="ai_triaging" className="text-xs uppercase font-bold tracking-tight">
                  Triagem IA
                </SelectItem>
                <SelectItem value="waiting_human" className="text-xs uppercase font-bold tracking-tight">
                  Aguardando SDR
                </SelectItem>
                <SelectItem value="human_active" className="text-xs uppercase font-bold tracking-tight">
                  Atendimento humano
                </SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={deliveryFilter}
              onValueChange={(v) => v && onDeliveryFilterChange(v as 'all' | DeliveryKind)}
            >
              <LabeledSelectTrigger
                className="min-w-[160px] rounded-xl border-border/40 bg-muted/20 text-xs font-bold uppercase tracking-tight"
                size="default"
              >
                {deliveryLabel}
              </LabeledSelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="text-xs uppercase font-bold tracking-tight">
                  Todas (entrega)
                </SelectItem>
                {DELIVERY_FILTER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs uppercase font-bold tracking-tight">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 lg:shrink-0">
          <InputGroup className="w-full sm:w-[min(100%,520px)] lg:w-[560px]">
            <InputGroupAddon className="bg-muted/20 border-border/40 rounded-l-xl">
              <Search className="size-4 opacity-50" />
            </InputGroupAddon>
            <InputGroupInput
              value={searchTerm}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar paciente entre ~1000 clientes (nome, telefone, resumo)…"
              className="h-11 rounded-r-xl border-border/40 bg-muted/10 text-sm font-medium placeholder:text-muted-foreground/50"
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
