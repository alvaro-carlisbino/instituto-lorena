import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { DynamicFieldRenderer } from '@/components/leads/DynamicFieldRenderer'
import { LeadChatThread } from '@/components/leads/LeadChatThread'
import { LeadTaskPanel } from '@/components/leads/LeadTaskPanel'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useCrm } from '@/context/CrmContext'
import { sourceLabel } from '@/hooks/useCrmState'
import { workflowFieldsForContext } from '@/lib/leadFields'
import { CRM_ASSISTANT_PATH } from '@/services/crmAiAssistant'
import { fetchWhatsappChannelInstances } from '@/services/whatsappChannelInstances'
import { fetchLeadWaLineEvents, type LeadWaLineEvent } from '@/services/leadWaLineEvents'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LeadDetailSheet({ open, onOpenChange }: Props) {
  const crm = useCrm()
  const lead = crm.selectedLead
  const pipeline = lead ? crm.pipelineCatalog.find((p) => p.id === lead.pipelineId) : null
  const stageName = lead && pipeline ? pipeline.stages.find((s) => s.id === lead.stageId)?.name ?? lead.stageId : ''

  const leadHistory = useMemo(() => {
    if (!lead) return []
    return crm.interactions.filter((i) => i.leadId === lead.id)
  }, [crm.interactions, lead])

  const otherPipelines = useMemo(
    () => (lead ? crm.pipelineCatalog.filter((p) => p.id !== lead.pipelineId) : []),
    [crm.pipelineCatalog, lead],
  )
  const [destPipelineId, setDestPipelineId] = useState('')
  const [destStageId, setDestStageId] = useState('')
  const [waLineEvents, setWaLineEvents] = useState<LeadWaLineEvent[]>([])
  const [waInstanceLabels, setWaInstanceLabels] = useState<Record<string, string>>({})

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

  const handleDestPipelineChange = (pid: string) => {
    setDestPipelineId(pid)
    const p = crm.pipelineCatalog.find((x) => x.id === pid)
    if (p?.stages[0]) setDestStageId(p.stages[0].id)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {lead ? (
          <>
            <SheetHeader className="border-b border-border p-4 text-left">
              <SheetTitle className="pr-10 text-left">{lead.patientName}</SheetTitle>
              <SheetDescription className="text-left">
                <span className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{pipeline?.name ?? lead.pipelineId}</Badge>
                  <Badge variant="outline">{stageName}</Badge>
                  <Badge variant="outline">{sourceLabel[lead.source]}</Badge>
                  <Badge variant="outline">{crm.getOwnerName(lead.ownerId)}</Badge>
                </span>
              </SheetDescription>
              <div className="pt-2">
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/chat?leadId=${encodeURIComponent(lead.id)}`}
                    className={buttonVariants({ variant: 'default', size: 'sm' })}
                  >
                    Abrir conversa completa
                  </Link>
                  <Link
                    to={`${CRM_ASSISTANT_PATH}?leadId=${encodeURIComponent(lead.id)}&focus=lead`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    Assistente sobre este lead
                  </Link>
                </div>
              </div>
            </SheetHeader>

            <div className="grid gap-4 p-4">
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
                        <SelectTrigger className="h-9 text-left text-xs">
                          <SelectValue placeholder="Funil" />
                        </SelectTrigger>
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
                        <SelectTrigger className="h-9 text-left text-xs">
                          <SelectValue placeholder="Etapa" />
                        </SelectTrigger>
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
                  <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2">
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

              <section aria-labelledby="lead-chat-heading" className="flex min-h-[18rem] flex-col">
                <h2 id="lead-chat-heading" className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Conversas
                </h2>
                <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card p-2">
                  <LeadChatThread
                    leadId={lead.id}
                    history={leadHistory}
                    canCompose={crm.currentPermission.canRouteLeads}
                  />
                </div>
              </section>
            </div>
          </>
        ) : (
          <SheetHeader className="p-4">
            <SheetTitle>Lead</SheetTitle>
            <SheetDescription>Nenhum lead selecionado.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}
