import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'

export function DashboardConfigPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Config Dashboard" subtitle="Sem permissao para editar dashboard.">
        <section className="panel">
          <p>Seu perfil nao pode alterar configuracoes do dashboard.</p>
        </section>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Config Dashboard" subtitle="Escolha cards, ordem e metricas exibidas no dashboard comercial.">
      <section className="panel toolbar">
        <button className="primary" onClick={crm.addDashboardWidget}>
          Novo card
        </button>
      </section>

      <section className="panel">
        <ul className="editable-list">
          {crm.dashboardWidgets
            .sort((a, b) => a.position - b.position)
            .map((card) => (
              <li key={card.id}>
                <div className="item-main">
                  <input
                    value={card.title}
                    onChange={(event) => crm.updateDashboardWidget(card.id, { title: event.target.value })}
                  />
                  <div className="inline-fields">
                    <input
                      value={card.metricKey}
                      onChange={(event) => crm.updateDashboardWidget(card.id, { metricKey: event.target.value })}
                    />
                    <label className="switch-row">
                      <input
                        type="checkbox"
                        checked={card.enabled}
                        onChange={(event) => crm.updateDashboardWidget(card.id, { enabled: event.target.checked })}
                      />
                      Ativo
                    </label>
                  </div>
                </div>

                <div className="inline-actions">
                  <button onClick={() => crm.moveDashboardWidget(card.id, 'up')}>Subir</button>
                  <button onClick={() => crm.moveDashboardWidget(card.id, 'down')}>Descer</button>
                  <button className="danger" onClick={() => crm.removeDashboardWidget(card.id)}>
                    Remover
                  </button>
                </div>
              </li>
            ))}
        </ul>
      </section>
    </AppLayout>
  )
}
