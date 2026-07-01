import { useEffect, useMemo, useState } from 'react'
import type { Interaction } from '@/mocks/crmMock'
import { Link, useNavigate } from 'react-router-dom'
import { Bot, History, LayoutDashboard, LayoutGrid, List, MoreHorizontal, RefreshCw, Sparkles } from 'lucide-react'

import { KanbanListView } from '@/components/kanban/KanbanListView'
import { KanbanColumnDropZone, KanbanLeadCard } from '@/components/kanban/KanbanLeadCard'
import { KanbanToolbar, type ConversationFilterOption, type SortOption } from '@/components/kanban/KanbanToolbar'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { sourceLabel } from '@/hooks/useCrmState'
import { AppLayout } from '@/layouts/AppLayout'
import { getLeadFieldValue } from '@/lib/leadFields'
import { classifyDelivery, type DeliveryKind } from '@/lib/deliveryType'
import { cn } from '@/lib/utils'
import { CRM_ASSISTANT_PATH } from '@/services/crmAiAssistant'
import { LeadLossReasonDialog } from '@/components/kanban/LeadLossReasonDialog'

export function KanbanPage() {
  const crm = useCrm()
  const { availableTenants } = useTenant()
  const navigate = useNavigate()

  // Opções de Polo derivadas dos funis visíveis (super-admin enxerga ≥2 polos).
  // Nome via availableTenants; fallback para o id do tenant.
  const tenantNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of availableTenants) m.set(t.id, t.name)
    return m
  }, [availableTenants])
  const poloOptions = useMemo(() => {
    const ids: string[] = []
    for (const p of crm.pipelineCatalog) {
      if (p.tenantId && !ids.includes(p.tenantId)) ids.push(p.tenantId)
    }
    return ids.map((id) => ({ id, name: tenantNameById.get(id) ?? id }))
  }, [crm.pipelineCatalog, tenantNameById])
  const pipelineOptions = useMemo(() => {
    const list =
      crm.tenantFilter === 'all'
        ? crm.pipelineCatalog
        : crm.pipelineCatalog.filter((p) => p.tenantId === crm.tenantFilter)
    return list.map((p) => ({ id: p.id, name: p.name }))
  }, [crm.pipelineCatalog, crm.tenantFilter])
  // Selo de Polo no card só faz sentido vendo "Todos os polos" com ≥2 polos.
  const showPoloBadge = poloOptions.length >= 2 && crm.tenantFilter === 'all'
  const poloNameForLead = (tenantId?: string) =>
    showPoloBadge && tenantId ? tenantNameById.get(tenantId) ?? tenantId : undefined
  const canSync = crm.currentPermission.canRouteLeads || crm.currentPermission.canManageUsers
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [temperatureFilter, setTemperatureFilter] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string>('all')
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'board' | 'list'>(() => {
    if (typeof sessionStorage === 'undefined') return 'board'
    return sessionStorage.getItem('crm-kanban-view-mode') === 'list' ? 'list' : 'board'
  })
  const [sortOrder, setSortOrder] = useState<SortOption>('position')
  const [conversationFilter, setConversationFilter] = useState<ConversationFilterOption>('all')
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | DeliveryKind>('all')

  // Estados para captura de motivo de perda
  const [lossDialogOpen, setLossDialogOpen] = useState(false)
  const [pendingMove, setPendingMove] = useState<{
    leadId: string
    targetStageId: string
    patientName: string
  } | null>(null)

  if (crm.pipelineCatalog.length === 0) crm.ensureStandardKanbanSetup()

  useEffect(() => {
    try {
      sessionStorage.setItem('crm-kanban-view-mode', viewMode)
    } catch {
      /* ignore */
    }
  }, [viewMode])

  // Funil padrão robusto: lembra a última escolha (localStorage) e, na dúvida, abre no
  // funil com MAIS leads (o principal) — não no primeiro por nome, que caía num funil
  // vazio (ex.: "PROCESSO CIRÚRGICO") e escondia as colunas de Follow-up do Pipeline Clínica.
  const defaultPipelineId = useMemo(() => {
    const list = crm.pipelineCatalog
    if (list.length === 0) return null
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('crm-kanban-pipeline') : null
    if (saved && list.some((p) => p.id === saved)) return saved
    const counts = new Map<string, number>()
    for (const l of crm.leads) {
      if (l.pipelineId) counts.set(l.pipelineId, (counts.get(l.pipelineId) ?? 0) + 1)
    }
    let best = list[0]!.id
    let bestN = -1
    for (const p of list) {
      const n = counts.get(p.id) ?? 0
      if (n > bestN) { bestN = n; best = p.id }
    }
    return best
  }, [crm.pipelineCatalog, crm.leads])

  useEffect(() => {
    const list = crm.pipelineCatalog
    if (list.length === 0) return
    if (!list.some((p) => p.id === crm.selectedPipelineId)) {
      void crm.setSelectedPipelineId(defaultPipelineId ?? list[0]!.id)
    }
  }, [crm.pipelineCatalog, crm.selectedPipelineId, crm.setSelectedPipelineId, defaultPipelineId])

  // Lembra o funil escolhido pra não voltar ao errado no próximo acesso.
  useEffect(() => {
    if (crm.selectedPipelineId && crm.pipelineCatalog.some((p) => p.id === crm.selectedPipelineId)) {
      try { localStorage.setItem('crm-kanban-pipeline', crm.selectedPipelineId) } catch { /* ignore */ }
    }
  }, [crm.selectedPipelineId, crm.pipelineCatalog])

  // Ao filtrar por Polo, se o funil selecionado não pertencer ao polo, pula para o
  // primeiro funil do polo (assim o quadro mostra só leads daquele polo).
  useEffect(() => {
    if (crm.tenantFilter === 'all') return
    const inScope = crm.pipelineCatalog.filter((p) => p.tenantId === crm.tenantFilter)
    if (inScope.length === 0) return
    if (!inScope.some((p) => p.id === crm.selectedPipelineId)) {
      void crm.setSelectedPipelineId(inScope[0]!.id)
    }
  }, [crm.tenantFilter, crm.pipelineCatalog, crm.selectedPipelineId, crm.setSelectedPipelineId])

  useEffect(() => {
    if (ownerFilter !== 'all' && !crm.users.some((u) => u.id === ownerFilter)) {
      setOwnerFilter('all')
    }
  }, [crm.users, ownerFilter])

  useEffect(() => {
    if (tagFilter !== 'all' && !crm.leadTagDefinitions.some((t) => t.id === tagFilter)) {
      setTagFilter('all')
    }
  }, [crm.leadTagDefinitions, tagFilter])

  const lastAiSnippetByLeadId = useMemo(() => {
    const map = new Map<string, string>()
    const byLead = new Map<string, Interaction[]>()
    for (const it of crm.interactions) {
      const list = byLead.get(it.leadId) ?? []
      list.push(it)
      byLead.set(it.leadId, list)
    }
    for (const [leadId, list] of byLead) {
      const sorted = [...list].sort(
        (x, y) => new Date(y.happenedAt).getTime() - new Date(x.happenedAt).getTime(),
      )
      const lastAi = sorted.find((i) => i.channel === 'ai')
      if (lastAi) {
        const t = lastAi.content.replace(/\s+/g, ' ').trim()
        map.set(leadId, t.length > 100 ? `${t.slice(0, 100)}…` : t)
      }
    }
    return map
  }, [crm.interactions])

  const visibleLeads = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()
    const filtered = crm.filteredLeads.filter((lead) => {
      const customText = lead.customFields
        ? Object.values(lead.customFields as Record<string, unknown>)
            .map((v) => (v != null ? String(v) : ''))
            .join(' ')
        : ''
      const haystack = [lead.patientName, lead.summary, lead.phone, customText].join(' ').toLowerCase()
      const matchesText = normalized.length === 0 || haystack.includes(normalized)
      const temp = getLeadFieldValue(lead, 'temperature')
      const effTemp =
        temp === 'cold' || temp === 'warm' || temp === 'hot' ? temp : lead.temperature
      const matchesTemperature = temperatureFilter === 'all' || effTemp === temperatureFilter
      const matchesOwner = ownerFilter === 'all' || lead.ownerId === ownerFilter
      const matchesTag =
        tagFilter === 'all' || (Array.isArray(lead.tagIds) && lead.tagIds.includes(tagFilter))
      const effConv = lead.conversation_status ?? 'new'
      const matchesConversation =
        conversationFilter === 'all' || effConv === conversationFilter
      const matchesDelivery =
        deliveryFilter === 'all' || classifyDelivery(lead).kind === deliveryFilter
      return matchesText && matchesTemperature && matchesOwner && matchesTag && matchesConversation && matchesDelivery
    })

    // Aplicar ordenação
    return filtered.sort((a, b) => {
      if (sortOrder === 'idle_time') {
        const ta = new Date(a.last_interaction_at || a.createdAt).getTime()
        const tb = new Date(b.last_interaction_at || b.createdAt).getTime()
        return ta - tb
      }
      if (sortOrder === 'score') {
        return (b.score || 0) - (a.score || 0)
      }
      return a.position - b.position
    })
  }, [
    crm.filteredLeads,
    searchTerm,
    temperatureFilter,
    ownerFilter,
    tagFilter,
    sortOrder,
    conversationFilter,
    deliveryFilter,
  ])

  const tagPillsForLead = (leadId: string) => {
    const lead = crm.leads.find((l) => l.id === leadId)
    if (!lead?.tagIds?.length) return []
    return crm.leadTagDefinitions
      .filter((d) => lead.tagIds.includes(d.id))
      .map((d) => ({ id: d.id, name: d.name, color: d.color }))
  }

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Quadro de leads">
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          <p className="m-0">Entre com um perfil autorizado ou peça liberação ao administrador.</p>
        </div>
      </AppLayout>
    )
  }

  const isClosingStage = (stageId: string) => {
    const pipeline = crm.selectedPipeline
    const lastStage = pipeline.stages[pipeline.stages.length - 1]
    return stageId === lastStage?.id
  }

  const handleLeadMove = (leadId: string, stageId: string, patientName: string) => {
    if (isClosingStage(stageId)) {
      setPendingMove({ leadId, targetStageId: stageId, patientName })
      setLossDialogOpen(true)
    } else {
      crm.reorderLeadCard(leadId, { stageId, index: 0 })
    }
  }

  return (
    <AppLayout
      title="Quadro de leads"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link
            to="/dashboard"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'inline-flex gap-1.5')}
          >
            <LayoutDashboard className="size-4" />
            Painel
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
            >
              <MoreHorizontal className="size-4" />
              Mais ações
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onClick={() => navigate('/historico')}>
                <History className="size-4" />
                Histórico de leads
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/leads')}>
                <List className="size-4" />
                Todos os leads
              </DropdownMenuItem>
              {crm.currentPermission.canEditBoards ? (
                <DropdownMenuItem onClick={() => navigate('/boards')}>
                  <LayoutGrid className="size-4" />
                  Funis e etapas
                </DropdownMenuItem>
              ) : null}
              {crm.selectedLeadId ? (
                <DropdownMenuItem
                  onClick={() => navigate(`${CRM_ASSISTANT_PATH}?leadId=${encodeURIComponent(crm.selectedLeadId)}&focus=lead`)}
                >
                  <Bot className="size-4" />
                  Perguntar à assistente sobre este lead
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => crm.simulateMetaCapture()}>
                <Sparkles className="size-4" />
                Simular recebimento de contato via Meta
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={crm.isLoading || !canSync}
                onClick={() => void crm.syncFromSupabase()}
              >
                <RefreshCw className={`size-4 ${crm.isLoading ? 'animate-spin' : ''}`} />
                {crm.isLoading ? 'Atualizando…' : 'Atualizar dados'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => crm.ensureStandardKanbanSetup()}>
                <LayoutGrid className="size-4" />
                Garantir Kanban padrão
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <KanbanToolbar
        pipelineId={crm.selectedPipelineId}
        pipelineOptions={pipelineOptions}
        onPipelineChange={crm.setSelectedPipelineId}
        poloFilter={crm.tenantFilter}
        onPoloChange={crm.setTenantFilter}
        poloOptions={poloOptions}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        temperatureFilter={temperatureFilter}
        onTemperatureChange={setTemperatureFilter}
        ownerFilter={ownerFilter}
        onOwnerChange={setOwnerFilter}
        ownerOptions={crm.users.map((u) => ({ id: u.id, name: u.name }))}
        tagFilter={tagFilter}
        onTagFilterChange={setTagFilter}
        tagOptions={crm.leadTagDefinitions.map((t) => ({ id: t.id, name: t.name }))}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        conversationFilter={conversationFilter}
        onConversationFilterChange={setConversationFilter}
        deliveryFilter={deliveryFilter}
        onDeliveryFilterChange={setDeliveryFilter}
      />

      {viewMode === 'list' ? (
        <KanbanListView
          stages={crm.selectedPipeline.stages}
          leads={visibleLeads}
          isLoading={crm.isLoading}
          selectedLeadId={crm.selectedLeadId}
          onSelectLead={(id) => {
            crm.setSelectedLeadId(id)
            navigate(`/leads/${id}`)
          }}
          getOwnerName={crm.getOwnerName}
          tagPillsForLead={tagPillsForLead}
          stageSlaMinutes={crm.selectedPipeline.boardConfig?.stageSlaMinutes}
          getLastAiSnippet={(leadId) => lastAiSnippetByLeadId.get(leadId)}
        />
      ) : (
        <div className="flex flex-1 gap-6 overflow-x-auto pb-6 scrollbar-thin scrollbar-thumb-border/30">
          {crm.selectedPipeline.stages.map((stage) => {
            const stageLeads = visibleLeads.filter((lead) => lead.stageId === stage.id)
            return (
              <article
                key={stage.id}
                className="flex flex-col w-[320px] shrink-0 overflow-hidden rounded-2xl border border-border/40 bg-muted/5 shadow-none transition-all duration-300 hover:bg-muted/10"
              >
                <header className="flex items-center justify-between px-5 py-4 bg-background/50 backdrop-blur-sm border-b border-border/20">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="size-2 rounded-full bg-primary" />
                      <h2 className="m-0 text-[13px] font-black uppercase tracking-[0.1em] text-foreground/80">{stage.name}</h2>
                    </div>
                    {crm.selectedPipeline.boardConfig?.stageSlaMinutes?.[stage.id] != null ? (
                      <div className="flex items-center gap-1.5 mt-1 text-[10px] font-bold text-destructive/80 uppercase tracking-wider">
                        <RefreshCw className="size-3" />
                        SLA: {crm.selectedPipeline.boardConfig.stageSlaMinutes![stage.id]}m
                      </div>
                    ) : null}
                  </div>
                  <span className="flex items-center justify-center min-w-[24px] h-6 rounded-full bg-primary/10 px-2 text-[11px] font-black text-primary">
                    {stageLeads.length}
                  </span>
                </header>

                <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 scrollbar-none">
                  {stageLeads.map((lead) => (
                    <KanbanLeadCard
                      key={lead.id}
                      lead={lead}
                      kanbanFields={crm.kanbanFieldsOrdered}
                      slaMinutes={crm.selectedPipeline.boardConfig?.stageSlaMinutes?.[stage.id]}
                      selected={crm.selectedLeadId === lead.id}
                      sourceLabel={sourceLabel[lead.source]}
                      ownerName={crm.getOwnerName(lead.ownerId)}
                      lastAiSnippet={lastAiSnippetByLeadId.get(lead.id)}
                      tagPills={tagPillsForLead(lead.id)}
                      poloName={poloNameForLead(lead.tenantId)}
                      payment={crm.paymentByLeadId[lead.id] ?? null}
                      onSelect={() => {
                        crm.setSelectedLeadId(lead.id)
                        navigate(`/leads/${lead.id}`)
                      }}
                      onMovePrev={() => crm.moveLead(lead.id, 'prev')}
                      onMoveNext={() => {
                        const stages = crm.selectedPipeline.stages
                        const currentIndex = stages.findIndex(s => s.id === lead.stageId)
                        if (currentIndex < stages.length - 1) {
                          handleLeadMove(lead.id, stages[currentIndex + 1].id, lead.patientName)
                        }
                      }}
                      stageLeadsOrdered={stageLeads}
                      onReorderDrop={(draggedLeadId, _targetIndex) => {
                        const draggedLead = crm.leads.find(l => l.id === draggedLeadId)
                        handleLeadMove(draggedLeadId, stage.id, draggedLead?.patientName || '')
                      }}
                      onDragEnterColumn={() => setDragOverStageId(stage.id)}
                    />
                  ))}

                  {stageLeads.length === 0 && !crm.isLoading && (
                    <div className="flex flex-col items-center justify-center py-12 text-center opacity-40">
                      <div className="mb-2 text-2xl">📥</div>
                      <p className="text-[10px] font-bold uppercase tracking-widest">Sem leads aqui</p>
                    </div>
                  )}

                  <KanbanColumnDropZone
                    active={dragOverStageId === stage.id}
                    onDragOver={() => setDragOverStageId(stage.id)}
                    onDragLeave={() => setDragOverStageId(null)}
                    onDropEnd={(draggedLeadId) => {
                      setDragOverStageId(null)
                      const draggedLead = crm.leads.find(l => l.id === draggedLeadId)
                      handleLeadMove(draggedLeadId, stage.id, draggedLead?.patientName || '')
                    }}
                  />
                </div>
              </article>
            )
          })}
        </div>
      )}
      {pendingMove && (
        <LeadLossReasonDialog
          open={lossDialogOpen}
          onOpenChange={setLossDialogOpen}
          patientName={pendingMove.patientName}
          onConfirm={(reason) => {
            crm.closeLead(pendingMove.leadId, reason, pendingMove.targetStageId)
            setLossDialogOpen(false)
            setPendingMove(null)
          }}
        />
      )}
    </AppLayout>
  )
}

