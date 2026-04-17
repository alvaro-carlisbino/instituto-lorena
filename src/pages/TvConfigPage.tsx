import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'

export function TvConfigPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canViewTvPanel) {
    return (
      <AppLayout title="Configuracao Tela TV" subtitle="Sem permissao para painel TV.">
        <section className="panel">
          <p>Seu perfil nao possui permissao para configurar o painel de TV.</p>
        </section>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Configuracao Tela TV" subtitle="Defina widgets, ordem de exibicao e exibicao no painel de TV.">
      <section className="panel toolbar">
        <button className="primary" onClick={crm.addTvWidget}>
          Novo widget
        </button>
      </section>

      <section className="panel">
        <ul className="editable-list">
          {crm.tvWidgets
            .sort((a, b) => a.position - b.position)
            .map((widget) => (
              <li key={widget.id}>
                <div className="item-main">
                  <input
                    value={widget.title}
                    onChange={(event) => crm.updateTvWidget(widget.id, { title: event.target.value })}
                  />
                  <div className="inline-fields">
                    <select
                      value={widget.widgetType}
                      onChange={(event) =>
                        crm.updateTvWidget(widget.id, {
                          widgetType: event.target.value as 'kpi' | 'bar',
                        })
                      }
                    >
                      <option value="kpi">kpi</option>
                      <option value="bar">bar</option>
                    </select>

                    <input
                      value={widget.metricKey}
                      onChange={(event) => crm.updateTvWidget(widget.id, { metricKey: event.target.value })}
                    />

                    <label className="switch-row">
                      <input
                        type="checkbox"
                        checked={widget.enabled}
                        onChange={(event) => crm.updateTvWidget(widget.id, { enabled: event.target.checked })}
                      />
                      Ativo
                    </label>
                  </div>
                </div>

                <div className="inline-actions">
                  <button onClick={() => crm.moveTvWidget(widget.id, 'up')}>Subir</button>
                  <button onClick={() => crm.moveTvWidget(widget.id, 'down')}>Descer</button>
                  <button className="danger" onClick={() => crm.removeTvWidget(widget.id)}>
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
