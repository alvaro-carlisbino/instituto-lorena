type Props = {
  email: string
  password: string
  isLoading: boolean
  notice: string
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSignIn: () => void
  onSignUp: () => void
}

export function AuthPage({
  email,
  password,
  isLoading,
  notice,
  onEmailChange,
  onPasswordChange,
  onSignIn,
  onSignUp,
}: Props) {
  return (
    <div className="auth-page">
      <section className="auth-card">
        <p className="auth-kicker">Instituto Lorena</p>
        <h1>CRM Commercial Console</h1>
        <p>Entre para acessar funis, operacoes e indicadores em ambiente seguro.</p>

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="voce@institutolorena.com"
          />
        </label>

        <label>
          Senha
          <input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="••••••••"
          />
        </label>

        <div className="auth-actions">
          <button className="primary" onClick={onSignIn} disabled={isLoading}>
            {isLoading ? 'Entrando...' : 'Entrar'}
          </button>
          <button onClick={onSignUp} disabled={isLoading}>
            Criar conta
          </button>
        </div>

        {notice ? <p className="auth-notice">{notice}</p> : null}
      </section>
    </div>
  )
}
