import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

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
      <AppLayout title="Auditoria" subtitle="Sem permissão para visualizar a trilha de auditoria.">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Seu perfil não pode acessar auditoria.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  const totalPages = Math.max(1, Math.ceil(crm.auditTotal / pageSize))

  return (
    <AppLayout title="Auditoria" subtitle="Eventos reais do banco com filtros e paginação no servidor.">
      <Card className="shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={actionFilter}
              onChange={(event) => {
                setActionFilter(event.target.value as 'all' | 'INSERT' | 'UPDATE' | 'DELETE')
                setPage(0)
              }}
            >
              <option value="all">Todas ações</option>
              <option value="INSERT">INSERT</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
            </select>

            <select
              className="h-8 min-w-[8rem] rounded-md border border-input bg-background px-2 text-sm"
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
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={daysFilter}
              onChange={(event) => {
                setDaysFilter(Number(event.target.value))
                setPage(0)
              }}
            >
              <option value={1}>Últimas 24 h</option>
              <option value={3}>Últimos 3 dias</option>
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
            </select>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((previous) => Math.max(0, previous - 1))}>
                Anterior
              </Button>
              <Badge variant="secondary" className="tabular-nums">
                {page + 1}/{totalPages}
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((previous) => Math.min(totalPages - 1, previous + 1))}
              >
                Próxima
              </Button>
            </div>
          </div>

          {crm.isLoading ? <p className="text-sm text-muted-foreground">Carregando trilha de auditoria…</p> : null}

          <ul className="divide-y divide-border rounded-lg border border-border">
            {crm.auditRows.map((event) => (
              <li key={event.id} className="space-y-1 p-3 text-sm">
                <p className="m-0 font-medium">{event.actorEmail ?? 'sistema'}</p>
                <p className="m-0 text-xs text-muted-foreground">
                  {event.action} · {event.targetTable} · {new Date(event.createdAt).toLocaleString('pt-BR')}
                </p>
                <p className="m-0 text-muted-foreground">ID alvo: {event.targetId ?? 'n/a'}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
