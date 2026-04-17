import { useEffect, useState } from 'react'
import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'
import { loadAuditLogs } from '../services/crmSupabase'

type AuditEntry = {
  id: string
  actorEmail: string | null
  action: string
  targetTable: string
  targetId: string | null
  createdAt: string
}

export function AuditPage() {
  const crm = useCrm()
  const [auditEvents, setAuditEvents] = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState<boolean>(false)
  const [auditNotice, setAuditNotice] = useState<string>('')

  useEffect(() => {
    if (!crm.currentPermission.canManageUsers) return

    setAuditLoading(true)
    void loadAuditLogs(80)
      .then((rows) => {
        setAuditEvents(
          rows.map((row) => ({
            id: row.id,
            actorEmail: row.actorEmail,
            action: row.action,
            targetTable: row.targetTable,
            targetId: row.targetId,
            createdAt: row.createdAt,
          })),
        )
        setAuditNotice('')
      })
      .catch((error) => {
        setAuditNotice(`Falha ao carregar auditoria: ${error instanceof Error ? error.message : 'erro'}`)
      })
      .finally(() => {
        setAuditLoading(false)
      })
  }, [crm.currentPermission.canManageUsers])

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
    <AppLayout title="Auditoria" subtitle="Eventos reais do banco para alteracoes operacionais e configuracoes.">
      <section className="panel">
        {auditLoading ? <p>Carregando trilha de auditoria...</p> : null}
        {auditNotice ? <p>{auditNotice}</p> : null}
        <ul className="editable-list">
          {auditEvents.map((event) => (
            <li key={event.id}>
              <div className="item-main">
                <strong>{event.actorEmail ?? 'sistema'}</strong>
                <small>
                  {event.action} | {event.targetTable} | {new Date(event.createdAt).toLocaleString('pt-BR')}
                </small>
                <span>ID alvo: {event.targetId ?? 'n/a'}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </AppLayout>
  )
}
