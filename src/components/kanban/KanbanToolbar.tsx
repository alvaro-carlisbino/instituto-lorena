import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Props = {
  onSimulateCapture: () => void
  pipelineId: string
  pipelineOptions: { id: string; name: string }[]
  onPipelineChange: (id: string) => void
  searchTerm: string
  onSearchChange: (value: string) => void
  temperatureFilter: 'all' | 'hot' | 'warm' | 'cold'
  onTemperatureChange: (value: 'all' | 'hot' | 'warm' | 'cold') => void
}

export function KanbanToolbar({
  onSimulateCapture,
  pipelineId,
  pipelineOptions,
  onPipelineChange,
  searchTerm,
  onSearchChange,
  temperatureFilter,
  onTemperatureChange,
}: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
      <Button type="button" onClick={onSimulateCapture}>
        Simular captura na Meta
      </Button>
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        value={pipelineId}
        onChange={(event) => onPipelineChange(event.target.value)}
      >
        {pipelineOptions.map((pipeline) => (
          <option key={pipeline.id} value={pipeline.id}>
            {pipeline.name}
          </option>
        ))}
      </select>
      <Input
        className="max-w-xs"
        value={searchTerm}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Buscar paciente ou resumo"
      />
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        value={temperatureFilter}
        onChange={(event) => onTemperatureChange(event.target.value as 'all' | 'hot' | 'warm' | 'cold')}
      >
        <option value="all">Todas temperaturas</option>
        <option value="hot">Quente</option>
        <option value="warm">Morna</option>
        <option value="cold">Fria</option>
      </select>
    </div>
  )
}
