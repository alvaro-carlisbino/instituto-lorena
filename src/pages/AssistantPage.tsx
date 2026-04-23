import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { History, MessageSquarePlus, Trash2 } from 'lucide-react'

import { CrmAssistantChat } from '@/components/assistant/CrmAssistantChat'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { cn } from '@/lib/utils'
import {
  deleteAssistantThread,
  listAssistantThreads,
  type AssistantThreadRow,
} from '@/services/assistantThreadsSupabase'
import type { CrmAiAssistantContext, CrmAiAssistantFocus } from '@/services/crmAiAssistant'
import { AppLayout } from '@/layouts/AppLayout'

const FOCUS_OPTIONS: { value: CrmAiAssistantFocus | 'general'; label: string }[] = [
  { value: 'general', label: 'Geral' },
  { value: 'analytics', label: 'Analytics / semana' },
  { value: 'lead', label: 'Lead em foco' },
]

function parseFocus(raw: string | null): CrmAiAssistantFocus | undefined {
  if (raw === 'analytics' || raw === 'lead' || raw === 'general') return raw
  return undefined
}

function formatThreadWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return ''
  }
}

export function AssistantPage() {
  const crm = useCrm()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [threads, setThreads] = useState<AssistantThreadRow[]>([])

  const leadIdParam = searchParams.get('leadId')?.trim() || undefined
  const weekStartIso = searchParams.get('week')?.trim() || undefined
  const focus = parseFocus(searchParams.get('focus'))
  const threadIdParam = searchParams.get('threadId')?.trim() || undefined

  const context: CrmAiAssistantContext = useMemo(
    () => ({
      leadId: leadIdParam,
      weekStartIso,
      focus,
    }),
    [focus, leadIdParam, weekStartIso],
  )

  const reloadThreads = useCallback(async () => {
    if (crm.dataMode !== 'supabase') return
    setThreads(await listAssistantThreads())
  }, [crm.dataMode])

  useEffect(() => {
    void reloadThreads()
  }, [reloadThreads])

  const setThreadId = useCallback(
    (id: string | undefined) => {
      const next = new URLSearchParams(searchParams)
      if (id) next.set('threadId', id)
      else next.delete('threadId')
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const setFocus = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'general') next.delete('focus')
    else next.set('focus', value)
    setSearchParams(next, { replace: true })
  }

  const startNewConversation = () => {
    setThreadId(undefined)
  }

  const deleteThread = async (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Eliminar esta conversa? Esta ação não pode ser anulada.')) return
    const ok = await deleteAssistantThread(id)
    if (!ok) return
    if (threadIdParam === id) setThreadId(undefined)
    void reloadThreads()
  }

  const leadName = leadIdParam ? crm.leads.find((l) => l.id === leadIdParam)?.patientName : null

  return (
    <AppLayout
      title="Assistente CRM"
      subtitle="IA (GLM / Z.ai) sobre leads, métricas, interações e equipa — conforme as tuas permissões. Integrações Meta/WhatsApp/Evolution podem alimentar o snapshot no futuro."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,19rem)_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="h-fit border-border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Contexto</CardTitle>
              <CardDescription className="text-xs">
                Ajusta o foco enviado ao servidor. O <strong className="text-foreground">leadId</strong> pode vir da URL (
                <code className="text-[10px]">?leadId=…</code>) ao abrir a partir do Kanban.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">Foco da pergunta</Label>
                <Select value={focus ?? 'general'} onValueChange={(v) => v && setFocus(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FOCUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {leadIdParam ? (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                  <p className="m-0 font-medium text-foreground">Lead em foco</p>
                  <p className="mt-1 mb-2 font-mono text-[10px] text-muted-foreground">{leadIdParam}</p>
                  {leadName ? <p className="m-0 text-foreground">{leadName}</p> : null}
                  <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => navigate('/assistente')}>
                    Limpar lead da URL
                  </Button>
                </div>
              ) : (
                <p className="m-0 text-xs text-muted-foreground">
                  Dica: no Kanban, no futuro podes ligar um botão «Perguntar à IA» com{' '}
                  <code className="text-[10px]">/assistente?leadId=…&amp;focus=lead</code>.
                </p>
              )}
            </CardContent>
          </Card>

          {crm.dataMode === 'supabase' ? (
            <Card className="border-border shadow-sm">
              <CardHeader className="space-y-2 pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <History className="size-4 text-muted-foreground" />
                  Histórico
                </CardTitle>
                <CardDescription className="text-xs">
                  Conversas guardadas na tua conta. «Nova conversa» limpa o painel e inicia outro fio (a URL perde{' '}
                  <code className="text-[10px]">threadId</code>).
                </CardDescription>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full justify-start gap-2 rounded-none text-xs font-bold uppercase tracking-widest"
                  onClick={startNewConversation}
                >
                  <MessageSquarePlus className="size-4 shrink-0" />
                  Nova conversa
                </Button>
              </CardHeader>
              <CardContent className="pt-0">
                {threads.length === 0 ? (
                  <p className="m-0 text-xs text-muted-foreground">Ainda não há conversas guardadas.</p>
                ) : (
                  <ScrollArea className="h-[min(20rem,40vh)] pr-2">
                    <ul className="m-0 list-none space-y-1 p-0">
                      {threads.map((t) => {
                        const active = threadIdParam === t.id
                        const label = t.title?.trim() || 'Sem título'
                        return (
                          <li key={t.id} className="flex gap-1">
                            <button
                              type="button"
                              className={cn(
                                'min-w-0 flex-1 rounded-md border px-2 py-2 text-left text-xs transition-colors',
                                active
                                  ? 'border-primary bg-primary/10 text-foreground'
                                  : 'border-transparent bg-muted/40 hover:bg-muted/70',
                              )}
                              onClick={() => setThreadId(t.id)}
                            >
                              <span className="line-clamp-2 font-medium">{label}</span>
                              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                {formatThreadWhen(t.updated_at)}
                              </span>
                            </button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                              aria-label="Eliminar conversa"
                              onClick={(e) => void deleteThread(e, t.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </li>
                        )
                      })}
                    </ul>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <CrmAssistantChat
          dataMode={crm.dataMode}
          context={context}
          activeThreadId={threadIdParam}
          onActiveThreadChange={setThreadId}
          onThreadListInvalidate={reloadThreads}
        />
      </div>
    </AppLayout>
  )
}
