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
import { useTenant } from '@/context/TenantContext'
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

/**
 * Um degrau da cadência de agendamento (24h / 48h / 7 dias), como vive em
 * `tenant_integrations.outreach.agendamento.passos`.
 */
type PassoAgendamento = {
  horas: number
  texto: string
  video: boolean
}

type ConfigAgendamento = {
  enabled: boolean
  passos: PassoAgendamento[]
}

const defaultRouting: AppointmentCompletedRouting =
  initialOrgSettings.appointmentCompletedRouting ?? {
    sourcePipelineId: 'pipeline-clinica',
    targetPipelineId: 'pipeline-tratamento-capilar',
    targetStageId: 'tc-novo',
  }

/** Nome de cada degrau na tela. A hora real vem do banco. */
const ROTULO_DEGRAU = ['24 horas', '48 horas', '7 dias']

export function CrmPhase3OperationalSettings() {
  const crm = useCrm()
  const { tenant } = useTenant()
  const dataMode = getDataProviderMode()
  const online = dataMode === 'supabase' && isSupabaseConfigured

  const [quickRows, setQuickRows] = useState<QuickRow[]>([])
  const [qmShortcut, setQmShortcut] = useState('')
  const [qmContent, setQmContent] = useState('')
  const [qmCategory, setQmCategory] = useState('')
  const [agendamento, setAgendamento] = useState<ConfigAgendamento | null>(null)

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

  const loadAgendamento = useCallback(async () => {
    if (!online || !supabase) return
    const { data, error } = await supabase
      .from('tenant_integrations')
      .select('outreach')
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    if (error) {
      toast.error(error.message)
      return
    }
    const outreach = ((data?.outreach ?? {}) as Record<string, unknown>)
    const cfg = (outreach.agendamento ?? null) as Record<string, unknown> | null
    if (!cfg) {
      setAgendamento(null)
      return
    }
    setAgendamento({
      enabled: cfg.enabled === true,
      passos: (Array.isArray(cfg.passos) ? cfg.passos : []).map((p) => {
        const row = (p ?? {}) as Record<string, unknown>
        return {
          horas: Number(row.horas ?? 0),
          texto: String(row.texto ?? ''),
          video: row.video === true,
        }
      }),
    })
  }, [online, tenant.id])

  useEffect(() => {
    void loadQuick()
    void loadAgendamento()
  }, [loadQuick, loadAgendamento])

  const routing = crm.orgSettings.appointmentCompletedRouting ?? defaultRouting

  /**
   * Grava a cadência inteira de uma vez.
   *
   * `outreach` é um JSON com mais coisa dentro (o primeiro contato do formulário mora ao
   * lado). Ler, mesclar e devolver o objeto todo é o que impede este painel de apagar a
   * configuração do vizinho — um `update` com `{agendamento: …}` cru levaria o
   * `leadform` junto.
   */
  const salvarAgendamento = async (proximo: ConfigAgendamento) => {
    if (!online || !supabase) return
    const { data, error: readErr } = await supabase
      .from('tenant_integrations')
      .select('outreach')
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    if (readErr) {
      toast.error(readErr.message)
      return
    }
    const outreach = ((data?.outreach ?? {}) as Record<string, unknown>)
    const anterior = ((outreach.agendamento ?? {}) as Record<string, unknown>)
    const { error } = await supabase
      .from('tenant_integrations')
      .update({
        outreach: {
          ...outreach,
          // `ativado_em`, `video_path`, `max_dias` e `cap_por_rodada` continuam como
          // estavam: são a trava de backlog e o ritmo, não texto de mensagem.
          agendamento: { ...anterior, enabled: proximo.enabled, passos: proximo.passos },
        },
      })
      .eq('tenant_id', tenant.id)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Cadência de agendamento guardada.')
    void loadAgendamento()
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
          <CardTitle className="text-base">Follow-up de agendamento (24h / 48h / 7 dias)</CardTitle>
          <p className="m-0 mt-1 text-xs text-muted-foreground">
            Fala com quem conversou, ouviu sobre a consulta e <strong>parou de responder sem agendar</strong>. Quem está
            esperando resposta nossa é outra rotina, e quem já agendou não entra aqui. Responder cancela os degraus
            seguintes.
          </p>
          <p className="m-0 mt-2 text-xs text-muted-foreground">
            Etiquetas: <code>{'{{primeiro_nome}}'}</code> ·{' '}
            <code>{'{{saudacao}}'}</code> (bom dia / boa tarde / boa noite pela hora do envio) ·{' '}
            <code>{'{{saudacao_maiuscula}}'}</code> para começar a frase ·{' '}
            <code>{'{{consulta_medico}}'}</code> vira “ com a Dra. Lorena” quando a conversa registrou o médico, e some
            quando não registrou.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!online ? (
            <p className="m-0 text-sm text-muted-foreground">Indisponível neste modo de dados.</p>
          ) : !agendamento ? (
            <p className="m-0 text-sm text-muted-foreground">
              Este polo não tem cadência de agendamento configurada.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Switch
                  id="agendamento-enabled"
                  checked={agendamento.enabled}
                  onCheckedChange={(v) => void salvarAgendamento({ ...agendamento, enabled: v === true })}
                />
                <Label htmlFor="agendamento-enabled" className="cursor-pointer text-sm">
                  Cadência ligada
                </Label>
              </div>
              {agendamento.passos.map((passo, i) => (
                <PassoAgendamentoEditor
                  key={i}
                  rotulo={ROTULO_DEGRAU[i] ?? `${passo.horas} horas`}
                  passo={passo}
                  onSave={(texto) =>
                    void salvarAgendamento({
                      ...agendamento,
                      passos: agendamento.passos.map((p, j) => (j === i ? { ...p, texto } : p)),
                    })
                  }
                />
              ))}
            </>
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

function PassoAgendamentoEditor({
  rotulo,
  passo,
  onSave,
}: {
  rotulo: string
  passo: PassoAgendamento
  onSave: (texto: string) => void
}) {
  const [texto, setTexto] = useState(passo.texto)

  useEffect(() => {
    setTexto(passo.texto)
  }, [passo.texto])

  const sujo = texto !== passo.texto

  return (
    <div className="space-y-2 rounded-xl border border-border/40 bg-background/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{rotulo}</span>
        {passo.video && (
          <span className="text-xs text-muted-foreground">🎥 vai com o vídeo da primeira consulta</span>
        )}
      </div>
      <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} className="text-sm" />
      <Button type="button" size="sm" variant="secondary" disabled={!sujo} onClick={() => onSave(texto)}>
        Guardar mensagem
      </Button>
    </div>
  )
}
