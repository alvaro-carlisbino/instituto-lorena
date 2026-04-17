import type { Lead, WorkflowField } from '@/mocks/crmMock'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getLeadFieldValue } from '@/lib/leadFields'

import { temperaturePillClass } from './temperatureClass'

type Props = {
  lead: Lead
  kanbanFields: WorkflowField[]
  selected: boolean
  sourceLabel: string
  ownerName: string
  onSelect: () => void
  onMovePrev: () => void
  onMoveNext: () => void
  stageLeadsOrdered: Lead[]
  onReorderDrop: (draggedLeadId: string, targetIndex: number) => void
  onDragEnterColumn?: () => void
}

export function KanbanLeadCard({
  lead,
  kanbanFields,
  selected,
  sourceLabel,
  ownerName,
  onSelect,
  onMovePrev,
  onMoveNext,
  stageLeadsOrdered,
  onReorderDrop,
  onDragEnterColumn,
}: Props) {
  const title =
    (getLeadFieldValue(lead, 'patient_name') as string | undefined) ?? lead.patientName
  const tempRaw = getLeadFieldValue(lead, 'temperature')
  const temperature =
    tempRaw === 'cold' || tempRaw === 'warm' || tempRaw === 'hot' ? tempRaw : lead.temperature

  const detailFields = kanbanFields.filter(
    (f) => f.fieldKey !== 'patient_name' && f.fieldKey !== 'temperature',
  )

  return (
    <div
      className={cn(
        'cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition hover:border-primary/30 hover:shadow-md active:cursor-grabbing',
        selected && 'border-primary ring-2 ring-primary/20',
      )}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/lead-id', lead.id)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        onDragEnterColumn?.()
      }}
      onDrop={(event) => {
        event.preventDefault()
        const draggedLeadId = event.dataTransfer.getData('text/lead-id')
        if (!draggedLeadId) return
        const targetIndex = stageLeadsOrdered.findIndex((item) => item.id === lead.id)
        onReorderDrop(draggedLeadId, Math.max(0, targetIndex))
      }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect()
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 font-semibold leading-tight">{title}</p>
        <span className={temperaturePillClass(temperature)}>{temperature}</span>
      </div>
      <small className="text-muted-foreground">{sourceLabel}</small>
      {detailFields.map((field) => {
        const v = getLeadFieldValue(lead, field.fieldKey)
        if (v === undefined || v === null || v === '') return null
        return (
          <p key={field.id} className="m-0 line-clamp-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{field.label}:</span> {String(v)}
          </p>
        )
      })}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          {kanbanFields.some((f) => f.fieldKey === 'score')
            ? `Score ${getLeadFieldValue(lead, 'score') ?? lead.score}`
            : `Score ${lead.score}`}
        </span>
        <span>{ownerName}</span>
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={(e) => {
            e.stopPropagation()
            onMovePrev()
          }}
        >
          Voltar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={(e) => {
            e.stopPropagation()
            onMoveNext()
          }}
        >
          Avançar
        </Button>
      </div>
    </div>
  )
}

type DropProps = {
  active: boolean
  onDragOver: () => void
  onDragLeave: () => void
  onDropEnd: (draggedLeadId: string) => void
}

export function KanbanColumnDropZone({ active, onDragOver, onDragLeave, onDropEnd }: DropProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-dashed border-muted-foreground/40 px-2 py-3 text-center text-xs text-muted-foreground',
        active && 'border-primary bg-primary/5 text-primary',
      )}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        const draggedLeadId = event.dataTransfer.getData('text/lead-id')
        if (!draggedLeadId) return
        onDropEnd(draggedLeadId)
      }}
      onDragLeave={onDragLeave}
    >
      Arraste para adicionar no fim da etapa
    </div>
  )
}
