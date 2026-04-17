import { useCrm } from '../context/CrmContext'

export function TopControls() {
  const crm = useCrm()

  return (
    <section className="top-controls">
      <div className="top-identity">
        <strong>{crm.session?.user.email ?? 'sem sessao'}</strong>
        <small>{crm.currentPermission.role}</small>
      </div>

      <div className="button-group">
        <button onClick={() => void crm.runSignOut()} disabled={crm.isLoading || !crm.session}>
          Sair
        </button>
        <button onClick={() => void crm.createTestAuthUsers()} disabled={crm.isLoading}>
          Criar auth teste
        </button>
        <button onClick={() => void crm.syncFromSupabase()} disabled={crm.isLoading || !crm.currentPermission.canRouteLeads}>
          {crm.isLoading ? 'Sincronizando...' : 'Sincronizar'}
        </button>
        <button onClick={() => void crm.seedSupabase()} disabled={crm.isLoading || !crm.currentPermission.canManageUsers}>
          Seed dados
        </button>
      </div>

      <div className="control-notices">
        <p>Modo: {crm.dataMode}</p>
        <p>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={crm.useRolePreview}
              onChange={(event) => crm.setUseRolePreview(event.target.checked)}
            />
            Modo preview de perfil
          </label>
        </p>
        <p>
          Atuando como:{' '}
          <select
            value={crm.actingRole}
            onChange={(event) => crm.setActingRole(event.target.value as 'admin' | 'gestor' | 'sdr')}
            disabled={!crm.useRolePreview}
          >
            <option value="admin">admin</option>
            <option value="gestor">gestor</option>
            <option value="sdr">sdr</option>
          </select>
        </p>
        <p>Perfil efetivo: {crm.effectiveRole}</p>
        {crm.syncNotice ? <p>{crm.syncNotice}</p> : null}
        {crm.authNotice ? <p>{crm.authNotice}</p> : null}
      </div>
    </section>
  )
}
