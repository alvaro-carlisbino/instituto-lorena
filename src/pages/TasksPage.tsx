import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import type { LeadTask } from '@/mocks/crmMock'

export function TasksPage() {
  const crm = useCrm()
  const [filter, setFilter] = useState<'mine' | 'all' | 'open' | 'done'>('open')

  const tasks = useMemo(() => {
    let list = [...crm.leadTasks]
    if (filter === 'mine' && crm.myAppUserId) {
      list = list.filter((t) => t.assigneeId === crm.myAppUserId)
    }
    if (filter === 'open') list = list.filter((t) => t.status === 'open')
    if (filter === 'done') list = list.filter((t) => t.status === 'done')
    return list.sort((a, b) => {
      const da = a.dueAt ? new Date(a.dueAt).getTime() : 0
      const db = b.dueAt ? new Date(b.dueAt).getTime() : 0
      return da - db
    })
  }, [crm.leadTasks, crm.myAppUserId, filter])

  const toggleDone = (t: LeadTask) => {
    const next = t.status === 'done' ? 'open' : 'done'
    crm.updateLeadTask(t.id, { status: next })
  }

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Tarefas">
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">Sem permissão para ver tarefas.</CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Tarefas">
      <div className="mb-4 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={filter === 'open' ? 'default' : 'outline'} onClick={() => setFilter('open')}>
          Abertas
        </Button>
        <Button type="button" size="sm" variant={filter === 'done' ? 'default' : 'outline'} onClick={() => setFilter('done')}>
          Concluídas
        </Button>
        <Button type="button" size="sm" variant={filter === 'mine' ? 'default' : 'outline'} onClick={() => setFilter('mine')}>
          Minhas
        </Button>
        <Button type="button" size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>
          Todas
        </Button>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Tarefas · {tasks.length}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma tarefa neste filtro.</p>
          ) : (
            tasks.map((t) => {
              const lead = crm.leads.find((l) => l.id === t.leadId)
              return (
                <div
                  key={t.id}
                  className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="m-0 font-medium">{t.title}</p>
                    <p className="m-0 text-xs text-muted-foreground">
                      Lead: {lead?.patientName ?? t.leadId} · Vence:{' '}
                      {t.dueAt ? new Date(t.dueAt).toLocaleString('pt-BR') : '—'}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => toggleDone(t)}>
                    {t.status === 'done' ? 'Reabrir' : 'Concluir'}
                  </Button>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

    </AppLayout>
  )
}
