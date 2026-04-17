import { useCrm } from '../context/CrmContext'

export function TopControls() {
  const crm = useCrm()

  return (
    <section className="top-controls">
      <div className="auth-fields">
        <input value={crm.authEmail} onChange={(event) => crm.setAuthEmail(event.target.value)} placeholder="email" />
        <input
          value={crm.authPassword}
          onChange={(event) => crm.setAuthPassword(event.target.value)}
          placeholder="senha"
          type="password"
        />
      </div>

      <div className="button-group">
        <button onClick={() => void crm.runSignIn()} disabled={crm.isLoading}>
          Login
        </button>
        <button onClick={() => void crm.runSignUp()} disabled={crm.isLoading}>
          Criar conta
        </button>
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
        <p>Sessao: {crm.session?.user.email ?? 'nao autenticado'}</p>
        <p>
          Atuando como:{' '}
          <select
            value={crm.actingRole}
            onChange={(event) => crm.setActingRole(event.target.value as 'admin' | 'gestor' | 'sdr')}
          >
            <option value="admin">admin</option>
            <option value="gestor">gestor</option>
            <option value="sdr">sdr</option>
          </select>
        </p>
        {crm.syncNotice ? <p>{crm.syncNotice}</p> : null}
        {crm.authNotice ? <p>{crm.authNotice}</p> : null}
      </div>
    </section>
  )
}
