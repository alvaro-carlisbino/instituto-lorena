import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ClipboardPen, Eye, Send } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Textarea } from '@/components/ui/textarea'
import { useCrm } from '@/context/CrmContext'
import {
  type FormResponse,
  type FormTemplate,
  type HrEmployee,
  getMyEmployee,
  listEmployees,
  listFormResponses,
  listFormTemplates,
  submitFormResponse,
} from '@/services/rhPonto'

const KIND_LABEL: Record<string, string> = {
  comportamental: 'Comportamental',
  personalidade: 'Personalidade',
  nr1: 'NR-1',
  outro: 'Outro',
}
const KIND_STYLE: Record<string, string> = {
  comportamental: 'bg-sky-500/15 text-sky-600',
  personalidade: 'bg-violet-500/15 text-violet-600',
  nr1: 'bg-amber-500/15 text-amber-600',
  outro: 'bg-muted text-muted-foreground',
}
const LIKERT = [1, 2, 3, 4, 5]

export function FormulariosRhPage() {
  const crm = useCrm()
  const isManager = crm.currentPermission.canManageUsers
  const [me, setMe] = useState<HrEmployee | null>(null)
  const [templates, setTemplates] = useState<FormTemplate[]>([])
  const [myResponses, setMyResponses] = useState<FormResponse[]>([])
  const [allResponses, setAllResponses] = useState<FormResponse[]>([])
  const [employees, setEmployees] = useState<HrEmployee[]>([])
  const [loaded, setLoaded] = useState(false)

  // preenchimento
  const [filling, setFilling] = useState<FormTemplate | null>(null)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [sending, setSending] = useState(false)

  // visualização (gestor)
  const [viewing, setViewing] = useState<FormResponse | null>(null)

  const load = async () => {
    try {
      const [emp, tpls] = await Promise.all([getMyEmployee(), listFormTemplates()])
      setMe(emp)
      setTemplates(tpls)
      if (emp) setMyResponses(await listFormResponses(emp.id))
      if (isManager) {
        const [resp, emps] = await Promise.all([listFormResponses(), listEmployees(true)])
        setAllResponses(resp)
        setEmployees(emps)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar formulários')
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager])

  const templateById = useMemo(() => new Map(templates.map((t) => [t.id, t] as const)), [templates])
  const employeeName = useMemo(() => new Map(employees.map((e) => [e.id, e.name] as const)), [employees])
  const answeredTemplateIds = useMemo(() => new Set(myResponses.map((r) => r.templateId)), [myResponses])

  const openFill = (tpl: FormTemplate) => {
    setFilling(tpl)
    setAnswers({})
  }

  const submit = async () => {
    if (!filling || !me) return
    const unanswered = filling.questions.filter((q) => q.type !== 'text' && answers[q.id] == null)
    if (unanswered.length > 0) {
      toast.error(`Responda todas as questões (faltam ${unanswered.length}).`)
      return
    }
    setSending(true)
    try {
      await submitFormResponse({ templateId: filling.id, employeeId: me.id, answers })
      toast.success(`"${filling.name}" enviado. Obrigado!`)
      setFilling(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao enviar respostas')
    } finally {
      setSending(false)
    }
  }

  return (
    <AppLayout
      title="Formulários de RH"
      subtitle="Perfil comportamental, personalidade e levantamento NR-1 (riscos psicossociais) — respostas por funcionário."
    >
      <div className={`grid gap-4 ${isManager ? 'xl:grid-cols-2' : ''}`}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ClipboardPen className="size-4 text-primary" /> Meus formulários
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {!loaded ? null : !me ? (
              <EmptyState
                icon={ClipboardPen}
                title="Você ainda não está no RH"
                description="Peça para a gestão te cadastrar como funcionário para responder os formulários."
              />
            ) : templates.length === 0 ? (
              <EmptyState icon={ClipboardPen} title="Sem formulários ativos" description="A gestão ainda não publicou formulários." />
            ) : (
              templates.map((t) => {
                const done = answeredTemplateIds.has(t.id)
                return (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        {t.name}
                        <Badge variant="secondary" className={KIND_STYLE[t.kind] ?? KIND_STYLE.outro}>
                          {KIND_LABEL[t.kind] ?? t.kind}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">{t.questions.length} questões</div>
                    </div>
                    {done ? (
                      <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600">respondido</Badge>
                    ) : (
                      <Button size="sm" onClick={() => openFill(t)}>Responder</Button>
                    )}
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        {isManager ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Eye className="size-4 text-primary" /> Respostas da equipe ({allResponses.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {allResponses.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nenhuma resposta ainda — peça para a equipe responder na tela Formulários RH.
                </p>
              ) : (
                allResponses.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{employeeName.get(r.employeeId) ?? '?'}</span>{' '}
                      <span className="text-xs text-muted-foreground">
                        {templateById.get(r.templateId)?.name ?? '?'} ·{' '}
                        {new Date(r.submittedAt).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setViewing(r)}>
                      <Eye className="size-3.5" /> Ver
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* preencher formulário */}
      <Dialog open={filling != null} onOpenChange={(open) => (!open ? setFilling(null) : null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{filling?.name}</DialogTitle>
            {filling?.description ? <DialogDescription>{filling.description}</DialogDescription> : null}
          </DialogHeader>
          <div className="space-y-4">
            {filling?.questions.map((q, idx) => (
              <div key={q.id} className="space-y-1.5">
                <p className="text-sm font-medium">
                  {idx + 1}. {q.text}
                </p>
                {q.type === 'likert' ? (
                  <div className="flex gap-1.5">
                    {LIKERT.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: n }))}
                        className={`size-9 rounded-md border text-sm font-medium transition-colors ${
                          answers[q.id] === n
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                ) : q.type === 'choice' ? (
                  <div className="space-y-1">
                    {(q.options ?? []).map((opt) => (
                      <label key={opt} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                        <input
                          type="radio"
                          name={q.id}
                          className="size-3.5 accent-primary"
                          checked={answers[q.id] === opt}
                          onChange={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                ) : (
                  <Textarea
                    value={String(answers[q.id] ?? '')}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    rows={2}
                    placeholder="Sua resposta (opcional)"
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => void submit()} disabled={sending}>
              <Send className="size-4" /> {sending ? 'Enviando…' : 'Enviar respostas'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ver resposta (gestor) */}
      <Dialog open={viewing != null} onOpenChange={(open) => (!open ? setViewing(null) : null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {viewing ? templateById.get(viewing.templateId)?.name ?? 'Resposta' : ''} —{' '}
              {viewing ? employeeName.get(viewing.employeeId) ?? '?' : ''}
            </DialogTitle>
            <DialogDescription>
              {viewing ? `Enviado em ${new Date(viewing.submittedAt).toLocaleString('pt-BR')}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {viewing
              ? (templateById.get(viewing.templateId)?.questions ?? []).map((q, idx) => (
                  <div key={q.id} className="rounded-md border border-border px-3 py-2 text-sm">
                    <p className="text-xs text-muted-foreground">
                      {idx + 1}. {q.text}
                    </p>
                    <p className="mt-0.5 font-medium">
                      {viewing.answers[q.id] != null && String(viewing.answers[q.id]).trim() !== ''
                        ? q.type === 'likert'
                          ? `${viewing.answers[q.id]} / 5`
                          : String(viewing.answers[q.id])
                        : '—'}
                    </p>
                  </div>
                ))
              : null}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
