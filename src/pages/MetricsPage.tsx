import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'

const formatMetricValue = (value: number, unit: 'percent' | 'minutes' | 'count') => {
  if (unit === 'percent') return `${value}%`
  if (unit === 'minutes') return `${value} min`
  return String(value)
}

export function MetricsPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Metricas Ajustaveis" subtitle="Sem permissao para editar metricas no perfil atual.">
        <section className="panel">
          <p>Seu perfil pode visualizar metricas, mas nao pode editar metas e indicadores.</p>
        </section>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Metricas Ajustaveis" subtitle="Defina metas e acompanhe performance em tempo real.">
      <section className="panel toolbar">
        <button className="primary" onClick={crm.addMetric}>
          Nova metrica
        </button>
      </section>

      <section className="panel-grid two-col">
        {crm.metrics.map((metric) => {
          const performance = metric.target > 0 ? Math.round((metric.value / metric.target) * 100) : 0

          return (
            <article key={metric.id} className="panel">
              <header>
                <input value={metric.label} onChange={(event) => crm.updateMetric(metric.id, { label: event.target.value })} />
                <strong>{formatMetricValue(metric.value, metric.unit)}</strong>
              </header>

              <div className="metric-bar">
                <span style={{ width: `${Math.min(performance, 100)}%` }} />
              </div>

              <div className="form-grid">
                <label>
                  Valor atual
                  <input
                    type="number"
                    value={metric.value}
                    onChange={(event) => crm.updateMetric(metric.id, { value: Number(event.target.value) })}
                  />
                </label>

                <label>
                  Meta
                  <input
                    type="number"
                    value={metric.target}
                    onChange={(event) => crm.updateMetric(metric.id, { target: Number(event.target.value) })}
                  />
                </label>

                <label>
                  Unidade
                  <select
                    value={metric.unit}
                    onChange={(event) =>
                      crm.updateMetric(metric.id, { unit: event.target.value as 'percent' | 'minutes' | 'count' })
                    }
                  >
                    <option value="count">count</option>
                    <option value="percent">percent</option>
                    <option value="minutes">minutes</option>
                  </select>
                </label>
              </div>

              <p className="metric-footnote">Performance: {performance}% da meta</p>
              <button className="danger" onClick={() => crm.removeMetric(metric.id)}>
                Remover metrica
              </button>
            </article>
          )
        })}
      </section>
    </AppLayout>
  )
}
