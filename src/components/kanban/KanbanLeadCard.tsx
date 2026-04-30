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
        'group cursor-grab flex flex-col gap-2.5 rounded-2xl border bg-card p-4 shadow-sm transition-all duration-200 hover:shadow-lg active:cursor-grabbing hover:-translate-y-0.5',
        selected ? 'ring-2 ring-primary/30 border-primary/40 bg-primary/[0.02]' : 'border-border/60 hover:border-primary/40',
        isSlaBreached && 'border-destructive/50 bg-destructive/[0.02] shadow-[0_0_15px_-5px_rgba(239,68,68,0.3)]'
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
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-destructive ring-1 ring-destructive/20">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
          </span>
          ATENÇÃO: {elapsedMinutes - (slaMinutes ?? 0)}m ATRASADO
        </div>
      )}
      
      <div className="flex items-start justify-between gap-2">
        <h3 className="m-0 text-[15px] font-bold leading-tight tracking-tight text-foreground/90">{title}</h3>
        <span className={cn(temperaturePillClass(temperature), "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight")}>
          {formatTemperature(tempRaw, lead.temperature)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {sourceLabel}
        </span>
        {tagPills.map((t) => (
          <span
            key={t.id}
            className="inline-flex max-w-[7rem] truncate rounded-md border border-border/60 px-2 py-0.5 text-[10px] font-semibold"
            style={{ borderColor: `${t.color}33`, color: t.color, backgroundColor: `${t.color}11` }}
            title={t.name}
          >
            {t.name}
          </span>
        ))}
      </div>

      <div className="space-y-1.5 py-1">
        {detailFields.map((field) => {
          const v = getLeadFieldValue(lead, field.fieldKey)
          if (v === undefined || v === null || v === '') return null

          if (field.fieldType === 'boolean') {
            const isChecked = Boolean(v === 'true' || v === true || v === 1)
            return (
               <div key={field.id} className="flex items-center gap-2 text-[11px] text-muted-foreground/90">
                  <span className={isChecked ? "text-emerald-500" : "text-muted-foreground/30"}>
                    {isChecked ? "●" : "○"}
                  </span>
                  <span className="font-medium">{field.label}</span>
               </div>
            )
          }

          return (
            <div key={field.id} className="text-[11px] leading-snug">
              <span className="font-semibold text-muted-foreground/70">{field.label}:</span>{' '}
              <span className="text-foreground/80 font-medium">{String(v)}</span>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between border-t border-border/40 pt-3 mt-1 text-[11px] font-semibold text-muted-foreground/60">
        <div className="flex items-center gap-1.5">
          <div className="size-1.5 rounded-full bg-primary/40" />
          <span>Score: {String(getLeadFieldValue(lead, 'score') ?? lead.score)}</span>
        </div>
        <span className="truncate max-w-[100px]">{ownerName}</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <Button
          type="button"
          variant="secondary"
          className="h-7 text-[10px] font-bold uppercase tracking-wider bg-secondary/50 hover:bg-secondary"
          onClick={(e) => {
            e.stopPropagation()
            onMovePrev()
          }}
        >
          Voltar
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-7 text-[10px] font-bold uppercase tracking-wider bg-secondary/50 hover:bg-secondary"
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
