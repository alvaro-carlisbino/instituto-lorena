import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'
import { sourceLabel } from '../hooks/useCrmState'

export function KanbanPage() {
  const crm = useCrm()

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
      </section>

      <section className="kanban-board">
        {crm.selectedPipeline.stages.map((stage) => (
          <article key={stage.id} className="kanban-column">
            <header>
              <h2>{stage.name}</h2>
              <span>{crm.filteredLeads.filter((lead) => lead.stageId === stage.id).length}</span>
            </header>

            <div className="column-scroll">
              {crm.filteredLeads
                .filter((lead) => lead.stageId === stage.id)
                .map((lead) => (
                  <div
                    key={lead.id}
                    className={`lead-card ${crm.selectedLeadId === lead.id ? 'selected' : ''}`}
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
            </div>
          </article>
        ))}
      </section>
    </AppLayout>
  )
}
