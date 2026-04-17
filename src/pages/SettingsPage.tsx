import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'

export function SettingsPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canEditBoards) {
    return (
      <AppLayout title="Configuracoes Gerais" subtitle="Sem permissao para editar configuracoes estruturais.">
        <section className="panel">
          <p>Seu perfil nao possui permissao para alterar campos de workflow, perfis e notificacoes.</p>
        </section>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Configuracoes Gerais" subtitle="Permissoes, campos de workflow e regras de notificacao.">
      <section className="panel-grid two-col">
        <article className="panel">
          <header>
            <h2>Campos de workflow</h2>
            <button onClick={crm.addWorkflowField}>Novo campo</button>
          </header>
          <ul className="editable-list">
            {crm.workflowFields.map((field) => (
              <li key={field.id}>
                <div className="item-main">
                  <input
                    value={field.label}
                    onChange={(event) => crm.updateWorkflowField(field.id, { label: event.target.value })}
                  />
                  <select
                    value={field.fieldType}
                    onChange={(event) =>
                      crm.updateWorkflowField(field.id, {
                        fieldType: event.target.value as 'text' | 'select' | 'number' | 'date',
                      })
                    }
                  >
                    <option value="text">text</option>
                    <option value="select">select</option>
                    <option value="number">number</option>
                    <option value="date">date</option>
                  </select>
                </div>
                <div className="item-actions">
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) => crm.updateWorkflowField(field.id, { required: event.target.checked })}
                    />
                    Obrigatorio
                  </label>
                  <button className="danger" onClick={() => crm.removeWorkflowField(field.id)}>
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <header>
            <h2>Permissoes por papel</h2>
            <button onClick={crm.addPermissionProfile}>Novo perfil</button>
          </header>
          <ul className="editable-list">
            {crm.permissions.map((profile) => (
              <li key={profile.id}>
                <div className="item-main">
                  <select
                    value={profile.role}
                    onChange={(event) =>
                      crm.updatePermissionProfile(profile.id, {
                        role: event.target.value as 'admin' | 'gestor' | 'sdr',
                      })
                    }
                  >
                    <option value="admin">admin</option>
                    <option value="gestor">gestor</option>
                    <option value="sdr">sdr</option>
                  </select>
                  <div className="inline-fields">
                    <label className="switch-row">
                      <input
                        type="checkbox"
                        checked={profile.canEditBoards}
                        onChange={(event) =>
                          crm.updatePermissionProfile(profile.id, { canEditBoards: event.target.checked })
                        }
                      />
                      boards
                    </label>
                    <label className="switch-row">
                      <input
                        type="checkbox"
                        checked={profile.canRouteLeads}
                        onChange={(event) =>
                          crm.updatePermissionProfile(profile.id, { canRouteLeads: event.target.checked })
                        }
                      />
                      roteamento
                    </label>
                    <label className="switch-row">
                      <input
                        type="checkbox"
                        checked={profile.canViewTvPanel}
                        onChange={(event) =>
                          crm.updatePermissionProfile(profile.id, { canViewTvPanel: event.target.checked })
                        }
                      />
                      painel TV
                    </label>
                  </div>
                </div>
                <div className="item-actions">
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={profile.canManageUsers}
                      onChange={(event) =>
                        crm.updatePermissionProfile(profile.id, { canManageUsers: event.target.checked })
                      }
                    />
                    Gerenciar usuarios
                  </label>
                  <button className="danger" onClick={() => crm.removePermissionProfile(profile.id)}>
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel wide">
          <header>
            <h2>Notificacoes</h2>
            <button onClick={crm.addNotificationRule}>Nova regra</button>
          </header>
          <ul className="editable-list">
            {crm.notifications.map((rule) => (
              <li key={rule.id}>
                <div className="item-main">
                  <input
                    value={rule.name}
                    onChange={(event) => crm.updateNotificationRule(rule.id, { name: event.target.value })}
                  />
                  <div className="inline-fields">
                    <select
                      value={rule.channel}
                      onChange={(event) =>
                        crm.updateNotificationRule(rule.id, {
                          channel: event.target.value as 'email' | 'whatsapp' | 'in_app',
                        })
                      }
                    >
                      <option value="in_app">in_app</option>
                      <option value="email">email</option>
                      <option value="whatsapp">whatsapp</option>
                    </select>
                    <input
                      value={rule.trigger}
                      onChange={(event) => crm.updateNotificationRule(rule.id, { trigger: event.target.value })}
                    />
                  </div>
                </div>
                <div className="item-actions">
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(event) => crm.updateNotificationRule(rule.id, { enabled: event.target.checked })}
                    />
                    Ativo
                  </label>
                  <button className="danger" onClick={() => crm.removeNotificationRule(rule.id)}>
                    Remover
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </AppLayout>
  )
}
