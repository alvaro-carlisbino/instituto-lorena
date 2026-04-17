import { useMemo, useState } from 'react'

import { KanbanColumnDropZone, KanbanLeadCard } from '@/components/kanban/KanbanLeadCard'
import { KanbanToolbar } from '@/components/kanban/KanbanToolbar'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { useCrm } from '@/context/CrmContext'
import { sourceLabel } from '@/hooks/useCrmState'
import { AppLayout } from '@/layouts/AppLayout'

export function KanbanPage() {
  const crm = useCrm()
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [temperatureFilter, setTemperatureFilter] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null)

  const visibleLeads = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()
    return crm.filteredLeads.filter((lead) => {
      const matchesText =
        normalized.length === 0 ||
        lead.patientName.toLowerCase().includes(normalized) ||
        lead.summary.toLowerCase().includes(normalized)
      const matchesTemperature = temperatureFilter === 'all' || lead.temperature === temperatureFilter
      return matchesText && matchesTemperature
    })
  }, [crm.filteredLeads, searchTerm, temperatureFilter])

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Kanban de leads" subtitle="Seu perfil não pode movimentar leads nem alterar roteamento.">
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          <p className="m-0">Entre com um perfil autorizado ou peça liberação ao administrador.</p>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Kanban de leads" subtitle="Boards e etapas configuráveis por processo comercial.">
      <KanbanToolbar
        onSimulateCapture={crm.simulateMetaCapture}
        pipelineId={crm.selectedPipelineId}
        pipelineOptions={crm.pipelineCatalog.map((p) => ({ id: p.id, name: p.name }))}
        onPipelineChange={crm.setSelectedPipelineId}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        temperatureFilter={temperatureFilter}
        onTemperatureChange={setTemperatureFilter}
      />

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {crm.isLoading ? <SkeletonRows /> : null}
        {crm.selectedPipeline.stages.map((stage) => {
          const stageLeads = visibleLeads.filter((lead) => lead.stageId === stage.id)
          return (
            <article
              key={stage.id}
              className="flex min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
            >
              <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <h2 className="m-0 text-sm font-semibold">{stage.name}</h2>
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs tabular-nums">
                  {stageLeads.length}
                </span>
              </header>

              <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
                {stageLeads.map((lead) => (
                  <KanbanLeadCard
                    key={lead.id}
                    lead={lead}
                    selected={crm.selectedLeadId === lead.id}
                    sourceLabel={sourceLabel[lead.source]}
                    ownerName={crm.getOwnerName(lead.ownerId)}
                    onSelect={() => crm.setSelectedLeadId(lead.id)}
                    onMovePrev={() => crm.moveLead(lead.id, 'prev')}
                    onMoveNext={() => crm.moveLead(lead.id, 'next')}
                    stageLeadsOrdered={stageLeads}
                    onReorderDrop={(draggedLeadId, targetIndex) =>
                      crm.reorderLeadCard(draggedLeadId, { stageId: stage.id, index: targetIndex })
                    }
                    onDragEnterColumn={() => setDragOverStageId(stage.id)}
                  />
                ))}

                <KanbanColumnDropZone
                  active={dragOverStageId === stage.id}
                  onDragOver={() => setDragOverStageId(stage.id)}
                  onDragLeave={() => setDragOverStageId(null)}
                  onDropEnd={(draggedLeadId) => {
                    setDragOverStageId(null)
                    crm.reorderLeadCard(draggedLeadId, { stageId: stage.id, index: stageLeads.length })
                  }}
                />
              </div>
            </article>
          )
        })}
      </div>
    </AppLayout>
  )
}

function SkeletonRows() {
  return (
    <div className="col-span-full">
      <SkeletonBlocks rows={6} card={false} />
    </div>
  )
}
