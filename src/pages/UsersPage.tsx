import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'

export function UsersPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="Usuarios e Permissoes" subtitle="Sem permissao para gerenciamento de usuarios.">
        <section className="panel">
          <p>Seu perfil nao possui permissao para gerenciar usuarios.</p>
        </section>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Usuarios e Permissoes" subtitle="Gerencie usuarios da operacao e papeis de acesso.">
      <section className="panel toolbar">
        <button className="primary" onClick={crm.addUser}>
          Novo usuario
        </button>
      </section>

      <section className="panel">
        <ul className="editable-list">
          {crm.users.map((user) => (
            <li key={user.id}>
              <div className="item-main">
                <input value={user.name} onChange={(event) => crm.updateUser(user.id, { name: event.target.value })} />
                <div className="inline-fields">
                  <select
                    value={user.role}
                    onChange={(event) =>
                      crm.updateUser(user.id, { role: event.target.value as 'admin' | 'gestor' | 'sdr' })
                    }
                  >
                    <option value="admin">admin</option>
                    <option value="gestor">gestor</option>
                    <option value="sdr">sdr</option>
                  </select>

                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={user.active}
                      onChange={(event) => crm.updateUser(user.id, { active: event.target.checked })}
                    />
                    Ativo
                  </label>
                </div>
              </div>

              <button className="danger" onClick={() => crm.removeUser(user.id)}>
                Remover
              </button>
            </li>
          ))}
        </ul>
      </section>
    </AppLayout>
  )
}
