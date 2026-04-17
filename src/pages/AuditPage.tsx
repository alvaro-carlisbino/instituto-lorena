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
  const [actionFilter, setActionFilter] = useState<'all' | 'INSERT' | 'UPDATE' | 'DELETE'>('all')
  const [tableFilter, setTableFilter] = useState<string>('all')
  const [daysFilter, setDaysFilter] = useState<number>(7)

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

  const uniqueTables = Array.from(new Set(auditEvents.map((event) => event.targetTable))).sort()

  const filteredEvents = auditEvents.filter((event) => {
    const actionOk = actionFilter === 'all' || event.action === actionFilter
    const tableOk = tableFilter === 'all' || event.targetTable === tableFilter
    const daysOk =
      Date.now() - new Date(event.createdAt).getTime() <=
      daysFilter * 24 * 60 * 60 * 1000
    return actionOk && tableOk && daysOk
  })

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
        <section className="panel toolbar">
          <select
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value as 'all' | 'INSERT' | 'UPDATE' | 'DELETE')}
          >
            <option value="all">Todas acoes</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>

          <select value={tableFilter} onChange={(event) => setTableFilter(event.target.value)}>
            <option value="all">Todas tabelas</option>
            {uniqueTables.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>

          <select value={daysFilter} onChange={(event) => setDaysFilter(Number(event.target.value))}>
            <option value={1}>Ultimas 24h</option>
            <option value={3}>Ultimos 3 dias</option>
            <option value={7}>Ultimos 7 dias</option>
            <option value={30}>Ultimos 30 dias</option>
          </select>
        </section>

        {auditLoading ? <p>Carregando trilha de auditoria...</p> : null}
        {auditNotice ? <p>{auditNotice}</p> : null}
        <ul className="editable-list">
          {filteredEvents.map((event) => (
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
