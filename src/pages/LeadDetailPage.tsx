import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Trash2 } from 'lucide-react'

import { DynamicFieldRenderer } from '@/components/leads/DynamicFieldRenderer'
import { LeadAnalyticsActions } from '@/components/leads/LeadAnalyticsActions'
import { LeadChatThread } from '@/components/leads/LeadChatThread'
import { LeadTaskPanel } from '@/components/leads/LeadTaskPanel'
import { LeadProtocolsSection } from '@/components/leads/LeadProtocolsSection'
import { LeadStockCostsSection } from '@/components/leads/LeadStockCostsSection'
import { ShospLinkSection } from '@/components/leads/ShospLinkSection'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Avatar,
  AvatarFallback,
} from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useCrm } from '@/context/CrmContext'
import { sourceLabel } from '@/hooks/useCrmState'
import { AppLayout } from '@/layouts/AppLayout'
import { businessHoursFromAiConfig } from '@/lib/aiTypingIndicator'
import { getSourceStyle } from '@/lib/channelStyles'
import { needsShippingAddress } from '@/lib/deliveryType'
import { getLeadPhoneDisplay, isLeadWhatsappComposeBlocked, workflowFieldsForContext } from '@/lib/leadFields'
import { labelForIdName } from '@/lib/selectDisplay'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'
import { CRM_ASSISTANT_PATH } from '@/services/crmAiAssistant'
import {
  getAiConfig,
  getConversationState,
  type ConversationOwnerMode,
} from '@/services/conversationControl'
import { fetchLeadWaLineEvents, type LeadWaLineEvent } from '@/services/leadWaLineEvents'
import { fetchWhatsappChannelInstances } from '@/services/whatsappChannelInstances'

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function LeadDetailPage() {
  const crm = useCrm()
  const navigate = useNavigate()
  const { leadId } = useParams<{ leadId: string }>()

  // A tela seleciona o lead no contexto; selectedLead deriva de selectedLeadId.
  useEffect(() => {
    if (leadId) crm.setSelectedLeadId(leadId)
  }, [leadId, crm.setSelectedLeadId])

  const lead = crm.selectedLead
  const ready = !!lead && lead.id === leadId

  const pipeline = lead ? crm.pipelineCatalog.find((p) => p.id === lead.pipelineId) : null
  const stageName =
    lead && pipeline ? pipeline.stages.find((s) => s.id === lead.stageId)?.name ?? lead.stageId : ''

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
  const [leadAiGate, setLeadAiGate] = useState<{
    ownerMode: ConversationOwnerMode
    aiEnabled: boolean
    businessHoursStartHour: number
    businessHoursEndHour: number
  } | null>(null)

  const loadLeadAiGate = useCallback(
    async (id: string) => {
      if (crm.dataMode !== 'supabase') {
        setLeadAiGate(null)
        return
      }
      try {
        const [state, cfg] = await Promise.all([getConversationState(id), getAiConfig()])
        const bh = cfg ? businessHoursFromAiConfig(cfg) : { startHour: 8, endHour: 20 }
        setLeadAiGate({
          ownerMode: (state.owner_mode as ConversationOwnerMode) ?? 'auto',
          aiEnabled: state.ai_enabled !== false,
          businessHoursStartHour: bh.startHour,
          businessHoursEndHour: bh.endHour,
        })
      } catch {
        setLeadAiGate(null)
      }
    },
    [crm.dataMode],
  )

  useEffect(() => {
    if (!lead) {
      setWaLineEvents([])
      setLeadAiGate(null)
      return
    }
    if (crm.dataMode !== 'supabase') {
      setWaLineEvents([])
      setLeadAiGate(null)
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
    void loadLeadAiGate(lead.id)
  }, [lead?.id, crm.dataMode, loadLeadAiGate])

  useEffect(() => {
    if (!lead || crm.dataMode !== 'supabase') return
    if (!isSupabaseConfigured || !supabase) return
    const client = supabase
    const lid = lead.id
    const channel = client
      .channel(`lead-page-conv-${lid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crm_conversation_states' },
        (payload) => {
          const row = payload.new as { lead_id?: string } | undefined
          if (row?.lead_id === lid) void loadLeadAiGate(lid)
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [lead?.id, crm.dataMode, loadLeadAiGate])

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
      navigate('/leads')
    }
  }

  // Carregando / lead não encontrado.
  if (!ready || !lead) {
    return (
      <AppLayout title="Lead">
        <div className="space-y-4">
          <Link
            to="/leads"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ‹ Todos os leads
          </Link>
          <EmptyState
            title="Carregando lead…"
            description="Se o lead não aparecer, ele pode ter sido removido ou não está acessível com seu perfil."
          />
        </div>
      </AppLayout>
    )
  }

  const pageActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
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
      <LeadAnalyticsActions leadId={lead.id} canManage={crm.currentPermission.canRouteLeads} />
      {crm.currentPermission.canRouteLeads ? (
        <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
          <Trash2 className="mr-1.5 size-4" />
          Deletar
        </Button>
      ) : null}
    </div>
  )

  return (
    <AppLayout title={lead.patientName} actions={pageActions}>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/leads" />}>Leads</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{lead.patientName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header do lead */}
      <section className="rounded-md border border-border bg-card p-3 sm:p-4">
        <div className="flex items-start gap-3 sm:gap-4">
          <Avatar className="size-12 shrink-0">
            <AvatarFallback className="text-base font-semibold">
              {initialsFromName(lead.patientName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">{lead.patientName}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{pipeline?.name ?? lead.pipelineId}</Badge>
              <Badge variant="outline">{stageName}</Badge>
              <span
                className={cn(
                  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                  getSourceStyle(lead.source).pill,
                )}
              >
                {sourceLabel[lead.source]}
              </span>
              <Badge variant="outline">{crm.getOwnerName(lead.ownerId)}</Badge>
            </div>
            {lead.lost_reason?.trim() ? (
              <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
                Motivo do encerramento: {lead.lost_reason}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {needsShippingAddress(lead) ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border-2 border-destructive bg-destructive/10 px-4 py-3 text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-6 shrink-0" />
          <div className="min-w-0">
            <p className="text-base font-extrabold uppercase tracking-wide">Registre o endereço de entrega</p>
            <p className="mt-0.5 text-sm font-medium">
              Este cliente comprou, mas NÃO temos endereço completo (CEP + número) para enviar.
              Peça o endereço ao cliente e cadastre antes de despachar o pedido.
            </p>
          </div>
        </div>
      ) : null}

      <Tabs defaultValue="visao">
        <TabsList>
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="conversa">Conversa</TabsTrigger>
          {crm.currentPermission.canRouteLeads ? (
            <TabsTrigger value="tarefas">Tarefas</TabsTrigger>
          ) : null}
          <TabsTrigger value="atividade">Atividade</TabsTrigger>
        </TabsList>

        {/* Visão geral */}
        <TabsContent value="visao">
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <section aria-labelledby="lead-profile-heading">
              <h2
                id="lead-profile-heading"
                className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"
              >
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
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs">Telefone principal</Label>
                    {getLeadPhoneDisplay(lead).isReal ? (
                      <a
                        href={`https://wa.me/${String(lead.phone).replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-500/25 hover:bg-emerald-500/20 dark:text-emerald-300"
                        title="Abrir conversa no WhatsApp com este número (lead de formulário não chega conversando — chame ativamente)"
                      >
                        💬 Chamar no WhatsApp
                      </a>
                    ) : null}
                  </div>
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

            {(() => {
              const attr = lead.customFields?.attribution
              if (!attr || typeof attr !== 'object') return null
              const a = attr as Record<string, unknown>
              const str = (v: unknown) => (v == null ? '' : String(v))
              const channelLabels: Record<string, string> = {
                ctwa_whatsapp: 'Anúncio → WhatsApp',
                ctwa_instagram: 'Anúncio → Instagram',
                lead_ads: 'Formulário (Lead Ads)',
              }
              const channel = str(a.channel)
              const channelLabel = channelLabels[channel] ?? channel
              const campaign = str(a.campaign)
              const headline = str(a.headline)
              const adId = str(a.ad_id)
              const sourceUrl = str(a.source_url)
              return (
                <section
                  aria-labelledby="lead-attribution-heading"
                  className="rounded-md border border-border bg-muted/20 p-3"
                >
                  <h2 id="lead-attribution-heading" className="mb-2 text-sm font-semibold">
                    Origem da campanha
                  </h2>
                  <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
                    {channelLabel ? (
                      <div className="flex flex-col">
                        <dt className="text-xs text-muted-foreground">Canal</dt>
                        <dd>{channelLabel}</dd>
                      </div>
                    ) : null}
                    {campaign ? (
                      <div className="flex flex-col">
                        <dt className="text-xs text-muted-foreground">Campanha</dt>
                        <dd>{campaign}</dd>
                      </div>
                    ) : null}
                    {headline ? (
                      <div className="flex flex-col sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">Anúncio</dt>
                        <dd>{headline}</dd>
                      </div>
                    ) : null}
                    {adId ? (
                      <div className="flex flex-col">
                        <dt className="text-xs text-muted-foreground">ID do anúncio</dt>
                        <dd className="font-mono text-xs">{adId}</dd>
                      </div>
                    ) : null}
                    {sourceUrl ? (
                      <div className="flex flex-col sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">Link do anúncio</dt>
                        <dd className="truncate">
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline underline-offset-2"
                          >
                            {sourceUrl}
                          </a>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </section>
              )
            })()}

            {(() => {
              const cf = (lead.customFields ?? {}) as Record<string, unknown>
              const cad = (cf.cadastro ?? {}) as Record<string, unknown>
              const ent = (cf.entrega ?? {}) as Record<string, unknown>
              const str = (v: unknown) => (v == null ? '' : String(v).trim())
              const nomeCompleto = str(cad.nomeCompleto)
              const cpf = str(cad.cpf)
              const cep = str(ent.cep)
              const numero = str(ent.numero)
              const complemento = str(ent.complemento)
              const logradouro = str(ent.logradouro)
              const bairro = str(ent.bairro)
              const cidade = str(ent.cidade ?? ent.municipio)
              const uf = str(ent.uf)
              const enderecoLinha = [logradouro, numero].filter(Boolean).join(', ')
              const cidadeLinha = [bairro, [cidade, uf].filter(Boolean).join('/')]
                .filter(Boolean)
                .join(' · ')
              const hasAny = nomeCompleto || cpf || cep || numero || logradouro || cidade
              if (!hasAny) return null
              const Row = ({ label, value }: { label: string; value: string }) =>
                value ? (
                  <div className="flex flex-col">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="break-words">{value}</dd>
                  </div>
                ) : null
              return (
                <section
                  aria-labelledby="lead-cadastro-heading"
                  className="rounded-md border border-border bg-muted/20 p-3"
                >
                  <h2 id="lead-cadastro-heading" className="mb-2 text-sm font-semibold">
                    Cadastro de venda / entrega
                  </h2>
                  <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
                    <Row label="Nome completo" value={nomeCompleto} />
                    <Row label="CPF" value={cpf} />
                    <Row label="CEP" value={cep} />
                    <Row label="Endereço" value={enderecoLinha} />
                    <Row label="Complemento" value={complemento} />
                    <Row label="Bairro / Cidade" value={cidadeLinha} />
                  </dl>
                </section>
              )
            })()}

            {crm.currentPermission.canRouteLeads && crm.dataMode === 'supabase' ? (
              <ShospLinkSection
                leadId={lead.id}
                leadName={lead.patientName}
                leadPhone={lead.phone}
                leadCpf={String((lead.customFields?.cadastro as Record<string, unknown> | undefined)?.cpf ?? '') || undefined}
                leadNascimento={String((lead.customFields?.cadastro as Record<string, unknown> | undefined)?.dataNascimento ?? '') || undefined}
              />
            ) : null}

            {crm.dataMode === 'supabase' ? (
              <>
                <LeadProtocolsSection leadId={lead.id} leadName={lead.patientName} />
                <LeadStockCostsSection leadId={lead.id} />
              </>
            ) : null}

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
                  Após a triagem (ex.: protocolo clínico ou processo cirúrgico), mova o lead para o funil
                  certo. As automações da etapa de destino serão aplicadas.
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

            {crm.currentPermission.canRouteLeads && crm.leadTagDefinitions.length > 0 ? (
              <section
                aria-labelledby="lead-tags-heading"
                className="rounded-md border border-border/80 bg-card/20 p-3"
              >
                <h2
                  id="lead-tags-heading"
                  className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"
                >
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

            <section aria-labelledby="lead-fields-heading" className="lg:col-span-2">
              <h2
                id="lead-fields-heading"
                className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"
              >
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
          </div>
        </TabsContent>

        {/* Conversa */}
        <TabsContent value="conversa">
          <div className="flex h-[calc(100dvh-20rem)] min-h-[28rem] flex-col overflow-hidden rounded-md border border-border bg-card p-2">
            <LeadChatThread
              leadId={lead.id}
              history={leadHistory}
              canCompose={crm.currentPermission.canRouteLeads && !waComposeBlocked}
              readOnlyInstagramHint={waComposeBlocked}
              aiConversationBase={crm.dataMode === 'supabase' ? leadAiGate : null}
            />
          </div>
        </TabsContent>

        {/* Tarefas */}
        {crm.currentPermission.canRouteLeads ? (
          <TabsContent value="tarefas">
            <LeadTaskPanel
              leadId={lead.id}
              className="rounded-md border border-border/80 bg-card/30 p-3"
            />
          </TabsContent>
        ) : null}

        {/* Atividade */}
        <TabsContent value="atividade">
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
                O contacto manteve o mesmo número; a conversa passou a ser tratada noutro
                telefone/instância. O atendimento continua no mesmo lead.
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
          ) : (
            <EmptyState
              title="Sem eventos de atividade"
              description="Mudanças de linha de WhatsApp e outros eventos do lead aparecerão aqui."
            />
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Deletar Lead?"
        description="Esta ação é permanente e não poderá ser desfeita. Todos os dados, tarefas e campos personalizados deste lead serão excluídos."
        confirmLabel="Sim, deletar"
        cancelLabel="Cancelar"
        onConfirm={() => void handleDeleteLead()}
      />
    </AppLayout>
  )
}
