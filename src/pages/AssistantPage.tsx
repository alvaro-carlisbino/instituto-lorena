import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { CrmAssistantChat } from '@/components/assistant/CrmAssistantChat'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import type { CrmAiAssistantContext, CrmAiAssistantFocus } from '@/services/crmAiAssistant'

const FOCUS_OPTIONS: { value: CrmAiAssistantFocus | 'general'; label: string }[] = [
  { value: 'general', label: 'Geral' },
  { value: 'analytics', label: 'Analytics / semana' },
  { value: 'lead', label: 'Lead em foco' },
]

function parseFocus(raw: string | null): CrmAiAssistantFocus | undefined {
  if (raw === 'analytics' || raw === 'lead' || raw === 'general') return raw
  return undefined
}

export function AssistantPage() {
  const crm = useCrm()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const leadIdParam = searchParams.get('leadId')?.trim() || undefined
  const weekStartIso = searchParams.get('week')?.trim() || undefined
  const focus = parseFocus(searchParams.get('focus'))

  const context: CrmAiAssistantContext = useMemo(
    () => ({
      leadId: leadIdParam,
      weekStartIso,
      focus,
    }),
    [focus, leadIdParam, weekStartIso]
  )

  const setFocus = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'general') next.delete('focus')
    else next.set('focus', value)
    setSearchParams(next, { replace: true })
  }

  const leadName = leadIdParam ? crm.leads.find((l) => l.id === leadIdParam)?.patientName : null

  return (
    <AppLayout
      title="Assistente CRM"
      subtitle="IA (GLM / Z.ai) sobre leads, métricas, interações e equipa — conforme as tuas permissões. Integrações Meta/WhatsApp/Evolution podem alimentar o snapshot no futuro."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,16rem)_1fr]">
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

        <CrmAssistantChat dataMode={crm.dataMode} context={context} />
      </div>
    </AppLayout>
  )
}
