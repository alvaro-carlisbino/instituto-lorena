import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bot, History, LayoutDashboard, LayoutGrid, List, MoreHorizontal, RefreshCw, Sparkles } from 'lucide-react'

import { KanbanListView } from '@/components/kanban/KanbanListView'
import { KanbanColumnDropZone, KanbanLeadCard } from '@/components/kanban/KanbanLeadCard'
import { LeadDetailModal } from '@/components/leads/LeadDetailModal'
import { KanbanToolbar } from '@/components/kanban/KanbanToolbar'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCrm } from '@/context/CrmContext'
import { sourceLabel } from '@/hooks/useCrmState'
import { AppLayout } from '@/layouts/AppLayout'
import { getLeadFieldValue } from '@/lib/leadFields'
import { cn } from '@/lib/utils'
import { CRM_ASSISTANT_PATH } from '@/services/crmAiAssistant'

export function KanbanPage() {
  const crm = useCrm()
  const navigate = useNavigate()
  const canSync = crm.currentPermission.canRouteLeads || crm.currentPermission.canManageUsers
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [temperatureFilter, setTemperatureFilter] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string>('all')
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'board' | 'list'>(() => {
    if (typeof sessionStorage === 'undefined') return 'board'
    return sessionStorage.getItem('crm-kanban-view-mode') === 'list' ? 'list' : 'board'
  })

  if (crm.pipelineCatalog.length === 0) crm.ensureStandardKanbanSetup()

  useEffect(() => {
    try {
      sessionStorage.setItem('crm-kanban-view-mode', viewMode)
    } catch {
      /* ignore */
    }
  }, [viewMode])

  useEffect(() => {
    const list = crm.pipelineCatalog
    if (list.length === 0) return
    if (!list.some((p) => p.id === crm.selectedPipelineId)) {
      void crm.setSelectedPipelineId(list[0]!.id)
    }
  }, [crm.pipelineCatalog, crm.selectedPipelineId, crm.setSelectedPipelineId])

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

  const visibleLeads = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()
    return crm.filteredLeads.filter((lead) => {
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
      return matchesText && matchesTemperature && matchesOwner && matchesTag
    })
  }, [crm.filteredLeads, searchTerm, temperatureFilter, ownerFilter, tagFilter])

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

  return (
    <AppLayout
      title="Quadro de leads"
      actions={
        <div className="flex items-center gap-2">
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
        pipelineOptions={crm.pipelineCatalog.map((p) => ({ id: p.id, name: p.name }))}
        onPipelineChange={crm.setSelectedPipelineId}
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
      />

      {viewMode === 'list' ? (
        <KanbanListView
          stages={crm.selectedPipeline.stages}
          leads={visibleLeads}
          isLoading={crm.isLoading}
          selectedLeadId={crm.selectedLeadId}
          onSelectLead={(id) => {
            crm.setSelectedLeadId(id)
            setDetailOpen(true)
          }}
          getOwnerName={crm.getOwnerName}
          tagPillsForLead={tagPillsForLead}
          kanbanFieldsOrdered={crm.kanbanFieldsOrdered}
          stageSlaMinutes={crm.selectedPipeline.boardConfig?.stageSlaMinutes}
        />
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {crm.isLoading ? <SkeletonRows /> : null}
          {crm.selectedPipeline.stages.map((stage) => {
            const stageLeads = visibleLeads.filter((lead) => lead.stageId === stage.id)
            return (
              <article
                key={stage.id}
                className="flex min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border/40 bg-card shadow-none transition-colors hover:border-border/80"
              >
                <header className="flex items-center justify-between border-b border-border/20 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="m-0 text-sm font-bold uppercase tracking-widest text-foreground">{stage.name}</h2>
                    {crm.selectedPipeline.boardConfig?.stageSlaMinutes?.[stage.id] != null ? (
                      <p className="m-0 text-[10px] uppercase font-bold text-destructive mt-1">
                        Prazo {crm.selectedPipeline.boardConfig.stageSlaMinutes![stage.id]} min
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-full bg-muted/50 px-3 py-1 text-xs tabular-nums font-mono font-medium text-muted-foreground">
                    {stageLeads.length}
                  </span>
                </header>

                <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 bg-muted/10">
                  {stageLeads.map((lead) => (
                    <KanbanLeadCard
                      key={lead.id}
                      lead={lead}
                      kanbanFields={crm.kanbanFieldsOrdered}
                      slaMinutes={crm.selectedPipeline.boardConfig?.stageSlaMinutes?.[stage.id]}
                      selected={crm.selectedLeadId === lead.id}
                      sourceLabel={sourceLabel[lead.source]}
                      ownerName={crm.getOwnerName(lead.ownerId)}
                      tagPills={tagPillsForLead(lead.id)}
                      onSelect={() => {
                        crm.setSelectedLeadId(lead.id)
                        setDetailOpen(true)
                      }}
                      onMovePrev={() => crm.moveLead(lead.id, 'prev')}
                      onMoveNext={() => crm.moveLead(lead.id, 'next')}
                      stageLeadsOrdered={stageLeads}
                      onReorderDrop={(draggedLeadId, targetIndex) =>
                        crm.reorderLeadCard(draggedLeadId, { stageId: stage.id, index: targetIndex })
                      }
                      onDragEnterColumn={() => setDragOverStageId(stage.id)}
                    />
                  ))}

                  {stageLeads.length === 0 && !crm.isLoading && (
                    <p className="py-8 text-center text-xs text-muted-foreground">Nenhum lead nesta etapa</p>
                  )}

                  <KanbanColumnDropZone
                    active={dragOverStageId === stage.id}
                    onDragOver={() => setDragOverStageId(stage.id)}
                    onDragLeave={() => setDragOverStageId(null)}
                    onDropEnd={(draggedLeadId) => {
                      setDragOverStageId(null)
                      crm.reorderLeadCard(draggedLeadId, { stageId: stage.id, index: stageLeads.length })
                    }}
                  />
                </div>
              </article>
            )
          })}
        </div>
      )}
      <LeadDetailModal open={detailOpen} onOpenChange={setDetailOpen} />
    </AppLayout>
  )
}

function SkeletonRows() {
  return (
    <div className="col-span-full">
      <SkeletonBlocks rows={6} card={false} />
    </div>
  )
}
