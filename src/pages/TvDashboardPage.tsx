import { useEffect, useState } from 'react'
import { useCrm } from '../context/CrmContext'

export function TvDashboardPage() {
  const crm = useCrm()
  const [tick, setTick] = useState<number>(0)

  if (!crm.currentPermission.canViewTvPanel) {
    return (
      <div className="tv-screen">
        <header>
          <h1>Instituto Lorena | Painel TV</h1>
          <p>Acesso negado para o perfil atual.</p>
        </header>
      </div>
    )
  }

  const metricByKey = (key: string) => crm.metrics.find((metric) => metric.id === key)

  const orderedWidgets = crm.tvWidgets.filter((widget) => widget.enabled).sort((a, b) => a.position - b.position)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((previous) => previous + 1)
    }, 15000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="tv-screen">
      <header>
        <h1>Instituto Lorena | Painel TV</h1>
        <p>Atualizacao automatica a cada 15s | ciclo {tick}</p>
      </header>

      <section className="tv-kpis">
        {orderedWidgets
          .filter((widget) => widget.widgetType === 'kpi')
          .map((widget) => {
            const metric = metricByKey(widget.metricKey)
            return (
              <article key={widget.id}>
                <p>{widget.title}</p>
                <strong>{metric ? metric.value : crm.totalQualified}</strong>
              </article>
            )
          })}
      </section>

      <section className="tv-graphs">
        {orderedWidgets.some((widget) => widget.widgetType === 'bar') ? (
          <article>
            <h2>Capacao x Qualificacao por hora</h2>
            <ul>
              {crm.tvKpiSeries.map((point) => (
                <li key={point.label}>
                  <span>{point.label}</span>
                  <div className="tv-bar-group">
                    <div className="tv-bar leads" style={{ width: `${point.leads * 7}%` }} />
                    <div className="tv-bar qualified" style={{ width: `${point.qualified * 7}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ) : null}

        <article>
          <h2>Ranking SDR</h2>
          <ul>
            {crm.workloadBySdr.map((sdr) => (
              <li key={sdr.id}>
                <span>{sdr.name}</span>
                <strong>{sdr.total} leads</strong>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  )
}
