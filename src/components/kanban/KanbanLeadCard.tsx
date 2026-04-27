import type { Lead, WorkflowField } from '@/mocks/crmMock'

import { Button } from '@/components/ui/button'
import { useNowMs } from '@/hooks/useNowMs'
import { cn } from '@/lib/utils'
import { formatTemperature } from '@/lib/fieldLabels'
import { getLeadFieldValue } from '@/lib/leadFields'

import { temperaturePillClass } from './temperatureClass'

type Props = {
  lead: Lead
  kanbanFields: WorkflowField[]
  slaMinutes?: number
  selected: boolean
  sourceLabel: string
  ownerName: string
  tagPills?: { id: string; name: string; color: string }[]
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
  slaMinutes,
  selected,
  sourceLabel,
  ownerName,
  tagPills = [],
  onSelect,
  onMovePrev,
  onMoveNext,
  stageLeadsOrdered,
  onReorderDrop,
  onDragEnterColumn,
}: Props) {
  const nowMs = useNowMs(30_000)
  const title =
    (getLeadFieldValue(lead, 'patient_name') as string | undefined) ?? lead.patientName
  const tempRaw = getLeadFieldValue(lead, 'temperature')
  const temperature =
    tempRaw === 'cold' || tempRaw === 'warm' || tempRaw === 'hot' ? tempRaw : lead.temperature

  // SLA Calculation
  const elapsedMs = nowMs - new Date(lead.createdAt).getTime()
  const elapsedMinutes = Math.floor(elapsedMs / 60000)
  const isSlaBreached = slaMinutes !== undefined && elapsedMinutes > slaMinutes

  const detailFields = kanbanFields.filter(
    (f) => f.fieldKey !== 'patient_name' && f.fieldKey !== 'temperature',
  )

  return (
    <div
      className={cn(
        'cursor-grab border-l-4 rounded-2xl bg-card/90 p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing',
        selected ? 'ring-2 ring-primary/25 shadow-md' : '',
        isSlaBreached ? 'border-destructive shadow-[0_0_10px_var(--destructive)]' : 'border-border/80 hover:border-primary/35'
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
      {isSlaBreached && (
        <div className="mb-2 flex w-full items-center gap-1 rounded-lg border border-destructive/20 bg-destructive/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-destructive">
          <span className="size-2 rounded-full bg-destructive animate-pulse" />
          PRAZO EXCEDIDO ({elapsedMinutes - (slaMinutes ?? 0)}m)
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 text-sm font-semibold leading-tight tracking-tight">{title}</p>
        <span className={temperaturePillClass(temperature)}>{formatTemperature(tempRaw, lead.temperature)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <small className="text-muted-foreground">{sourceLabel}</small>
        {tagPills.map((t) => (
          <span
            key={t.id}
            className="inline-flex max-w-[7rem] truncate rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-medium"
            style={{ borderColor: t.color, color: t.color }}
            title={t.name}
          >
            {t.name}
          </span>
        ))}
      </div>
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
            ? `Pontuação ${getLeadFieldValue(lead, 'score') ?? lead.score}`
            : `Pontuação ${lead.score}`}
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
