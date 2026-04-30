import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { DynamicFieldRenderer } from '@/components/leads/DynamicFieldRenderer'
import { LeadChatThread } from '@/components/leads/LeadChatThread'
import { LeadTaskPanel } from '@/components/leads/LeadTaskPanel'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Trash2 } from 'lucide-react'
import { useCrm } from '@/context/CrmContext'
import { sourceLabel } from '@/hooks/useCrmState'
import { workflowFieldsForContext, isLeadWhatsappComposeBlocked } from '@/lib/leadFields'
import { labelForIdName } from '@/lib/selectDisplay'
import { CRM_ASSISTANT_PATH } from '@/services/crmAiAssistant'
import { fetchWhatsappChannelInstances } from '@/services/whatsappChannelInstances'
import { fetchLeadWaLineEvents, type LeadWaLineEvent } from '@/services/leadWaLineEvents'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LeadDetailModal({ open, onOpenChange }: Props) {
  const crm = useCrm()
  const lead = crm.selectedLead
  const pipeline = lead ? crm.pipelineCatalog.find((p) => p.id === lead.pipelineId) : null
  const stageName = lead && pipeline ? pipeline.stages.find((s) => s.id === lead.stageId)?.name ?? lead.stageId : ''

  const leadHistory = useMemo(() => {
    if (!lead) return []
    return crm.interactions.filter((i) => i.leadId === lead.id)
  }, [crm.interactions, lead])

  const waComposeBlocked = lead ? isLeadWhatsappComposeBlocked(lead) : false

  const otherPipelines = useMemo(
    () => (lead ? crm.pipelineCatalog.filter((p) => p.id !== lead.pipelineId) : []),
    [crm.pipelineCatalog, lead],
  )
  const [destPipelineId, setDestPipelineId] = useState('')
  const [destStageId, setDestStageId] = useState('')
  const [waLineEvents, setWaLineEvents] = useState<LeadWaLineEvent[]>([])
  const [waInstanceLabels, setWaInstanceLabels] = useState<Record<string, string>>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  useEffect(() => {
    if (!open || !lead || crm.dataMode !== 'supabase') {
      setWaLineEvents([])
      return
    }
    void fetchLeadWaLineEvents(lead.id)
      .then(setWaLineEvents)
      .catch(() => {
        setWaLineEvents([])
      })
    void fetchWhatsappChannelInstances()
      .then((rows) => {
        setWaInstanceLabels(Object.fromEntries(rows.map((r) => [r.id, r.label])))
      })
      .catch(() => {
        setWaInstanceLabels({})
      })
  }, [open, lead?.id, crm.dataMode])

  useEffect(() => {
    if (!lead || otherPipelines.length === 0) {
      setDestPipelineId('')
      setDestStageId('')
      return
    }
    const first = otherPipelines[0]
    setDestPipelineId(first.id)
    setDestStageId(first.stages[0]?.id ?? '')
  }, [lead?.id, lead?.pipelineId, otherPipelines])

  const destPipeline = useMemo(
    () => crm.pipelineCatalog.find((p) => p.id === destPipelineId),
    [crm.pipelineCatalog, destPipelineId],
  )

  const destPipelineLabel = useMemo(
    () =>
      labelForIdName(
        destPipelineId,
        otherPipelines.map((p) => ({ id: p.id, name: p.name })),
        undefined,
        'Funil',
      ),
    [destPipelineId, otherPipelines],
  )
  const destStageLabel = useMemo(
    () =>
      labelForIdName(
        destStageId,
        (destPipeline?.stages ?? []).map((s) => ({ id: s.id, name: s.name })),
        undefined,
        'Etapa',
      ),
    [destStageId, destPipeline],
  )

  const handleDestPipelineChange = (pid: string) => {
    setDestPipelineId(pid)
    const p = crm.pipelineCatalog.find((x) => x.id === pid)
    if (p?.stages[0]) setDestStageId(p.stages[0].id)
  }

  const handleDeleteLead = async () => {
    if (lead) {
      await crm.removeLead(lead.id)
      setDeleteDialogOpen(false)
      onOpenChange(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(92dvh,calc(100dvh-1rem))] w-[min(100vw-1rem,88rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[min(90dvh,900px)] lg:w-[min(100vw-2rem,90rem)]">
          {lead ? (
            <>
              <DialogHeader className="shrink-0 border-b border-border p-3 text-left sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0 flex-1 pr-8 sm:pr-0">
                    <DialogTitle className="text-left text-lg sm:text-xl">{lead.patientName}</DialogTitle>
                    <DialogDescription className="text-left mt-1.5">
                      <span className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{pipeline?.name ?? lead.pipelineId}</Badge>
                        <Badge variant="outline">{stageName}</Badge>
                        <Badge variant="outline">{sourceLabel[lead.source]}</Badge>
                        <Badge variant="outline">{crm.getOwnerName(lead.ownerId)}</Badge>
                      </span>
                    </DialogDescription>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                    <Link
                      to={`/chat?leadId=${encodeURIComponent(lead.id)}`}
                      className={buttonVariants({ variant: 'default', size: 'sm' })}
                    >
                      Conversa completa
                    </Link>
                    <Link
                      to={`${CRM_ASSISTANT_PATH}?leadId=${encodeURIComponent(lead.id)}&focus=lead`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      Assistente
                    </Link>
                    {crm.currentPermission.canRouteLeads ? (
                      <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
                        <Trash2 className="size-4 mr-1.5" />
                        Deletar
                      </Button>
                    ) : null}
                  </div>
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
                <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              <section aria-labelledby="lead-profile-heading">
                <h2 id="lead-profile-heading" className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Perfil completo
                </h2>
                <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Nome</Label>
                    <Input
                      value={lead.patientName}
                      onChange={(e) => crm.persistLeadPatch({ ...lead, patientName: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Telefone principal</Label>
                    <Input
                      value={lead.phone}
                      onChange={(e) => crm.persistLeadPatch({ ...lead, phone: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">E-mail</Label>
                    <Input
                      value={String(lead.customFields?.email ?? '')}
                      onChange={(e) =>
                        crm.persistLeadPatch({
                          ...lead,
                          customFields: { ...lead.customFields, email: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Aniversário</Label>
                    <Input
                      type="date"
                      value={String(lead.customFields?.birthday ?? '').slice(0, 10)}
                      onChange={(e) =>
                        crm.persistLeadPatch({
                          ...lead,
                          customFields: { ...lead.customFields, birthday: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label className="text-xs">Notas</Label>
                    <Textarea
                      rows={2}
                      value={String(lead.customFields?.notes ?? '')}
                      onChange={(e) =>
                        crm.persistLeadPatch({
                          ...lead,
                          customFields: { ...lead.customFields, notes: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label className="text-xs">Observações</Label>
                    <Textarea
                      rows={2}
                      value={String(lead.customFields?.observations ?? '')}
                      onChange={(e) =>
                        crm.persistLeadPatch({
                          ...lead,
                          customFields: { ...lead.customFields, observations: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
              </section>

              {crm.currentPermission.canRouteLeads && otherPipelines.length > 0 ? (
                <section
                  aria-labelledby="lead-funnel-routing-heading"
                  className="rounded-md border border-dashed border-border/80 bg-muted/10 p-3"
                >
                  <h2
                    id="lead-funnel-routing-heading"
                    className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"
                  >
                    Encaminhar de funil
                  </h2>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Após a triagem (ex.: protocolo clínico ou processo cirúrgico), mova o lead para o funil certo. As
                    automações da etapa de destino serão aplicadas.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">Funil de destino</span>
                      <Select
                        value={destPipelineId}
                        onValueChange={(v) => {
                          if (v) handleDestPipelineChange(v)
                        }}
                      >
                        <LabeledSelectTrigger className="h-9 text-left text-xs" size="default">
                          {destPipelineLabel}
                        </LabeledSelectTrigger>
                        <SelectContent>
                          {otherPipelines.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="text-xs">
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <span className="text-xs text-muted-foreground">Etapa inicial</span>
                      <Select
                        value={destStageId}
                        onValueChange={(v) => {
                          if (v) setDestStageId(v)
                        }}
                        disabled={!destPipeline || destPipeline.stages.length === 0}
                      >
                        <LabeledSelectTrigger className="h-9 text-left text-xs" size="default">
                          {destStageLabel}
                        </LabeledSelectTrigger>
                        <SelectContent>
                          {(destPipeline?.stages ?? []).map((s) => (
                            <SelectItem key={s.id} value={s.id} className="text-xs">
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-2">
                    <Button
                      type="button"
                      size="sm"
                      className="w-full sm:w-auto"
                      disabled={!destPipelineId || !destStageId}
                      onClick={() => {
                        crm.moveLeadToPipeline(lead.id, destPipelineId, destStageId)
                      }}
                    >
                      Aplicar encaminhamento
                    </Button>
                  </div>
                </section>
              ) : null}

              {waLineEvents.length > 0 && crm.currentPermission.canRouteLeads ? (
                <section
                  aria-labelledby="lead-wa-line-history-heading"
                  className="rounded-md border border-border/80 bg-muted/10 p-3"
                >
                  <h2
                    id="lead-wa-line-history-heading"
                    className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"
                  >
                    Histórico de linhas WhatsApp
                  </h2>
                  <p className="mb-2 text-xs text-muted-foreground">
                    O contacto manteve o mesmo número; a conversa passou a ser tratada noutro telefone/instância. O
                    atendimento continua no mesmo lead.
                  </p>
                  <ul className="m-0 list-none space-y-2 p-0 text-xs">
                    {waLineEvents.map((e) => {
                      const from = e.fromInstanceId
                        ? (waInstanceLabels[e.fromInstanceId] ?? e.fromInstanceId)
                        : '—'
                      const to = waInstanceLabels[e.toInstanceId] ?? e.toInstanceId
                      const t = new Date(e.createdAt).toLocaleString('pt-PT', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })
                      return (
                        <li key={e.id} className="rounded border border-border/50 bg-card/30 px-2 py-1.5">
                          <span className="text-muted-foreground">{t}</span> — de «{from}» → «{to}»
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ) : null}

              {crm.currentPermission.canRouteLeads ? <LeadTaskPanel leadId={lead.id} className="rounded-md border border-border/80 bg-card/30 p-3" /> : null}

              {crm.currentPermission.canRouteLeads && crm.leadTagDefinitions.length > 0 ? (
                <section aria-labelledby="lead-tags-heading" className="rounded-md border border-border/80 bg-card/20 p-3">
                  <h2 id="lead-tags-heading" className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Etiquetas
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {crm.leadTagDefinitions.map((def) => {
                      const on = (lead.tagIds ?? []).includes(def.id)
                      return (
                        <label
                          key={def.id}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/70 px-2 py-1 text-xs"
                          style={{ borderColor: on ? def.color : undefined, color: on ? def.color : undefined }}
                        >
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={on}
                            onChange={() => {
                              const set = new Set(lead.tagIds ?? [])
                              if (set.has(def.id)) {
                                set.delete(def.id)
                              } else {
                                set.add(def.id)
                              }
                              crm.applyLeadTagIds(lead.id, Array.from(set))
                            }}
                          />
                          {def.name}
                        </label>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              <section aria-labelledby="lead-fields-heading">
                <h2 id="lead-fields-heading" className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Campos
                </h2>
                {crm.currentPermission.canRouteLeads ? (
                  <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-3 xl:gap-4">
                    {workflowFieldsForContext(crm.workflowFields, 'lead_detail').map((field) => (
                      <DynamicFieldRenderer
                        key={field.id}
                        field={field}
                        lead={lead}
                        onChange={(next) => crm.persistLeadPatch(next)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem permissão para editar campos.</p>
                )}
              </section>

              <section aria-labelledby="lead-chat-heading" className="flex min-h-0 flex-col gap-2 lg:col-span-2">
                <h2 id="lead-chat-heading" className="mb-0 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Conversas
                </h2>
                <div className="flex h-[min(58dvh,30rem)] min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card p-2 sm:h-[min(60dvh,32rem)] lg:max-h-[min(70dvh,36rem)]">
                  <LeadChatThread
                    leadId={lead.id}
                    history={leadHistory}
                    canCompose={crm.currentPermission.canRouteLeads && !waComposeBlocked}
                    readOnlyInstagramHint={waComposeBlocked}
                  />
                </div>
              </section>
                </div>
              </div>
          </>
          ) : (
            <DialogHeader className="p-4">
              <DialogTitle>Lead</DialogTitle>
              <DialogDescription>Nenhum lead selecionado.</DialogDescription>
            </DialogHeader>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Deletar Lead?"
        description="Esta ação é permanente e não poderá ser desfeita. Todos os dados, tarefas e campos personalizados deste lead serão excluídos."
        confirmLabel="Sim, deletar"
        cancelLabel="Cancelar"
        onConfirm={() => void handleDeleteLead()}
      />
    </>
  )
}
