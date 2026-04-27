import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import type { LeadTask } from '@/mocks/crmMock'

export function TasksPage() {
  const crm = useCrm()
  const [filter, setFilter] = useState<'mine' | 'all' | 'open' | 'done'>('open')
  const [npsScore, setNpsScore] = useState('9')
  const [npsComment, setNpsComment] = useState('')
  const [npsDispatchId, setNpsDispatchId] = useState('')

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

  const recordNps = () => {
    const id = npsDispatchId.trim()
    if (!id) {
      toast.error('Informe o código da pesquisa enviada.')
      return
    }
    const score = Math.min(10, Math.max(0, Math.round(Number(npsScore))))
    crm.recordSurveyResponse(id, score, npsComment.trim() || null)
    toast.success('Resposta NPS registrada.')
    setNpsComment('')
  }

  const toggleDone = (t: LeadTask) => {
    const next = t.status === 'done' ? 'open' : 'done'
    crm.updateLeadTask(t.id, { status: next })
  }

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Tarefas" subtitle="Follow-up e pós-atendimento.">
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">Sem permissão para ver tarefas.</CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Tarefas e NPS" subtitle="Follow-up e NPS (registro manual, MVP).">
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
          <CardTitle className="text-base">Tarefas ({tasks.length})</CardTitle>
          <CardDescription>Tarefas podem ser criadas automaticamente ao avançar um lead no processo.</CardDescription>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrar NPS</CardTitle>
          <CardDescription>
            Ao concluir um atendimento, uma pesquisa pode ser enviada. Informe o código da pesquisa e a nota (0–10).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-md gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="dispatch-id">Código da pesquisa</Label>
            <Input id="dispatch-id" value={npsDispatchId} onChange={(e) => setNpsDispatchId(e.target.value)} placeholder="disp-…" />
          </div>
          <div className="grid gap-1.5">
            <Label>Nota</Label>
            <Select value={npsScore} onValueChange={(v) => v && setNpsScore(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 11 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nps-comment">Comentário (opcional)</Label>
            <Input id="nps-comment" value={npsComment} onChange={(e) => setNpsComment(e.target.value)} />
          </div>
          <Button type="button" onClick={recordNps}>
            Salvar resposta
          </Button>
          {crm.surveyDispatches.length > 0 ? (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Pesquisas recentes (copie o código)</p>
              <ul className="m-0 max-h-40 list-none space-y-1 overflow-y-auto p-0 font-mono text-[11px]">
                {crm.surveyDispatches.slice(0, 12).map((d) => (
                  <li key={d.id} className="flex justify-between gap-2 truncate">
                    <button type="button" className="truncate text-left underline" onClick={() => setNpsDispatchId(d.id)}>
                      {d.id}
                    </button>
                    <span className="shrink-0 text-muted-foreground">{d.leadId}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </AppLayout>
  )
}
