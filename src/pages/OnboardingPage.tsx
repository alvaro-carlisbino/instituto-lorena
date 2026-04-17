type Props = {
  displayName: string
  isLoading: boolean
  notice: string
  onDisplayNameChange: (value: string) => void
  onComplete: () => void
}

export function OnboardingPage({
  displayName,
  isLoading,
  notice,
  onDisplayNameChange,
  onComplete,
}: Props) {
  return (
    <div className="auth-page">
      <section className="auth-card">
        <p className="auth-kicker">Primeiro acesso</p>
        <h1>Complete seu perfil</h1>
        <p>Antes de entrar no CRM, confirme seu nome de exibicao para auditoria e trilha operacional.</p>

        <label>
          Nome completo
          <input
            type="text"
            value={displayName}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            placeholder="Ex: Mariana Almeida"
          />
        </label>

        <div className="auth-actions">
          <button className="primary" onClick={onComplete} disabled={isLoading}>
            {isLoading ? 'Salvando...' : 'Concluir acesso'}
          </button>
        </div>

        {notice ? <p className="auth-notice">{notice}</p> : null}
      </section>
    </div>
  )
}
