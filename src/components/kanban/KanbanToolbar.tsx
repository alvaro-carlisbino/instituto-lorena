import { Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
}: Props) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={pipelineId} onValueChange={(v) => v && onPipelineChange(v)}>
          <SelectTrigger className="w-full min-w-[12rem] sm:w-[min(100%,13rem)] rounded-xl border-border/70 text-xs font-medium" size="default">
            <SelectValue placeholder="Funil" />
          </SelectTrigger>
          <SelectContent>
            {pipelineOptions.map((pipeline) => (
              <SelectItem key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={ownerFilter} onValueChange={(v) => v && onOwnerChange(v)}>
          <SelectTrigger className="w-full min-w-[12rem] sm:w-[min(100%,11rem)] rounded-xl border-border/70 text-xs font-medium" size="default">
            <SelectValue placeholder="Responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {ownerOptions.map((owner) => (
              <SelectItem key={owner.id} value={owner.id}>
                {owner.name}
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
