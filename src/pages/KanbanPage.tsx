import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'
import { sourceLabel } from '../hooks/useCrmState'
import { useMemo, useState } from 'react'

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
      <AppLayout title="Kanban de Leads" subtitle="Visualizacao liberada, edicao bloqueada para este perfil.">
        <section className="panel">
          <p>Seu perfil nao possui permissao para movimentar leads e roteamento.</p>
        </section>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Kanban de Leads" subtitle="Boards e etapas configuraveis por processo comercial.">
      <section className="panel toolbar">
        <button className="primary" onClick={crm.simulateMetaCapture}>
          Simular captura Meta
        </button>
        <select value={crm.selectedPipelineId} onChange={(event) => crm.setSelectedPipelineId(event.target.value)}>
          {crm.pipelineCatalog.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </select>
        <input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar paciente ou resumo"
        />
        <select
          value={temperatureFilter}
          onChange={(event) => setTemperatureFilter(event.target.value as 'all' | 'hot' | 'warm' | 'cold')}
        >
          <option value="all">Todas temperaturas</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
      </section>

      <section className="kanban-board">
        {crm.selectedPipeline.stages.map((stage) => (
          <article key={stage.id} className="kanban-column">
            <header>
              <h2>{stage.name}</h2>
              <span>{visibleLeads.filter((lead) => lead.stageId === stage.id).length}</span>
            </header>

            <div className="column-scroll">
              {visibleLeads
                .filter((lead) => lead.stageId === stage.id)
                .map((lead) => (
                  <div
                    key={lead.id}
                    className={`lead-card ${crm.selectedLeadId === lead.id ? 'selected' : ''}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/lead-id', lead.id)
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDragOverStageId(stage.id)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      setDragOverStageId(null)
                      const draggedLeadId = event.dataTransfer.getData('text/lead-id')
                      if (!draggedLeadId) return
                      const stageLeads = visibleLeads.filter((item) => item.stageId === stage.id)
                      const targetIndex = stageLeads.findIndex((item) => item.id === lead.id)
                      crm.reorderLeadCard(draggedLeadId, { stageId: stage.id, index: Math.max(0, targetIndex) })
                    }}
                    onClick={() => crm.setSelectedLeadId(lead.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') crm.setSelectedLeadId(lead.id)
                    }}
                  >
                    <div className="lead-card-top">
                      <p>{lead.patientName}</p>
                      <span className={`temperature ${lead.temperature}`}>{lead.temperature}</span>
                    </div>
                    <small>{sourceLabel[lead.source]}</small>
                    <p className="summary">{lead.summary}</p>
                    <div className="meta-row">
                      <span>Score {lead.score}</span>
                      <span>{crm.getOwnerName(lead.ownerId)}</span>
                    </div>
                    <div className="card-actions">
                      <button onClick={() => crm.moveLead(lead.id, 'prev')}>Voltar</button>
                      <button onClick={() => crm.moveLead(lead.id, 'next')}>Avancar</button>
                    </div>
                  </div>
                ))}

              <div
                className={`drop-zone ${dragOverStageId === stage.id ? 'active' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragOverStageId(stage.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragOverStageId(null)
                  const draggedLeadId = event.dataTransfer.getData('text/lead-id')
                  if (!draggedLeadId) return
                  const stageLeads = visibleLeads.filter((item) => item.stageId === stage.id)
                  crm.reorderLeadCard(draggedLeadId, { stageId: stage.id, index: stageLeads.length })
                }}
                onDragLeave={() => setDragOverStageId(null)}
              >
                Arraste para adicionar no fim da etapa
              </div>
            </div>
          </article>
        ))}
      </section>
    </AppLayout>
  )
}
