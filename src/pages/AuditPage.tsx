import { useEffect, useMemo, useState } from 'react'
import { ClipboardListIcon, PlusCircleIcon, MinusCircleIcon, PencilIcon } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

const ACTION_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  INSERT: 'default',
  UPDATE: 'secondary',
  DELETE: 'destructive',
}

const ACTION_ICON: Record<string, typeof PlusCircleIcon> = {
  INSERT: PlusCircleIcon,
  UPDATE: PencilIcon,
  DELETE: MinusCircleIcon,
}

const ACTION_LABEL: Record<string, string> = {
  INSERT: 'Criado',
  UPDATE: 'Atualizado',
  DELETE: 'Removido',
}

const FRIENDLY_TABLE: Record<string, string> = {
  leads: 'Leads',
  interactions: 'Interações',
  channels: 'Canais',
  users: 'Usuários',
  profiles: 'Perfis',
  settings: 'Configurações',
  workflow_fields: 'Campos personalizados',
  capture_submissions: 'Formulários',
}

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
      <AppLayout title="Auditoria">
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
    <AppLayout title="Auditoria">
      <Card className="shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={actionFilter}
              onValueChange={(value) => {
                setActionFilter(value as 'all' | 'INSERT' | 'UPDATE' | 'DELETE')
                setPage(0)
              }}
            >
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas ações</SelectItem>
                <SelectItem value="INSERT">Criação</SelectItem>
                <SelectItem value="UPDATE">Atualização</SelectItem>
                <SelectItem value="DELETE">Remoção</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={tableFilter}
              onValueChange={(value) => {
                setTableFilter(value ?? 'all')
                setPage(0)
              }}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {uniqueTables.map((table) => (
                  <SelectItem key={table} value={table}>
                    {FRIENDLY_TABLE[table] ?? table}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={String(daysFilter)}
              onValueChange={(value) => {
                setDaysFilter(Number(value))
                setPage(0)
              }}
            >
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Últimas 24 h</SelectItem>
                <SelectItem value="3">Últimos 3 dias</SelectItem>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
              </SelectContent>
            </Select>

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

          {crm.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2 p-3">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
              ))}
            </div>
          ) : crm.auditRows.length === 0 ? (
            <EmptyState
              icon={ClipboardListIcon}
              title="Nenhum evento encontrado"
              description="Ajuste os filtros ou aguarde novas ações no sistema."
            />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {crm.auditRows.map((event) => {
                const ActionIcon = ACTION_ICON[event.action] ?? ClipboardListIcon
                return (
                  <li key={event.id} className="flex items-start gap-3 p-3 text-sm hover:bg-muted/5 transition-colors">
                    <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
                      <ActionIcon className="size-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="m-0 font-medium">{event.actorEmail ?? 'sistema'}</p>
                        <Badge variant={ACTION_VARIANT[event.action] ?? 'outline'} className="text-[10px] uppercase tracking-widest font-bold">
                          {ACTION_LABEL[event.action] ?? event.action}
                        </Badge>
                      </div>
                      <p className="m-0 text-xs text-muted-foreground">
                        {FRIENDLY_TABLE[event.targetTable] ?? event.targetTable} · {new Date(event.createdAt).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  )
}
