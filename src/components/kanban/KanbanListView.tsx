import { Badge } from '@/components/ui/badge'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { temperaturePillClass } from '@/components/kanban/temperatureClass'
import { sourceLabel } from '@/hooks/useCrmState'
import { getLeadFieldValue } from '@/lib/leadFields'
import { formatTemperature } from '@/lib/fieldLabels'
import { cn } from '@/lib/utils'
import type { Lead, Stage, WorkflowField } from '@/mocks/crmMock'

type TagPill = { id: string; name: string; color?: string }

type Props = {
  stages: Stage[]
  leads: Lead[]
  isLoading: boolean
  selectedLeadId: string | null
  onSelectLead: (leadId: string) => void
  getOwnerName: (ownerId: string) => string
  tagPillsForLead: (leadId: string) => TagPill[]
  kanbanFieldsOrdered: WorkflowField[]
  stageSlaMinutes: Record<string, number> | undefined
}

function effectiveTemperature(lead: Lead): 'hot' | 'warm' | 'cold' {
  const raw = getLeadFieldValue(lead, 'temperature')
  if (raw === 'cold' || raw === 'warm' || raw === 'hot') return raw
  if (lead.temperature === 'cold' || lead.temperature === 'warm' || lead.temperature === 'hot') {
    return lead.temperature
  }
  return 'cold'
}

export function KanbanListView({
  stages,
  leads,
  isLoading,
  selectedLeadId,
  onSelectLead,
  getOwnerName,
  tagPillsForLead,
  kanbanFieldsOrdered,
  stageSlaMinutes,
}: Props) {
  if (isLoading) {
    return (
      <div className="col-span-full rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm">
        <SkeletonBlocks rows={8} card={false} />
      </div>
    )
  }

  const byStage = new Map<string, Lead[]>()
  for (const s of stages) {
    byStage.set(
      s.id,
      leads.filter((l) => l.stageId === s.id).sort((a, b) => a.patientName.localeCompare(b.patientName, 'pt')),
    )
  }

  return (
    <div className="col-span-full space-y-6">
      {stages.map((stage) => {
        const stageLeads = byStage.get(stage.id) ?? []
        return (
          <section
            key={stage.id}
            className="overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-sm"
            aria-labelledby={`list-stage-${stage.id}`}
          >
            <header
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/25 px-4 py-3"
            >
              <h2 id={`list-stage-${stage.id}`} className="m-0 text-sm font-bold uppercase tracking-widest text-foreground">
                {stage.name}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {stageSlaMinutes?.[stage.id] != null ? (
                  <span className="font-semibold text-destructive">SLA {stageSlaMinutes[stage.id]} min</span>
                ) : null}
                <span className="rounded-full border border-border/50 bg-background px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums text-foreground">
                  {stageLeads.length}
                </span>
              </div>
            </header>

            {stageLeads.length === 0 ? (
              <p className="m-0 px-4 py-10 text-center text-sm text-muted-foreground">Nenhum lead nesta etapa com os filtros atuais.</p>
            ) : (
              <>
                <ul className="m-0 flex list-none flex-col divide-y divide-border/50 md:hidden">
                  {stageLeads.map((lead) => {
                    const temp = effectiveTemperature(lead)
                    const selected = selectedLeadId === lead.id
                    return (
                      <li key={lead.id}>
                        <button
                          type="button"
                          onClick={() => onSelectLead(lead.id)}
                          className={cn(
                            'w-full text-left p-4 transition-colors',
                            selected ? 'bg-primary/10' : 'hover:bg-muted/40',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="m-0 font-medium text-foreground">{lead.patientName}</p>
                            <span className={cn('shrink-0 text-[10px] font-bold uppercase', temperaturePillClass(temp))}>
                              {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                            </span>
                          </div>
                          <p className="m-0 mt-1 line-clamp-2 text-xs text-muted-foreground">{lead.summary || '—'}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                            <span>{getOwnerName(lead.ownerId)}</span>
                            <span aria-hidden>·</span>
                            <span>{sourceLabel[lead.source]}</span>
                          </div>
                          {tagPillsForLead(lead.id).length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {tagPillsForLead(lead.id).map((t) => (
                                <Badge
                                  key={t.id}
                                  variant="secondary"
                                  className="h-5 max-w-[8rem] truncate text-[10px] font-medium"
                                >
                                  {t.name}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-border/60 bg-muted/15 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3">Paciente</th>
                        <th className="px-3 py-3">Temperatura</th>
                        <th className="px-3 py-3">Responsável</th>
                        {kanbanFieldsOrdered.slice(0, 2).map((f) => (
                          <th key={f.id} className="hidden px-3 py-3 lg:table-cell">
                            {f.label}
                          </th>
                        ))}
                        <th className="px-3 py-3">Origem</th>
                        <th className="px-3 py-3">Etiquetas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stageLeads.map((lead) => {
                        const temp = effectiveTemperature(lead)
                        const selected = selectedLeadId === lead.id
                        return (
                          <tr
                            key={lead.id}
                            className={cn('cursor-pointer border-b border-border/40 transition-colors', selected ? 'bg-primary/8' : 'hover:bg-muted/30')}
                            onClick={() => onSelectLead(lead.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                onSelectLead(lead.id)
                              }
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={`Abrir ${lead.patientName}`}
                          >
                            <td className="px-4 py-3">
                              <span className="font-medium text-foreground">{lead.patientName}</span>
                              {lead.summary ? <p className="m-0 mt-0.5 line-clamp-1 text-xs text-muted-foreground">{lead.summary}</p> : null}
                            </td>
                            <td className="px-3 py-3">
                              <span className={cn('inline-flex text-[10px] font-bold uppercase', temperaturePillClass(temp))}>
                                {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-xs">{getOwnerName(lead.ownerId)}</td>
                            {kanbanFieldsOrdered.slice(0, 2).map((f) => {
                              const raw = lead.customFields?.[f.id]
                              let v = raw != null && String(raw).trim() !== '' ? String(raw) : '—'
                              if (f.fieldType === 'boolean') {
                                const isChecked = Boolean(raw === 'true' || raw === true || raw === 1)
                                v = isChecked ? '✅ Sim' : '⬜ Não'
                              }
                              return (
                                <td key={f.id} className="hidden max-w-[10rem] truncate px-3 py-3 text-xs text-muted-foreground lg:table-cell">
                                  {v}
                                </td>
                              )
                            })}
                            <td className="px-3 py-3 text-xs text-muted-foreground">{sourceLabel[lead.source]}</td>
                            <td className="px-3 py-3">
                              <div className="flex max-w-[14rem] flex-wrap gap-1">
                                {tagPillsForLead(lead.id).map((t) => (
                                  <Badge key={t.id} variant="secondary" className="h-5 max-w-[7rem] truncate text-[10px]">
                                    {t.name}
                                  </Badge>
                                ))}
                                {tagPillsForLead(lead.id).length === 0 ? <span className="text-xs text-muted-foreground">—</span> : null}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )
      })}
    </div>
  )
}
