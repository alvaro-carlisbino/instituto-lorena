import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { diaLocal, hojeLocal } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'
import type { LeadTask } from '@/mocks/crmMock'

type Filtro = 'today' | 'late' | 'mine' | 'open' | 'done' | 'all'

/** Tarefa aberta com data marcada para antes de hoje. */
function estaAtrasada(t: LeadTask, hoje: string): boolean {
  return t.status === 'open' && !!t.dueAt && diaLocal(t.dueAt) < hoje
}

function venceHoje(t: LeadTask, hoje: string): boolean {
  return t.status === 'open' && !!t.dueAt && diaLocal(t.dueAt) === hoje
}

export function TasksPage() {
  const crm = useCrm()
  // Abre no que a Ingrid precisa ver de manhã, não na lista inteira de abertas: o
  // combinado com o paciente ("me chama quando eu voltar de viagem") só vira contato
  // se o dia dele estiver na primeira tela.
  const [filter, setFilter] = useState<Filtro>('today')

  const hoje = hojeLocal()

  const contagem = useMemo(
    () => ({
      hoje: crm.leadTasks.filter((t) => venceHoje(t, hoje)).length,
      atrasadas: crm.leadTasks.filter((t) => estaAtrasada(t, hoje)).length,
    }),
    [crm.leadTasks, hoje],
  )

  const tasks = useMemo(() => {
    let list = [...crm.leadTasks]
    if (filter === 'today') list = list.filter((t) => venceHoje(t, hoje))
    if (filter === 'late') list = list.filter((t) => estaAtrasada(t, hoje))
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
  }, [crm.leadTasks, crm.myAppUserId, filter, hoje])

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

  const abas: { id: Filtro; label: string; count?: number; tone?: string }[] = [
    { id: 'today', label: 'Vencem hoje', count: contagem.hoje },
    { id: 'late', label: 'Atrasadas', count: contagem.atrasadas, tone: 'text-red-600' },
    { id: 'open', label: 'Abertas' },
    { id: 'mine', label: 'Minhas' },
    { id: 'done', label: 'Concluídas' },
    { id: 'all', label: 'Todas' },
  ]

  const vazio =
    filter === 'today'
      ? 'Nenhum retorno marcado para hoje.'
      : filter === 'late'
        ? 'Nada atrasado. Follow-up em dia.'
        : 'Nenhuma tarefa neste filtro.'

  return (
    <AppLayout
      title="Tarefas"
      subtitle="Follow-up com data marcada. O que vence hoje aparece também no sino do cabeçalho."
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {abas.map((aba) => (
          <Button
            key={aba.id}
            type="button"
            size="sm"
            variant={filter === aba.id ? 'default' : 'outline'}
            onClick={() => setFilter(aba.id)}
          >
            {aba.label}
            {aba.count ? (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                  // Na aba ativa o fundo já é o primário: `bg-muted` clareava tudo e o
                  // número sumia dentro de uma bolinha branca.
                  filter === aba.id
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : cn('bg-muted', aba.tone),
                )}
              >
                {aba.count}
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Tarefas · {tasks.length}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{vazio}</p>
          ) : (
            tasks.map((t) => {
              const lead = crm.leads.find((l) => l.id === t.leadId)
              const atrasada = estaAtrasada(t, hoje)
              return (
                <div
                  key={t.id}
                  className={cn(
                    'flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between',
                    atrasada ? 'border-red-500/30 bg-red-500/[0.03]' : 'border-border',
                  )}
                >
                  <div className="min-w-0">
                    <p className="m-0 flex items-center gap-2 font-medium">
                      <span className="truncate">{t.title}</span>
                      {atrasada ? (
                        <span className="shrink-0 rounded-md bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-red-700">
                          Atrasada
                        </span>
                      ) : null}
                    </p>
                    <p className="m-0 text-xs text-muted-foreground">
                      Lead: {lead?.patientName ?? t.leadId} · Vence:{' '}
                      {t.dueAt ? new Date(t.dueAt).toLocaleString('pt-BR') : '—'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* Sem isto, ver a tarefa e falar com a pessoa eram duas telas e uma busca. */}
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={
                        <Link to={`/chat?leadId=${encodeURIComponent(t.leadId)}`}>
                          <MessageCircle className="size-3.5" aria-hidden /> Abrir conversa
                        </Link>
                      }
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => toggleDone(t)}>
                      {t.status === 'done' ? 'Reabrir' : 'Concluir'}
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </AppLayout>
  )
}
