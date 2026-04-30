import { RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { temperaturePillClass } from '@/components/kanban/temperatureClass'
import { sourceLabel } from '@/hooks/useCrmState'
import { getLeadFieldValue } from '@/lib/leadFields'
import { formatTemperature } from '@/lib/fieldLabels'
import { cn } from '@/lib/utils'
import type { Lead, Stage } from '@/mocks/crmMock'

type TagPill = { id: string; name: string; color?: string }

type Props = {
  stages: Stage[]
  leads: Lead[]
  isLoading: boolean
  selectedLeadId: string | null
  onSelectLead: (leadId: string) => void
  getOwnerName: (ownerId: string) => string
  tagPillsForLead: (leadId: string) => TagPill[]
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
    <div className="col-span-full space-y-8 pb-10">
      {stages.map((stage) => {
        const stageLeads = byStage.get(stage.id) ?? []
        return (
          <section
            key={stage.id}
            className="overflow-hidden rounded-3xl border border-border/30 bg-card shadow-sm transition-all duration-300 hover:shadow-md"
            aria-labelledby={`list-stage-${stage.id}`}
          >
            <header
              className="flex flex-wrap items-center justify-between gap-4 border-b border-border/20 bg-muted/20 px-6 py-4 backdrop-blur-md"
            >
              <div className="flex items-center gap-3">
                <div className="size-2.5 rounded-full bg-primary" />
                <h2 id={`list-stage-${stage.id}`} className="m-0 text-[14px] font-black uppercase tracking-[0.15em] text-foreground/80">
                  {stage.name}
                </h2>
              </div>
              <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
                {stageSlaMinutes?.[stage.id] != null ? (
                  <span className="flex items-center gap-1.5 text-destructive ring-1 ring-destructive/20 bg-destructive/5 px-2.5 py-1 rounded-full">
                    <RefreshCw className="size-3" />
                    SLA: {stageSlaMinutes[stage.id]}m
                  </span>
                ) : null}
                <span className="flex items-center justify-center min-w-[28px] h-7 rounded-full bg-primary/10 px-2.5 text-primary tabular-nums font-black">
                  {stageLeads.length}
                </span>
              </div>
            </header>

            {stageLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center opacity-30">
                <div className="mb-2 text-3xl">📥</div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em]">Vazio por aqui</p>
              </div>
            ) : (
              <>
                <ul className="m-0 flex list-none flex-col divide-y divide-border/20 md:hidden">
                  {stageLeads.map((lead) => {
                    const temp = effectiveTemperature(lead)
                    const selected = selectedLeadId === lead.id
                    return (
                      <li key={lead.id}>
                        <button
                          type="button"
                          onClick={() => onSelectLead(lead.id)}
                          className={cn(
                            'w-full text-left p-5 transition-all duration-200',
                            selected ? 'bg-primary/[0.03] ring-inset ring-1 ring-primary/20' : 'hover:bg-muted/30',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="m-0 text-[15px] font-bold text-foreground/90 leading-tight">{lead.patientName}</p>
                            <span className={cn('shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider', temperaturePillClass(temp))}>
                              {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                            </span>
                          </div>
                          <p className="m-0 mt-1.5 line-clamp-2 text-xs text-muted-foreground/70 font-medium">{lead.summary || 'Sem resumo disponível'}</p>
                          <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                            <span>{getOwnerName(lead.ownerId)}</span>
                            <div className="size-1 rounded-full bg-border" />
                            <span>{sourceLabel[lead.source]}</span>
                          </div>
                          {tagPillsForLead(lead.id).length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {tagPillsForLead(lead.id).map((t) => (
                                <Badge
                                  key={t.id}
                                  variant="secondary"
                                  className="h-5 px-2 rounded-md border-border/40 text-[9px] font-black uppercase tracking-tight"
                                  style={{ color: t.color, backgroundColor: `${t.color}11`, borderColor: `${t.color}33` }}
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
                  <table className="w-full min-w-[50rem] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border/20 bg-muted/10 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/70">
                        <th className="px-6 py-4">Paciente</th>
                        <th className="px-4 py-4">Status</th>
                        <th className="px-4 py-4 text-center">Responsável</th>
                        <th className="px-4 py-4">Origem</th>
                        <th className="px-6 py-4">Etiquetas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/10">
                      {stageLeads.map((lead) => {
                        const temp = effectiveTemperature(lead)
                        const selected = selectedLeadId === lead.id
                        return (
                          <tr
                            key={lead.id}
                            className={cn(
                              'group cursor-pointer transition-all duration-200', 
                              selected ? 'bg-primary/[0.04] ring-inset ring-1 ring-primary/20' : 'hover:bg-muted/30'
                            )}
                            onClick={() => onSelectLead(lead.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                onSelectLead(lead.id)
                              }
                            }}
                            tabIndex={0}
                            role="button"
                          >
                            <td className="px-6 py-4">
                              <div className="flex flex-col">
                                <span className="text-[14px] font-bold text-foreground/90 group-hover:text-primary transition-colors">{lead.patientName}</span>
                                {lead.summary ? (
                                  <p className="m-0 mt-0.5 line-clamp-1 text-[11px] font-medium text-muted-foreground/60">{lead.summary}</p>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <span className={cn('inline-flex px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider', temperaturePillClass(temp))}>
                                {formatTemperature(getLeadFieldValue(lead, 'temperature'), lead.temperature)}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/80">{getOwnerName(lead.ownerId)}</span>
                            </td>
                            <td className="px-4 py-4">
                              <span className="inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                                {sourceLabel[lead.source]}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-wrap gap-1.5 max-w-[15rem]">
                                {tagPillsForLead(lead.id).map((t) => (
                                  <Badge 
                                    key={t.id} 
                                    variant="secondary" 
                                    className="h-5 px-2 rounded-md border-border/40 text-[9px] font-black uppercase tracking-tight"
                                    style={{ color: t.color, backgroundColor: `${t.color}11`, borderColor: `${t.color}33` }}
                                  >
                                    {t.name}
                                  </Badge>
                                ))}
                                {tagPillsForLead(lead.id).length === 0 ? <span className="text-[10px] font-bold text-muted-foreground/30 uppercase tracking-widest">—</span> : null}
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
