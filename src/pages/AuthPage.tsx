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
        <p className="auth-kicker">Instituto Lorena | Area restrita</p>
        <h1>Central Comercial</h1>
        <p>Acesse com seu usuario corporativo para entrar no CRM.</p>

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
          <button onClick={onSignUp} disabled={isLoading} className="ghost">
            Solicitar acesso
          </button>
        </div>

        {notice ? <p className="auth-notice">{notice}</p> : null}
      </section>
    </div>
  )
}
