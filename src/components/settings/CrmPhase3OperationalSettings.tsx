import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { pageQuietCardClass } from '@/components/page/PageSection'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NoticeBanner } from '@/components/NoticeBanner'
import { useCrm } from '@/context/CrmContext'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'
import { getDataProviderMode } from '@/services/dataMode'
import { initialOrgSettings, type AppointmentCompletedRouting } from '@/mocks/crmMock'

type QuickRow = {
  id: string
  shortcut: string
  content: string
  category: string | null
  sort_order: number
}

type FollowupRow = {
  id: string
  pipeline_id: string
  day_number: number
  message_template: string
  enabled: boolean
}

const defaultRouting: AppointmentCompletedRouting =
  initialOrgSettings.appointmentCompletedRouting ?? {
    sourcePipelineId: 'pipeline-clinica',
    targetPipelineId: 'pipeline-tratamento-capilar',
    targetStageId: 'tc-novo',
  }

const FOLLOWUP_DAYS = [1, 3, 5] as const

export function CrmPhase3OperationalSettings() {
  const crm = useCrm()
  const dataMode = getDataProviderMode()
  const online = dataMode === 'supabase' && isSupabaseConfigured

  const [quickRows, setQuickRows] = useState<QuickRow[]>([])
  const [qmShortcut, setQmShortcut] = useState('')
  const [qmContent, setQmContent] = useState('')
  const [qmCategory, setQmCategory] = useState('')
  const [followupRows, setFollowupRows] = useState<FollowupRow[]>([])

  const loadQuick = useCallback(async () => {
    if (!online || !supabase) return
    const { data, error } = await supabase
      .from('crm_quick_messages')
      .select('id, shortcut, content, category, sort_order')
      .order('sort_order', { ascending: true })
    if (error) {
      toast.error(error.message)
      return
    }
    setQuickRows((data ?? []) as QuickRow[])
  }, [online])

  const loadFollowup = useCallback(async () => {
    if (!online || !supabase) return
    const { data, error } = await supabase
      .from('crm_followup_configs')
      .select('id, pipeline_id, day_number, message_template, enabled')
      .order('pipeline_id')
      .order('day_number')
    if (error) {
      toast.error(error.message)
      return
    }
    setFollowupRows((data ?? []) as FollowupRow[])
  }, [online])

  useEffect(() => {
    void loadQuick()
    void loadFollowup()
  }, [loadQuick, loadFollowup])

  const routing = crm.orgSettings.appointmentCompletedRouting ?? defaultRouting

  const followupFor = (pipelineId: string, day: number): FollowupRow | undefined =>
    followupRows.find((r) => r.pipeline_id === pipelineId && r.day_number === day)

  const handleSaveFollowup = async (pipelineId: string, day: number, message_template: string, enabled: boolean) => {
    if (!online || !supabase) return
    const { error } = await supabase.from('crm_followup_configs').upsert(
      {
        pipeline_id: pipelineId,
        day_number: day,
        message_template,
        enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'pipeline_id,day_number' },
    )
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Template de follow-up guardado.')
    void loadFollowup()
  }

  const handleAddQuick = async () => {
    if (!online || !supabase) return
    const sc = qmShortcut.trim().toLowerCase()
    if (!sc || !qmContent.trim()) {
      toast.error('Preencha atalho e conteúdo.')
      return
    }
    const { error } = await supabase.from('crm_quick_messages').insert({
      shortcut: sc,
      content: qmContent.trim(),
      category: qmCategory.trim() || null,
      sort_order: quickRows.length,
    })
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Mensagem rápida criada.')
    setQmShortcut('')
    setQmContent('')
    setQmCategory('')
    void loadQuick()
  }

  const handleDeleteQuick = async (id: string) => {
    if (!online || !supabase) return
    const { error } = await supabase.from('crm_quick_messages').delete().eq('id', id)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Removida.')
    void loadQuick()
  }

  return (
    <div className="mt-6 space-y-6">
      {!online ? (
        <NoticeBanner
          message="Mensagens rápidas e templates de follow-up usam a base Supabase. Ative o modo Supabase para editar."
          variant="warning"
          className="mb-2"
        />
      ) : null}

      <Card className={cn(pageQuietCardClass)}>
        <CardHeader>
          <CardTitle className="text-base">Mensagens rápidas (atalho / no chat)</CardTitle>
          <p className="m-0 mt-1 text-xs text-muted-foreground">
            No chat do lead, digite / para filtrar por atalho. Use {'{{name}}'} nos templates de follow-up, não aqui.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {online ? (
            <>
              <ul className="m-0 list-none space-y-2 divide-y divide-border/40 p-0">
                {quickRows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0">
                    <div className="min-w-0 flex-1">
                      <code className="text-xs font-bold text-primary">/{row.shortcut}</code>
                      {row.category ? (
                        <span className="ml-2 text-[10px] uppercase text-muted-foreground">{row.category}</span>
                      ) : null}
                      <p className="m-0 mt-1 text-xs text-muted-foreground line-clamp-2">{row.content}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-destructive"
                      onClick={() => void handleDeleteQuick(row.id)}
                      aria-label="Remover mensagem"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="grid gap-3 rounded-xl border border-border/50 bg-muted/10 p-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Atalho (sem /)</Label>
                  <Input value={qmShortcut} onChange={(e) => setQmShortcut(e.target.value)} placeholder="ola" />
                </div>
                <div className="grid gap-2">
                  <Label>Categoria (opcional)</Label>
                  <Input value={qmCategory} onChange={(e) => setQmCategory(e.target.value)} placeholder="saudação" />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label>Texto da mensagem</Label>
                  <Textarea value={qmContent} onChange={(e) => setQmContent(e.target.value)} rows={3} />
                </div>
                <div className="sm:col-span-2">
                  <Button type="button" onClick={() => void handleAddQuick()}>
                    Adicionar mensagem
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">Indisponível neste modo de dados.</p>
          )}
        </CardContent>
      </Card>

      <Card className={cn(pageQuietCardClass)}>
        <CardHeader>
          <CardTitle className="text-base">Follow-up automático (D1 / D3 / D5)</CardTitle>
          <p className="m-0 mt-1 text-xs text-muted-foreground">
            O worker horário envia quando não há resposta há 24h, 72h e 120h (com estado ativo). Use {'{{name}}'} no texto.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {online ? (
            crm.pipelineCatalog.map((pipeline) => (
              <div key={pipeline.id} className="space-y-3">
                <h3 className="m-0 text-xs font-black uppercase tracking-widest text-muted-foreground">{pipeline.name}</h3>
                {FOLLOWUP_DAYS.map((day) => {
                  const row = followupFor(pipeline.id, day)
                  return (
                    <FollowupDayEditor
                      key={`${pipeline.id}-${day}`}
                      pipelineId={pipeline.id}
                      day={day}
                      initialTemplate={row?.message_template ?? ''}
                      initialEnabled={row?.enabled ?? true}
                      onSave={(message_template, enabled) =>
                        void handleSaveFollowup(pipeline.id, day, message_template, enabled)
                      }
                    />
                  )
                })}
              </div>
            ))
          ) : (
            <p className="m-0 text-sm text-muted-foreground">Indisponível neste modo de dados.</p>
          )}
        </CardContent>
      </Card>

      <Card className={cn(pageQuietCardClass)}>
        <CardHeader>
          <CardTitle className="text-base">Consulta realizada → mover lead de funil</CardTitle>
          <p className="m-0 mt-1 text-xs text-muted-foreground">
            Quando a marcação fica <strong>Realizada</strong> ou presença <strong>Compareceu</strong>, o lead no funil de
            origem é enviado para o funil e etapa abaixo.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:max-w-xl">
          <div className="grid gap-2">
            <Label>Funil de origem (onde o lead está)</Label>
            <Select
              value={routing.sourcePipelineId}
              onValueChange={(v) => {
                if (!v) return
                crm.updateOrgSettings({
                  appointmentCompletedRouting: { ...routing, sourcePipelineId: v },
                })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {crm.pipelineCatalog.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Funil de destino</Label>
            <Select
              value={routing.targetPipelineId}
              onValueChange={(v) => {
                if (!v) return
                const p = crm.pipelineCatalog.find((x) => x.id === v)
                const firstStage = p?.stages[0]?.id ?? routing.targetStageId
                crm.updateOrgSettings({
                  appointmentCompletedRouting: {
                    ...routing,
                    targetPipelineId: v,
                    targetStageId: firstStage,
                  },
                })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {crm.pipelineCatalog.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Etapa no funil de destino</Label>
            <Select
              value={routing.targetStageId}
              onValueChange={(v) => {
                if (!v) return
                crm.updateOrgSettings({
                  appointmentCompletedRouting: { ...routing, targetStageId: v },
                })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(crm.pipelineCatalog.find((p) => p.id === routing.targetPipelineId)?.stages ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function FollowupDayEditor({
  pipelineId,
  day,
  initialTemplate,
  initialEnabled,
  onSave,
}: {
  pipelineId: string
  day: number
  initialTemplate: string
  initialEnabled: boolean
  onSave: (message: string, enabled: boolean) => void
}) {
  const [text, setText] = useState(initialTemplate)
  const [enabled, setEnabled] = useState(initialEnabled)

  useEffect(() => {
    setText(initialTemplate)
    setEnabled(initialEnabled)
  }, [pipelineId, day, initialTemplate, initialEnabled])

  return (
    <div className="rounded-xl border border-border/40 bg-background/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Dia {day}</span>
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} id={`fu-${pipelineId}-${day}`} />
          <Label htmlFor={`fu-${pipelineId}-${day}`} className="text-xs cursor-pointer">
            Ativo
          </Label>
        </div>
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="text-sm" />
      <Button type="button" size="sm" variant="secondary" onClick={() => onSave(text, enabled)}>
        Guardar template
      </Button>
    </div>
  )
}
