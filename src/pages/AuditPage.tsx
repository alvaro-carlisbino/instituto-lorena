import { useMemo } from 'react'
import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'

export function AuditPage() {
  const crm = useCrm()

  const auditEvents = useMemo(() => {
    return crm.interactions
      .filter((interaction) => interaction.channel === 'system' || interaction.channel === 'ai')
      .slice(0, 40)
  }, [crm.interactions])

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="Auditoria" subtitle="Sem permissao para visualizar trilha de auditoria.">
        <section className="panel">
          <p>Seu perfil nao possui permissao para acessar auditoria.</p>
        </section>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Auditoria" subtitle="Eventos recentes de alteracao operacional e automacoes.">
      <section className="panel">
        <ul className="editable-list">
          {auditEvents.map((event) => (
            <li key={event.id}>
              <div className="item-main">
                <strong>{event.author}</strong>
                <small>
                  {event.channel} | {event.direction} | {new Date(event.happenedAt).toLocaleString('pt-BR')}
                </small>
                <span>{event.content}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </AppLayout>
  )
}
