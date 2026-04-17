import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'

export function AuditPage() {
  const crm = useCrm()
  const [actionFilter, setActionFilter] = useState<'all' | 'INSERT' | 'UPDATE' | 'DELETE'>('all')
  const [tableFilter, setTableFilter] = useState<string>('all')
  const [daysFilter, setDaysFilter] = useState<number>(7)
  const [page, setPage] = useState<number>(0)
  const pageSize = 20

  const uniqueTables = useMemo(
    () => Array.from(new Set(crm.auditRows.map((event) => event.targetTable))).sort(),
    [crm.auditRows],
  )

  useEffect(() => {
    if (!crm.currentPermission.canManageUsers) return

    const sinceDate = new Date(Date.now() - daysFilter * 24 * 60 * 60 * 1000).toISOString()

    void crm.fetchAuditPage({
      page,
      pageSize,
      action: actionFilter === 'all' ? undefined : actionFilter,
      targetTable: tableFilter === 'all' ? undefined : tableFilter,
      sinceIso: sinceDate,
    })
  }, [crm, page, actionFilter, tableFilter, daysFilter])

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="Auditoria" subtitle="Sem permissao para visualizar trilha de auditoria.">
        <section className="panel">
          <p>Seu perfil nao possui permissao para acessar auditoria.</p>
        </section>
      </AppLayout>
    )
  }

  const totalPages = Math.max(1, Math.ceil(crm.auditTotal / pageSize))

  return (
    <AppLayout title="Auditoria" subtitle="Eventos reais do banco com filtros e paginação server-side.">
      <section className="panel">
        <section className="panel toolbar">
          <select
            value={actionFilter}
            onChange={(event) => {
              setActionFilter(event.target.value as 'all' | 'INSERT' | 'UPDATE' | 'DELETE')
              setPage(0)
            }}
          >
            <option value="all">Todas acoes</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>

          <select
            value={tableFilter}
            onChange={(event) => {
              setTableFilter(event.target.value)
              setPage(0)
            }}
          >
            <option value="all">Todas tabelas</option>
            {uniqueTables.map((table) => (
              <option key={table} value={table}>
                {table}
              </option>
            ))}
          </select>

          <select
            value={daysFilter}
            onChange={(event) => {
              setDaysFilter(Number(event.target.value))
              setPage(0)
            }}
          >
            <option value={1}>Ultimas 24h</option>
            <option value={3}>Ultimos 3 dias</option>
            <option value={7}>Ultimos 7 dias</option>
            <option value={30}>Ultimos 30 dias</option>
          </select>

          <div className="inline-actions">
            <button onClick={() => setPage((previous) => Math.max(0, previous - 1))}>Anterior</button>
            <span className="badge">
              {page + 1}/{totalPages}
            </span>
            <button onClick={() => setPage((previous) => Math.min(totalPages - 1, previous + 1))}>Proxima</button>
          </div>
        </section>

        {crm.isLoading ? <p>Carregando trilha de auditoria...</p> : null}
        <ul className="editable-list">
          {crm.auditRows.map((event) => (
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
