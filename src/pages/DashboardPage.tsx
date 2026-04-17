import { AppLayout } from '../layouts/AppLayout'
import { TopControls } from '../components/TopControls'
import { useCrm } from '../context/CrmContext'

export function DashboardPage() {
  const crm = useCrm()

  const getDashboardValue = (metricKey: string) => {
    if (metricKey === 'leads-active') return crm.leads.length
    if (metricKey === 'leads-hot') return crm.totalHotLeads
    if (metricKey === 'qualified-ai') return crm.totalQualified
    if (metricKey === 'channels-active') return crm.channels.filter((channel) => channel.enabled).length
    const metric = crm.metrics.find((item) => item.id === metricKey)
    return metric?.value ?? 0
  }

  const dashboardCards = crm.dashboardWidgets.filter((widget) => widget.enabled).sort((a, b) => a.position - b.position)

  return (
    <AppLayout title="Dashboard Comercial" subtitle="Visao geral com indicadores ajustaveis e operacao do dia.">
      <TopControls />

      <section className="metrics-grid">
        {dashboardCards.map((card) => (
          <article key={card.id}>
            <p>{card.title}</p>
            <strong>{getDashboardValue(card.metricKey)}</strong>
          </article>
        ))}
      </section>

      {crm.captureNotice ? <p className="notice">{crm.captureNotice}</p> : null}

      <section className="panel-grid two-col">
        <article className="panel">
          <header>
            <h2>Pipeline atual</h2>
            <select value={crm.selectedPipelineId} onChange={(event) => crm.setSelectedPipelineId(event.target.value)}>
              {crm.pipelineCatalog.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </header>
          <ul className="stage-list">
            {crm.selectedPipeline.stages.map((stage) => (
              <li key={stage.id}>
                <span>{stage.name}</span>
                <strong>{crm.filteredLeads.filter((lead) => lead.stageId === stage.id).length}</strong>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <header>
            <h2>Equipe SDR</h2>
          </header>
          <ul className="stage-list">
            {crm.workloadBySdr.map((sdr) => (
              <li key={sdr.id}>
                <span>{sdr.name}</span>
                <strong>{sdr.total} leads</strong>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </AppLayout>
  )
}
