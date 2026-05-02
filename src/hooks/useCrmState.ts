import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { Session } from '@supabase/supabase-js'
import {
  ensureAppProfile,
  syncForcedAdminRole,
  getCurrentSession,
  getMyProfile,
  onAuthStateChanged,
  signInWithEmail,
  signOutSession,
  signUpWithEmail,
  updateMyProfile,
  inviteTeamMember,
  provisionUserWithPassword,
} from '../services/authSupabase'
import {
  deleteDashboardWidget,
  deleteAppUser,
  deleteChannelConfig,
  deleteMetricConfig,
  deleteNotificationRule,
  deletePermissionProfile,
  deletePipelineConfig,
  deleteStageConfig,
  deleteTvWidget,
  deleteDataView,
  deleteWorkflowField,
  deleteLeadTask,
  deleteLead as deleteLeadSupabase,
  saveAutomationRule,
  deleteAutomationRule,
  insertInteraction,
  updateInteractionContent,
  deleteInteractionRow,
  insertLead,
  loadWebhookJobs,
  loadCrmData,
  loadChatSliceFromSupabase,
  loadRoomsAndAppointmentsFromSupabase,
  loadAuditLogsPage,
  createWebhookReplayJob,
  persistLead,
  savePipelineConfig,
  saveChannelConfig,
  saveDataView,
  saveMetricConfig,
  saveNotificationRule,
  saveOrgSettings,
  savePermissionProfile,
  saveAppUser,
  saveDashboardWidget,
  saveTvWidget,
  saveWorkflowField,
  saveLeadTask,
  saveSurveyDispatch,
  saveSurveyResponse,
  seedDemoData,
  seedTestUsers,
  saveLeadOrdering,
  setLeadTagIdsForLead,
  updateLeadStage,
  upsertAppointment,
  deleteAppointmentRow,
  upsertLeadTagDefinition,
  upsertRoom,
} from '../services/crmSupabase'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient'
import {
  initialDashboardWidgets,
  initialAppUsers,
  initialChannels,
  initialDataViews,
  initialInteractions,
  initialAutomationRules,
  initialLeadTasks,
  initialLeads,
  initialMetrics,
  initialNotifications,
  initialOrgSettings,
  initialPermissions,
  initialSurveyDispatches,
  initialSurveyResponses,
  initialAppointments,
  initialLeadTagDefinitions,
  initialRooms,
  initialSurveyTemplates,
  initialTvWidgets,
  initialWorkflowFields,
  pipelines,
  sdrTeam,
  sourceLabel as leadSourceLabels,
  tvKpiSeries,
} from '../mocks/crmMock'
import type {
  Appointment,
  AutomationRule,
  ChannelConfig,
  AppUser,
  DataView,
  Interaction,
  DashboardWidget,
  Lead,
  LeadTagDefinition,
  LeadTask,
  MetricConfig,
  NotificationRule,
  OrgSettings,
  PermissionProfile,
  Pipeline,
  Room,
  Sdr,
  Stage,
  SurveyDispatch,
  SurveyResponse,
  SurveyTemplate,
  TvWidget,
  TriageResult,
  WorkflowField,
} from '../mocks/crmMock'
import { isWorkloadExcludedStageId, pickNpsTemplateForPipeline, shouldDispatchNpsForStage } from '../lib/followUpNps'
import { mergeKanbanFieldOrder, isLeadWhatsappComposeBlocked } from '../lib/leadFields'
import { getDataProviderMode } from '../services/dataMode'
import { sendWhatsappMessage } from '../services/crmWhatsapp'
import type { WebhookJob, AuditLogEntry } from '../services/crmSupabase'

export type QueueJob = WebhookJob

export const queueSeed: QueueJob[] = [
  {
    id: 'job-901',
    source: 'meta-webhook',
    status: 'queued',
    createdAt: '2026-04-17T11:04:00Z',
    note: 'Lead premium aguardando enriquecimento.',
  },
  {
    id: 'job-902',
    source: 'ai-triage',
    status: 'processing',
    createdAt: '2026-04-17T11:05:10Z',
    note: 'Classificando mensagem com urgencia alta.',
  },
  {
    id: 'job-903',
    source: 'whatsapp-webhook',
    status: 'retry',
    createdAt: '2026-04-17T11:06:15Z',
    note: 'Timeout de entrega, nova tentativa em 30s.',
  },
]

export { sourceLabel } from '../mocks/crmMock'

const parseForceAdminEmails = (): string[] => {
  const raw = import.meta.env.VITE_FORCE_ADMIN_EMAILS
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
}

export const useCrmState = () => {
  const dataMode = getDataProviderMode()
  const [pipelineCatalog, setPipelineCatalog] = useState<Pipeline[]>(pipelines)
  const [sdrMembers, setSdrMembers] = useState<Sdr[]>(sdrTeam)
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(pipelines[0].id)
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [interactions, setInteractions] = useState<Interaction[]>(initialInteractions)
  const [selectedLeadId, setSelectedLeadId] = useState<string>(initialLeads[0].id)
  const [draftMessage, setDraftMessage] = useState<string>('')
  const [draftAttachments, setDraftAttachments] = useState<Array<{ name: string; mimeType: string; base64: string }>>([])
  const [routingCursor, setRoutingCursor] = useState<number>(0)
  const [captureNotice, setCaptureNotice] = useState<string>('')
  const [queueJobs, setQueueJobs] = useState<QueueJob[]>(queueSeed)
  const [channels, setChannels] = useState<ChannelConfig[]>(initialChannels)
  const [metrics, setMetrics] = useState<MetricConfig[]>(initialMetrics)
  const [workflowFields, setWorkflowFields] = useState<WorkflowField[]>(initialWorkflowFields)
  const [permissions, setPermissions] = useState<PermissionProfile[]>(initialPermissions)
  const [notifications, setNotifications] = useState<NotificationRule[]>(initialNotifications)
  const [users, setUsers] = useState<AppUser[]>(initialAppUsers)
  const [tvWidgets, setTvWidgets] = useState<TvWidget[]>(initialTvWidgets)
  const [dashboardWidgets, setDashboardWidgets] = useState<DashboardWidget[]>(initialDashboardWidgets)
  const [dataViews, setDataViews] = useState<DataView[]>(initialDataViews)
  const [orgSettings, setOrgSettings] = useState<OrgSettings>(initialOrgSettings)
  const [leadTasks, setLeadTasks] = useState<LeadTask[]>(initialLeadTasks)
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>(initialAutomationRules)
  const [surveyTemplates, setSurveyTemplates] = useState<SurveyTemplate[]>(initialSurveyTemplates)
  const [surveyDispatches, setSurveyDispatches] = useState<SurveyDispatch[]>(initialSurveyDispatches)
  const [surveyResponses, setSurveyResponses] = useState<SurveyResponse[]>(initialSurveyResponses)
  const [leadTagDefinitions, setLeadTagDefinitions] = useState<LeadTagDefinition[]>(initialLeadTagDefinitions)
  const [rooms, setRooms] = useState<Room[]>(initialRooms)
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [syncNotice, setSyncNotice] = useState<string>('')
  const [session, setSession] = useState<Session | null>(null)
  const [authEmail, setAuthEmail] = useState<string>('')
  const [authPassword, setAuthPassword] = useState<string>('')
  const [authNotice, setAuthNotice] = useState<string>('')
  const [profileReloadTick, setProfileReloadTick] = useState(0)
  const [actingRole, setActingRole] = useState<'admin' | 'gestor' | 'sdr'>('admin')
  const [useRolePreview, setUseRolePreview] = useState<boolean>(false)
  const [displayNameDraft, setDisplayNameDraft] = useState<string>('')
  const [onboardingDone, setOnboardingDone] = useState<boolean>(false)
  const [auditRows, setAuditRows] = useState<AuditLogEntry[]>([])
  const [auditTotal, setAuditTotal] = useState<number>(0)
  const [triageByLead] = useState<Record<string, TriageResult>>({
    'lead-001': {
      leadId: 'lead-001',
      classification: 'qualified',
      confidence: 0.91,
      recommendation: 'Priorizar contato em ate 15 minutos.',
    },
  })

  const selectedPipeline = useMemo(
    () => pipelineCatalog.find((pipeline) => pipeline.id === selectedPipelineId) ?? pipelineCatalog[0] ?? pipelines[0],
    [selectedPipelineId, pipelineCatalog],
  )

  const kanbanFieldsOrdered = useMemo(
    () => mergeKanbanFieldOrder(selectedPipeline.boardConfig ?? {}, workflowFields),
    [selectedPipeline.boardConfig, workflowFields],
  )

  const filteredLeads = useMemo(
    () => leads.filter((lead) => lead.pipelineId === selectedPipeline.id).sort((a, b) => a.position - b.position),
    [leads, selectedPipeline.id],
  )

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) ?? null,
    [leads, selectedLeadId],
  )

  const selectedLeadHistory = useMemo(
    () => interactions.filter((interaction) => interaction.leadId === selectedLeadId),
    [interactions, selectedLeadId],
  )

  const workloadBySdr = useMemo(() => {
    return sdrMembers.map((sdr) => ({
      ...sdr,
      total: leads.filter(
        (lead) => lead.ownerId === sdr.id && !isWorkloadExcludedStageId(lead.stageId),
      ).length,
    }))
  }, [leads, sdrMembers])

  const totalHotLeads = leads.filter((lead) => lead.temperature === 'hot').length
  const totalQualified = Object.values(triageByLead).filter((entry) => entry.classification === 'qualified').length

  const getOwnerName = (ownerId: string) => sdrMembers.find((sdr) => sdr.id === ownerId)?.name ?? 'Sem dono'

  const addInteraction = (interaction: Omit<Interaction, 'id'>) => {
    setInteractions((previous) => [
      {
        id: `int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ...interaction,
      },
      ...previous,
    ])

    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void insertInteraction(interaction)
    }
  }

  const normalizeStagePositions = (items: Lead[]) => {
    return items
      .sort((a, b) => a.position - b.position)
      .map((lead, index) => ({ ...lead, position: index + 1 }))
  }

  const reorderLeadCard = (
    leadId: string,
    target: { stageId: string; index: number },
  ) => {
    const leadToMove = leads.find((lead) => lead.id === leadId)
    if (!leadToMove) return

    const sameStage = leadToMove.stageId === target.stageId
    const originStageLeads = leads.filter((lead) => lead.stageId === leadToMove.stageId && lead.id !== leadId)
    const targetStageLeads = sameStage
      ? originStageLeads
      : leads.filter((lead) => lead.stageId === target.stageId)

    const boundedIndex = Math.max(0, Math.min(target.index, targetStageLeads.length))

    const movedLead: Lead = {
      ...leadToMove,
      stageId: target.stageId,
      position: boundedIndex + 1,
    }

    const nextTargetStage = [...targetStageLeads]
    nextTargetStage.splice(boundedIndex, 0, movedLead)

    const normalizedTarget = normalizeStagePositions(nextTargetStage)
    const normalizedOrigin = sameStage ? [] : normalizeStagePositions(originStageLeads)

    setLeads((previous) => {
      const untouched = previous.filter(
        (lead) => lead.stageId !== leadToMove.stageId && lead.stageId !== target.stageId && lead.id !== leadId,
      )
      return [...untouched, ...normalizedOrigin, ...normalizedTarget]
    })

    if (dataMode === 'supabase' && isSupabaseConfigured) {
      normalizedTarget.forEach((lead) => {
        void saveLeadOrdering(lead.id, { stageId: lead.stageId, position: lead.position })
      })
      normalizedOrigin.forEach((lead) => {
        void saveLeadOrdering(lead.id, { stageId: lead.stageId, position: lead.position })
      })
    }

    const leadPipeline =
      pipelineCatalog.find((pipeline) => pipeline.id === leadToMove.pipelineId) ?? selectedPipeline
    const targetStageName =
      leadPipeline.stages.find((stage) => stage.id === target.stageId)?.name ?? 'Etapa atualizada'

    addInteraction({
      leadId: leadToMove.id,
      patientName: leadToMove.patientName,
      channel: 'system',
      direction: 'system',
      author: 'Quadro (ordenação)',
      content: `Lead reposicionado para ${targetStageName} na ordem ${boundedIndex + 1}.`,
      happenedAt: new Date().toISOString(),
    })

    if (!sameStage) {
      const st = leadPipeline.stages.find((s) => s.id === target.stageId)
      if (st) {
        runStageEnteredSideEffects(movedLead, st)
      }
    }
  }

  const runStageEnteredSideEffects = (targetLead: Lead, nextStage: Stage) => {
    for (const rule of automationRules) {
      if (!rule.enabled || rule.triggerType !== 'stage_entered') continue
      if (String(rule.triggerConfig.stageId) !== nextStage.id) continue
      if (rule.actionType === 'create_task') {
        const title = String(rule.actionConfig.title ?? 'Tarefa automática')
        const hours = Number(rule.actionConfig.hoursOffset) || 24
        const dueAt = new Date(Date.now() + hours * 3600000).toISOString()
        const orders = leadTasks.filter((t) => t.leadId === targetLead.id).map((t) => t.sortOrder)
        const nextOrder = (orders.length ? Math.max(...orders) : -1) + 1
        const task: LeadTask = {
          id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          leadId: targetLead.id,
          title,
          assigneeId: targetLead.ownerId,
          dueAt,
          status: 'open',
          taskType: String(rule.actionConfig.taskType ?? 'follow_up'),
          metadata: { ruleId: rule.id },
          createdAt: new Date().toISOString(),
          sortOrder: nextOrder,
        }
        setLeadTasks((prev) => [...prev, task])
        if (dataMode === 'supabase' && isSupabaseConfigured) {
          void saveLeadTask(task)
        }
      }
    }

    // Pipeline Stage Automations
    const currentPipeline = pipelineCatalog.find(p => p.id === targetLead.pipelineId) || pipelines[0]
    const automations = currentPipeline.boardConfig?.stageAutomations || {}
    const auto = automations[nextStage.id]
    
    if (auto && auto.enabled && auto.template) {
      const msg = auto.template
        .replace(/\{\{nome\}\}/gi, targetLead.patientName)
        .replace(/\{\{telefone\}\}/gi, targetLead.phone)
      
      void sendAutomatedMessage(targetLead, msg)
    }

    if (shouldDispatchNpsForStage(nextStage.id)) {
      const tmpl = pickNpsTemplateForPipeline(targetLead.pipelineId, surveyTemplates)
      if (tmpl) {
        const dispatch: SurveyDispatch = {
          id: `disp-${Date.now()}`,
          templateId: tmpl.id,
          leadId: targetLead.id,
          sentAt: new Date().toISOString(),
          channel: 'in_app',
        }
        setSurveyDispatches((prev) => [...prev, dispatch])
        if (dataMode === 'supabase' && isSupabaseConfigured) {
          void saveSurveyDispatch(dispatch)
        }
        addInteraction({
          leadId: targetLead.id,
          patientName: targetLead.patientName,
          channel: 'system',
          direction: 'system',
          author: 'NPS',
          content: `Pesquisa "${tmpl.name}" enviada (in-app). Codigo: ${dispatch.id}. Registre a nota em Tarefas e NPS.`,
          happenedAt: new Date().toISOString(),
        })
      }
    }
  }

  const moveLead = (leadId: string, direction: 'prev' | 'next') => {
    const targetLead = leads.find((lead) => lead.id === leadId)
    if (!targetLead) return

    const currentPipeline = pipelineCatalog.find((pipeline) => pipeline.id === targetLead.pipelineId) ?? selectedPipeline
    const stages = currentPipeline.stages
    const currentIndex = stages.findIndex((stage) => stage.id === targetLead.stageId)
    const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1
    if (nextIndex < 0 || nextIndex >= stages.length) return

    const nextStage = stages[nextIndex]
    setLeads((previous) =>
      previous.map((lead) => (lead.id === leadId ? { ...lead, stageId: nextStage.id } : lead)),
    )

    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void updateLeadStage(leadId, nextStage.id)
    }

    addInteraction({
      leadId: targetLead.id,
      patientName: targetLead.patientName,
      channel: 'system',
      direction: 'system',
      author: 'Quadro',
      content: `Lead movido para a etapa: ${nextStage.name}.`,
      happenedAt: new Date().toISOString(),
    })

    runStageEnteredSideEffects(targetLead, nextStage)
  }

  const moveLeadToPipeline = (leadId: string, targetPipelineId: string, targetStageId: string) => {
    const targetLead = leads.find((lead) => lead.id === leadId)
    if (!targetLead) return
    if (targetLead.pipelineId === targetPipelineId && targetLead.stageId === targetStageId) return

    const nextPipeline = pipelineCatalog.find((p) => p.id === targetPipelineId)
    if (!nextPipeline) return
    const nextStage = nextPipeline.stages.find((s) => s.id === targetStageId)
    if (!nextStage) return

    const sameCol = leads.filter(
      (l) => l.id !== leadId && l.pipelineId === targetPipelineId && l.stageId === targetStageId,
    )
    const newPosition = sameCol.length + 1
    const updated: Lead = {
      ...targetLead,
      pipelineId: targetPipelineId,
      stageId: targetStageId,
      position: newPosition,
    }

    setLeads((previous) => previous.map((lead) => (lead.id === leadId ? updated : lead)))

    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void persistLead(updated)
    }

    addInteraction({
      leadId: targetLead.id,
      patientName: targetLead.patientName,
      channel: 'system',
      direction: 'system',
      author: 'Quadro',
      content: `Lead encaminhado para o funil «${nextPipeline.name}», etapa: ${nextStage.name}.`,
      happenedAt: new Date().toISOString(),
    })

    runStageEnteredSideEffects(updated, nextStage)
  }

  const getRoundRobinOwner = () => {
    const active = workloadBySdr.filter((sdr) => sdr.active)
    if (active.length === 0) return sdrMembers[0] ?? sdrTeam[0]
    const owner = active[routingCursor % active.length]
    setRoutingCursor((cursor) => cursor + 1)
    return owner
  }

  const simulateMetaCapture = () => {
    const templates = [
      {
        name: 'Lucas Prado',
        summary: 'Quer saber valores de tratamento e disponibilidade sabado.',
        source: 'meta_instagram' as const,
      },
      {
        name: 'Fernanda Rocha',
        summary: 'Solicitou avaliacao de rotina preventiva e primeira consulta.',
        source: 'meta_facebook' as const,
      },
      {
        name: 'Caio Freire',
        summary: 'Pediu retorno rapido para entender formas de pagamento.',
        source: 'meta_instagram' as const,
      },
    ]
    const candidate = templates[Math.floor(Math.random() * templates.length)]
    const owner = getRoundRobinOwner()
    const firstStage = selectedPipeline.stages[0]
    const newLead: Lead = {
      id: `lead-${Date.now()}`,
      patientName: candidate.name,
      phone: '+55 11 90000-0000',
      source: candidate.source,
      createdAt: new Date().toISOString(),
      score: Math.floor(40 + Math.random() * 50),
      temperature: Math.random() > 0.5 ? 'warm' : 'hot',
      position: leads.filter((lead) => lead.stageId === firstStage.id).length + 1,
      ownerId: owner.id,
      pipelineId: selectedPipeline.id,
      stageId: firstStage.id,
      summary: candidate.summary,
      customFields: {},
      whatsappInstanceId: null,
      tagIds: [],
    }

    setLeads((previous) => [newLead, ...previous])
    setSelectedLeadId(newLead.id)
    setCaptureNotice(`Novo lead via ${leadSourceLabels[newLead.source]} roteado para ${owner.name}.`)

    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void insertLead(newLead)
    }

    addInteraction({
      leadId: newLead.id,
      patientName: newLead.patientName,
      channel: 'meta',
      direction: 'in',
      author: 'Meta (Facebook/Instagram)',
      content: 'Lead capturado automaticamente (demonstração).',
      happenedAt: new Date().toISOString(),
    })

    addInteraction({
      leadId: newLead.id,
      patientName: newLead.patientName,
      channel: 'system',
      direction: 'system',
      author: 'Routing Engine',
      content: `Distribuido automaticamente para ${owner.name} com round-robin.`,
      happenedAt: new Date().toISOString(),
    })
  }

  const sendMessage = async () => {
    if (!selectedLead || !draftMessage.trim()) return

    if (isLeadWhatsappComposeBlocked(selectedLead)) {
      toast.error(
        'Lead do Instagram ainda com telefone sintético: responda no Instagram ou ManyChat. Quando o número for o WhatsApp real, o envio pelo CRM fica disponível.',
      )
      return
    }

    const outbound = draftMessage.trim()
    setDraftMessage('')
    const attachments = [...draftAttachments]
    setDraftAttachments([])
    const senderName = getOwnerName(selectedLead.ownerId)

    if (dataMode === 'supabase' && isSupabaseConfigured) {
      const result = await sendWhatsappMessage({
        leadId: selectedLead.id,
        to: selectedLead.phone,
        text: outbound,
        attachments,
      })

      if (!result.ok) {
        toast.error(`Falha no envio: ${result.error}${result.detail ? ` (${result.detail})` : ''}`)
        return
      }

      await refreshChatFromSupabase()
      return
    }

    addInteraction({
      leadId: selectedLead.id,
      patientName: selectedLead.patientName,
      channel: 'whatsapp',
      direction: 'out',
      author: senderName,
      content: outbound,
      happenedAt: new Date().toISOString(),
    })
    if (attachments.length > 0) {
      addInteraction({
        leadId: selectedLead.id,
        patientName: selectedLead.patientName,
        channel: 'system',
        direction: 'system',
        author: 'Anexos',
        content: `${attachments.length} arquivo(s)/áudio(s) adicionados à conversa.`,
        happenedAt: new Date().toISOString(),
      })
    }
  }

  const sendStickerMessage = async (stickerWebpBase64: string) => {
    const raw = String(stickerWebpBase64 ?? '').trim()
    if (!selectedLead || !raw) return

    if (isLeadWhatsappComposeBlocked(selectedLead)) {
      toast.error(
        'Lead do Instagram ainda com telefone sintético: responda no Instagram ou ManyChat. Quando o número for o WhatsApp real, o envio pelo CRM fica disponível.',
      )
      return
    }

    if (dataMode === 'supabase' && isSupabaseConfigured) {
      const result = await sendWhatsappMessage({
        leadId: selectedLead.id,
        to: selectedLead.phone,
        text: '',
        stickerWebpBase64: raw,
      })

      if (!result.ok) {
        toast.error(`Falha no envio da figurinha: ${result.error}${result.detail ? ` (${result.detail})` : ''}`)
        return
      }

      await refreshChatFromSupabase()
      toast.success('Figurinha enviada.')
      return
    }

    addInteraction({
      leadId: selectedLead.id,
      patientName: selectedLead.patientName,
      channel: 'whatsapp',
      direction: 'out',
      author: getOwnerName(selectedLead.ownerId),
      content: '🎭 Figurinha enviada',
      happenedAt: new Date().toISOString(),
    })
    toast.success('Figurinha enviada (modo mock).')
  }

  const sendAutomatedMessage = async (lead: Lead, message: string) => {
    if (isLeadWhatsappComposeBlocked(lead)) {
      toast.error(
        'Automação por WhatsApp não dispara enquanto o lead Instagram tiver telefone sintético (ManyChat).',
      )
      return
    }
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      const result = await sendWhatsappMessage({
        leadId: lead.id,
        to: lead.phone,
        text: message,
        attachments: [],
      })
      if (!result.ok) {
        toast.error(`Falha na automação: ${result.error}`)
        return
      }
      toast.success('Mensagem automática enviada via Evolution API.')
      await refreshChatFromSupabase()
      return
    }

    // Local Mock Mode
    addInteraction({
      leadId: lead.id,
      patientName: lead.patientName,
      channel: 'whatsapp',
      direction: 'out',
      author: 'Automação (Sistema)',
      content: message,
      happenedAt: new Date().toISOString(),
    })
    toast.success('Automação de etapa disparada (modo mock).')
  }

  const retryFailedJobs = () => {
    setQueueJobs((previous) =>
      previous.map((job) => (job.status === 'retry' ? { ...job, status: 'processing' } : job)),
    )
  }

  const refreshWebhookJobs = async () => {
    if (dataMode !== 'supabase' || !isSupabaseConfigured) return
    try {
      const jobs = await loadWebhookJobs(50)
      setQueueJobs(jobs)
    } catch {
      // noop for now
    }
  }



  const refreshChatFromSupabase = useCallback(async () => {
    if (dataMode !== 'supabase' || !isSupabaseConfigured) return
    try {
      const slice = await loadChatSliceFromSupabase()
      setLeads(slice.leads)
      setInteractions(slice.interactions)
    } catch {
      // noop
    }
    try {
      const agendaSlice = await loadRoomsAndAppointmentsFromSupabase()
      setRooms(agendaSlice.rooms)
      setAppointments(agendaSlice.appointments)
    } catch {
      // noop
    }
  }, [dataMode])

  useEffect(() => {
    if (dataMode !== 'supabase' || !isSupabaseConfigured || !supabase) return
    const client = supabase

    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleSliceRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined
        void refreshChatFromSupabase()
      }, 260)
    }

    const channel = client
      .channel('crm-global-chat-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'interactions' }, scheduleSliceRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, scheduleSliceRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, scheduleSliceRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, scheduleSliceRefresh)
      .subscribe()

    const pollMs = 12000
    const pollId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refreshChatFromSupabase()
    }, pollMs)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshChatFromSupabase()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(pollId)
      if (debounceTimer) clearTimeout(debounceTimer)
      void client.removeChannel(channel)
    }
  }, [dataMode, refreshChatFromSupabase])

  const updateInteractionMessage = useCallback(
    async (interactionId: string, content: string) => {
      const next = content.trim()
      if (!next) throw new Error('O texto não pode ficar vazio.')
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        await updateInteractionContent(interactionId, next)
        await refreshChatFromSupabase()
      } else {
        setInteractions((prev) => prev.map((i) => (i.id === interactionId ? { ...i, content: next } : i)))
      }
    },
    [dataMode, refreshChatFromSupabase],
  )

  const deleteInteractionMessage = useCallback(
    async (interactionId: string) => {
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        await deleteInteractionRow(interactionId)
        await refreshChatFromSupabase()
      } else {
        setInteractions((prev) => prev.filter((i) => i.id !== interactionId))
      }
    },
    [dataMode, refreshChatFromSupabase],
  )

  const syncFromSupabase = async () => {
    if (dataMode !== 'supabase' || !isSupabaseConfigured) return
    setIsLoading(true)
    try {
      const snapshot = await loadCrmData()
      setPipelineCatalog(snapshot.pipelines)
      setSdrMembers(snapshot.sdrTeam)
      setLeads(snapshot.leads)
      setInteractions(snapshot.interactions)
      setChannels(snapshot.channels)
      setMetrics(snapshot.metrics)
      setWorkflowFields(snapshot.workflowFields)
      setPermissions(snapshot.permissions)
      setNotifications(snapshot.notifications)
      setUsers(snapshot.users)
      setTvWidgets(snapshot.tvWidgets)
      setDashboardWidgets(snapshot.dashboardWidgets)
      setDataViews(snapshot.dataViews ?? initialDataViews)
      setOrgSettings(snapshot.orgSettings ?? initialOrgSettings)
      setLeadTasks(snapshot.leadTasks ?? initialLeadTasks)
      setAutomationRules(snapshot.automationRules ?? initialAutomationRules)
      setSurveyTemplates(snapshot.surveyTemplates ?? initialSurveyTemplates)
      setSurveyDispatches(snapshot.surveyDispatches ?? initialSurveyDispatches)
      setSurveyResponses(snapshot.surveyResponses ?? initialSurveyResponses)
      setLeadTagDefinitions(snapshot.leadTagDefinitions ?? initialLeadTagDefinitions)
      setRooms(snapshot.rooms ?? initialRooms)
      setAppointments(snapshot.appointments ?? initialAppointments)
      await refreshWebhookJobs()
      setSyncNotice('Sistema atualizado com os dados mais recentes.')
    } catch (error: unknown) {
      console.error('Falha de sistema:', error)
      setSyncNotice('Falha de conexão com os servidores. Verifique sua rede e tente novamente.')
    } finally {
      setIsLoading(false)
    }
  }

  const seedSupabase = async () => {
    if (dataMode !== 'supabase' || !isSupabaseConfigured) return
    setIsLoading(true)
    try {
      await seedTestUsers()
      await seedDemoData()
      await syncFromSupabase()
      setSyncNotice('Base de demonstração preenchida com sucesso no sistema.')
    } catch (error: unknown) {
      console.error('Seed Supabase:', error)
      setSyncNotice('Problema ao carregar os dados modelo. Tente novamente mais tarde.')
    } finally {
      setIsLoading(false)
    }
  }

  const runSignIn = async () => {
    if (!authEmail || !authPassword) {
      setAuthNotice('Informe email e senha para autenticar.')
      return
    }
    setIsLoading(true)
    try {
      await signInWithEmail(authEmail, authPassword)
      setAuthNotice('Login realizado com sucesso.')
    } catch (error) {
      setAuthNotice(`Falha no login: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const runSignUp = async () => {
    if (!authEmail || !authPassword) {
      setAuthNotice('Informe email e senha para criar conta.')
      return
    }
    setIsLoading(true)
    try {
      await signUpWithEmail(authEmail, authPassword)
      setAuthNotice('Conta criada. Se a confirmação por e-mail estiver ativa, abra a mensagem e conclua o acesso.')
    } catch (error) {
      setAuthNotice(`Falha no cadastro: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const runSignOut = async () => {
    setIsLoading(true)
    try {
      await signOutSession()
      setAuthNotice('Sessao encerrada.')
    } catch (error) {
      setAuthNotice(`Falha ao sair: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const createTestAuthUsers = async () => {
    const testPassword = 'Teste@12345'
    const users = ['ana.sdr@limitless.local', 'bruno.sdr@limitless.local', 'carla.sdr@limitless.local']

    setIsLoading(true)
    try {
      const failures: string[] = []
      for (const email of users) {
        try {
          await signUpWithEmail(email, testPassword)
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : 'erro'
          if (!message.includes('already') && !message.includes('registered')) {
            failures.push(email)
          }
        }
      }
      if (failures.length > 0) {
        setAuthNotice(`Falha ao criar acesso (teste): ${failures.join(', ')}`)
      } else {
        setAuthNotice('Usuários de acesso (teste) criados ou atualizados. Senha padrão: Teste@12345')
      }
    } catch (error) {
      setAuthNotice(
        `Falha ao criar usuários de acesso (teste): ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      )
    } finally {
      setIsLoading(false)
    }
  }

  const updateChannel = (channelId: string, updates: Partial<ChannelConfig>) => {
    setChannels((previous) => {
      const next = previous
        .map((channel) => (channel.id === channelId ? { ...channel, ...updates } : channel))
        .sort((a, b) => a.priority - b.priority)

      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((channel) => channel.id === channelId)
        if (changed) {
          void saveChannelConfig(changed)
        }
      }

      return next
    })
  }

  const moveChannelPriority = (channelId: string, direction: 'up' | 'down') => {
    setChannels((previous) => {
      const sorted = [...previous].sort((a, b) => a.priority - b.priority)
      const index = sorted.findIndex((channel) => channel.id === channelId)
      if (index < 0) return previous

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= sorted.length) return previous

      const [moved] = sorted.splice(index, 1)
      sorted.splice(targetIndex, 0, moved)
      const normalized = sorted.map((channel, position) => ({ ...channel, priority: position + 1 }))

      if (dataMode === 'supabase' && isSupabaseConfigured) {
        normalized.forEach((channel) => {
          void saveChannelConfig(channel)
        })
      }

      return normalized
    })
  }

  const addChannel = () => {
    const next: ChannelConfig = {
      id: `channel-${Date.now()}`,
      name: 'Novo canal',
      enabled: true,
      slaMinutes: 15,
      autoReply: false,
      priority: channels.length + 1,
      driver: 'manual',
      fieldMapping: {},
      credentialsRef: '',
    }
    setChannels((previous) => [...previous, next].sort((a, b) => a.priority - b.priority))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveChannelConfig(next)
    }
  }

  const removeChannel = (channelId: string) => {
    setChannels((previous) => previous.filter((channel) => channel.id !== channelId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteChannelConfig(channelId)
    }
  }

  const updateMetric = (metricId: string, updates: Partial<MetricConfig>) => {
    setMetrics((previous) => {
      const next = previous.map((metric) => (metric.id === metricId ? { ...metric, ...updates } : metric))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((metric) => metric.id === metricId)
        if (changed) {
          void saveMetricConfig(changed)
        }
      }
      return next
    })
  }

  const addMetric = () => {
    const next: MetricConfig = {
      id: `metric-${Date.now()}`,
      label: 'Nova metrica',
      value: 0,
      target: 10,
      unit: 'count',
    }
    setMetrics((previous) => [...previous, next])
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveMetricConfig(next)
    }
  }

  const removeMetric = (metricId: string) => {
    setMetrics((previous) => previous.filter((metric) => metric.id !== metricId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteMetricConfig(metricId)
    }
  }

  const updateWorkflowField = (fieldId: string, updates: Partial<WorkflowField>) => {
    setWorkflowFields((previous) => {
      const next = previous.map((field) => (field.id === fieldId ? { ...field, ...updates } : field))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((field) => field.id === fieldId)
        if (changed) {
          void saveWorkflowField(changed)
        }
      }
      return next
    })
  }

  const addWorkflowField = () => {
    const stamp = Date.now().toString(36).slice(-5)
    const next: WorkflowField = {
      id: `wf-${Date.now()}`,
      fieldKey: `novo-campo-${stamp}`,
      label: 'Novo campo',
      fieldType: 'text',
      required: false,
      options: [],
      section: 'Geral',
      sortOrder: workflowFields.length + 20,
      visibleIn: ['lead_detail', 'list'],
      validation: {},
    }
    setWorkflowFields((previous) => [...previous, next])
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveWorkflowField(next)
    }
  }

  const removeWorkflowField = (fieldId: string) => {
    setWorkflowFields((previous) => previous.filter((field) => field.id !== fieldId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteWorkflowField(fieldId)
    }
  }

  const updatePermissionProfile = (profileId: string, updates: Partial<PermissionProfile>) => {
    setPermissions((previous) => {
      const next = previous.map((profile) => (profile.id === profileId ? { ...profile, ...updates } : profile))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((profile) => profile.id === profileId)
        if (changed) {
          void savePermissionProfile(changed)
        }
      }
      return next
    })
  }

  const addPermissionProfile = () => {
    const next: PermissionProfile = {
      id: `perm-${Date.now()}`,
      role: 'sdr',
      canEditBoards: false,
      canRouteLeads: false,
      canManageUsers: false,
      canViewTvPanel: true,
    }
    setPermissions((previous) => [...previous, next])
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void savePermissionProfile(next)
    }
  }

  const removePermissionProfile = (profileId: string) => {
    setPermissions((previous) => previous.filter((profile) => profile.id !== profileId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deletePermissionProfile(profileId)
    }
  }

  const updateNotificationRule = (ruleId: string, updates: Partial<NotificationRule>) => {
    setNotifications((previous) => {
      const next = previous.map((rule) => (rule.id === ruleId ? { ...rule, ...updates } : rule))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((rule) => rule.id === ruleId)
        if (changed) {
          void saveNotificationRule(changed)
        }
      }
      return next
    })
  }

  const addUser = () => {
    const next: AppUser = {
      id: `user-${Date.now()}`,
      name: 'Novo usuario',
      email: '',
      role: 'sdr',
      active: true,
    }
    setUsers((previous) => [...previous, next])
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveAppUser(next).catch((error) => {
        setAuthNotice(`Falha ao salvar o usuário: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }

  const updateUser = (userId: string, updates: Partial<AppUser>) => {
    setUsers((previous) => {
      const next = previous.map((user) => (user.id === userId ? { ...user, ...updates } : user))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((user) => user.id === userId)
        if (changed) {
          void saveAppUser(changed).catch((error) => {
            setAuthNotice(`Falha ao salvar o usuário: ${error instanceof Error ? error.message : String(error)}`)
          })
        }
      }
      return next
    })
  }

  const removeUser = (userId: string) => {
    const remaining = users.filter((user) => user.id !== userId)
    const fallbackOwnerId =
      remaining.find((u) => u.role === 'admin')?.id ??
      remaining.find((u) => u.active)?.id ??
      remaining[0]?.id

    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteAppUser(userId, fallbackOwnerId).catch((error) => {
        setAuthNotice(`Falha ao remover o usuário: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    setUsers(remaining)
  }

  const addTvWidget = () => {
    const next: TvWidget = {
      id: `tv-${Date.now()}`,
      title: 'Novo widget',
      widgetType: 'kpi',
      metricKey: 'new-leads-day',
      enabled: true,
      position: tvWidgets.length + 1,
      layout: { grid: 'legacy', col: 1, row: 1, span: 1 },
      widgetConfig: {},
    }
    setTvWidgets((previous) => [...previous, next].sort((a, b) => a.position - b.position))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveTvWidget(next)
    }
  }

  const updateTvWidget = (widgetId: string, updates: Partial<TvWidget>) => {
    setTvWidgets((previous) => {
      const next = previous.map((widget) => (widget.id === widgetId ? { ...widget, ...updates } : widget))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((widget) => widget.id === widgetId)
        if (changed) {
          void saveTvWidget(changed)
        }
      }
      return next
    })
  }

  const removeTvWidget = (widgetId: string) => {
    setTvWidgets((previous) => previous.filter((widget) => widget.id !== widgetId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteTvWidget(widgetId)
    }
  }

  const moveTvWidget = (widgetId: string, direction: 'up' | 'down') => {
    setTvWidgets((previous) => {
      const sorted = [...previous].sort((a, b) => a.position - b.position)
      const index = sorted.findIndex((widget) => widget.id === widgetId)
      if (index < 0) return previous
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= sorted.length) return previous

      const [moved] = sorted.splice(index, 1)
      sorted.splice(targetIndex, 0, moved)
      const normalized = sorted.map((widget, position) => ({ ...widget, position: position + 1 }))

      if (dataMode === 'supabase' && isSupabaseConfigured) {
        normalized.forEach((widget) => {
          void saveTvWidget(widget)
        })
      }
      return normalized
    })
  }

  const addDashboardWidget = () => {
    const next: DashboardWidget = {
      id: `dash-${Date.now()}`,
      title: 'Novo card',
      metricKey: 'leads-active',
      enabled: true,
      position: dashboardWidgets.length + 1,
      layout: { w: 1, h: 1 },
      widgetConfig: {},
    }
    setDashboardWidgets((previous) => [...previous, next].sort((a, b) => a.position - b.position))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveDashboardWidget(next)
    }
  }

  const updateDashboardWidget = (widgetId: string, updates: Partial<DashboardWidget>) => {
    setDashboardWidgets((previous) => {
      const next = previous.map((widget) => (widget.id === widgetId ? { ...widget, ...updates } : widget))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((widget) => widget.id === widgetId)
        if (changed) {
          void saveDashboardWidget(changed)
        }
      }
      return next
    })
  }

  const removeDashboardWidget = (widgetId: string) => {
    setDashboardWidgets((previous) => previous.filter((widget) => widget.id !== widgetId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteDashboardWidget(widgetId)
    }
  }

  const moveDashboardWidget = (widgetId: string, direction: 'up' | 'down') => {
    setDashboardWidgets((previous) => {
      const sorted = [...previous].sort((a, b) => a.position - b.position)
      const index = sorted.findIndex((widget) => widget.id === widgetId)
      if (index < 0) return previous
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= sorted.length) return previous

      const [moved] = sorted.splice(index, 1)
      sorted.splice(targetIndex, 0, moved)
      const normalized = sorted.map((widget, position) => ({ ...widget, position: position + 1 }))

      if (dataMode === 'supabase' && isSupabaseConfigured) {
        normalized.forEach((widget) => {
          void saveDashboardWidget(widget)
        })
      }
      return normalized
    })
  }

  const removeLead = async (leadId: string) => {
    const targetLead = leads.find((lead) => lead.id === leadId)
    if (!targetLead) return

    setLeads((previous) => previous.filter((lead) => lead.id !== leadId))
    
    if (selectedLeadId === leadId) {
      setSelectedLeadId('')
    }

    if (dataMode === 'supabase' && isSupabaseConfigured) {
      try {
        await deleteLeadSupabase(leadId)
        toast.success('Lead removido permanentemente.')
      } catch (err) {
        toast.error('Falha ao remover lead. Tente novamente.')
        console.error(err)
      }
    } else {
      toast.success('Lead removido (mock).')
    }
  }

  const persistLeadPatch = (next: Lead) => {
    setLeads((previous) => previous.map((lead) => (lead.id === next.id ? next : lead)))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void persistLead(next)
    }
  }

  const bulkUpdateLeads = (leadIds: string[], updates: Partial<Lead>) => {
    const target = new Set(leadIds)
    setLeads((previous) => {
      const next = previous.map((lead) => (target.has(lead.id) ? { ...lead, ...updates } : lead))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        next.forEach((lead) => {
          if (target.has(lead.id)) void persistLead(lead)
        })
      }
      return next
    })
  }

  const ensureStandardKanbanSetup = () => {
    if (pipelineCatalog.length > 0) return
    setPipelineCatalog(pipelines)
    setSelectedPipelineId(pipelines[0]!.id)
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      for (const p of pipelines) {
        void savePipelineConfig(p)
      }
    }
  }

  const importLeadsFromParsed = async (rows: Record<string, string>[], pipelineId: string, stageId: string) => {
    const pipeline = pipelineCatalog.find((p) => p.id === pipelineId) ?? selectedPipeline
    const stage = pipeline.stages.find((s) => s.id === stageId) ?? pipeline.stages[0]
    if (!stage) return { ok: 0, errors: ['Funil sem etapas.'] as string[] }
    const owner = sdrMembers.find((s) => s.active) ?? sdrMembers[0]
    const errors: string[] = []
    const created: Lead[] = []
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      const name = (row.patient_name ?? row.nome ?? row.name ?? '').trim()
      if (!name) {
        errors.push(`Linha ${i + 2}: nome obrigatório.`)
        continue
      }
      const phone = (row.phone ?? row.telefone ?? '').trim() || '+55 00 00000-0000'
      const summary = (row.summary ?? row.resumo ?? '').trim() || 'Importado via CSV.'
      const srcRaw = (row.source ?? row.origem ?? 'manual').trim().toLowerCase()
      const source =
        srcRaw === 'whatsapp' || srcRaw === 'meta_facebook' || srcRaw === 'meta_instagram'
          ? (srcRaw as Lead['source'])
          : ('manual' as Lead['source'])
      const position =
        leads.filter((l) => l.stageId === stage.id).length + created.filter((l) => l.stageId === stage.id).length + 1
      const newLead: Lead = {
        id: `lead-import-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        patientName: name,
        phone,
        source,
        createdAt: new Date().toISOString(),
        position,
        score: Number(row.score ?? 0) || 0,
        temperature: (['cold', 'warm', 'hot'].includes(String(row.temperature))
          ? row.temperature
          : 'warm') as Lead['temperature'],
        ownerId: owner?.id ?? sdrTeam[0].id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        summary,
        customFields: {},
        whatsappInstanceId: null,
        tagIds: [],
      }
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        try {
          await insertLead(newLead)
        } catch (e) {
          errors.push(`Linha ${i + 2}: ${e instanceof Error ? e.message : 'erro'}`)
          continue
        }
      }
      created.push(newLead)
    }
    if (created.length) {
      setLeads((prev) => [...created, ...prev])
    }
    return { ok: created.length, errors }
  }

  const importInteractionsFromPayload = async (
    items: Omit<Interaction, 'id'>[],
  ): Promise<{ ok: number; errors: string[] }> => {
    const errors: string[] = []
    let ok = 0
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!leads.some((l) => l.id === item.leadId)) {
        errors.push(`Item ${i + 1}: lead ${item.leadId} não encontrado.`)
        continue
      }
      addInteraction(item)
      ok += 1
    }
    return { ok, errors }
  }

  const addLeadTask = (
    partial: Omit<LeadTask, 'id' | 'createdAt' | 'sortOrder'> & { id?: string; createdAt?: string; sortOrder?: number },
  ) => {
    const forLead = leadTasks.filter((t) => t.leadId === partial.leadId)
    const orders = forLead.map((t) => t.sortOrder)
    const nextOrder = partial.sortOrder !== undefined ? partial.sortOrder : (orders.length ? Math.max(...orders) : -1) + 1
    const task: LeadTask = {
      id: partial.id ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      leadId: partial.leadId,
      title: partial.title,
      assigneeId: partial.assigneeId ?? null,
      dueAt: partial.dueAt ?? null,
      status: partial.status ?? 'open',
      taskType: partial.taskType ?? 'follow_up',
      metadata: partial.metadata ?? {},
      createdAt: partial.createdAt ?? new Date().toISOString(),
      sortOrder: nextOrder,
    }
    setLeadTasks((prev) => [...prev, task])
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveLeadTask(task)
    }
  }

  const updateLeadTask = (taskId: string, updates: Partial<LeadTask>) => {
    setLeadTasks((prev) => {
      const next = prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t))
      const changed = next.find((t) => t.id === taskId)
      if (changed && dataMode === 'supabase' && isSupabaseConfigured) {
        void saveLeadTask(changed)
      }
      return next
    })
  }

  const removeLeadTask = (taskId: string) => {
    setLeadTasks((prev) => prev.filter((t) => t.id !== taskId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteLeadTask(taskId)
    }
  }

  const reorderLeadTasks = (leadId: string, orderedTaskIds: string[]) => {
    const orderMap = new Map(orderedTaskIds.map((id, i) => [id, i]))
    setLeadTasks((prev) => {
      const next = prev.map((t) => {
        if (t.leadId !== leadId) return t
        const o = orderMap.get(t.id)
        if (o === undefined) return t
        return { ...t, sortOrder: o }
      })
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        for (const t of next) {
          if (t.leadId === leadId && orderMap.has(t.id)) {
            void saveLeadTask(t)
          }
        }
      }
      return next
    })
  }

  const recordSurveyResponse = (dispatchId: string, score: number, comment: string | null) => {
    const row: SurveyResponse = {
      id: `svr-${Date.now()}`,
      dispatchId,
      score,
      comment,
      respondedAt: new Date().toISOString(),
    }
    setSurveyResponses((prev) => [...prev, row])
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveSurveyResponse(row)
    }
  }

  const dispatchNpsForLead = (templateId: string, leadId: string) => {
    const dispatch: SurveyDispatch = {
      id: `disp-${Date.now()}`,
      templateId,
      leadId,
      sentAt: new Date().toISOString(),
      channel: 'in_app',
    }
    setSurveyDispatches((prev) => [...prev, dispatch])
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveSurveyDispatch(dispatch)
    }
    return dispatch
  }

  const addDataView = () => {
    const next: DataView = {
      id: `view-${Date.now()}`,
      name: 'Nova visão',
      config: { columns: ['patient_name', 'phone', 'summary'], sortField: 'patient_name', sortDir: 'asc' },
    }
    setDataViews((previous) => [...previous, next])
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveDataView(next)
    }
  }

  const updateDataView = (viewId: string, updates: Partial<DataView>) => {
    setDataViews((previous) => {
      const next = previous.map((view) => (view.id === viewId ? { ...view, ...updates } : view))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((view) => view.id === viewId)
        if (changed) void saveDataView(changed)
      }
      return next
    })
  }

  const removeDataView = (viewId: string) => {
    setDataViews((previous) => previous.filter((view) => view.id !== viewId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteDataView(viewId)
    }
  }

  const updateOrgSettings = (updates: Partial<OrgSettings>) => {
    setOrgSettings((previous) => {
      const next = { ...previous, ...updates }
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        void saveOrgSettings(next)
      }
      return next
    })
  }

  const addNotificationRule = () => {
    const next: NotificationRule = {
      id: `ntf-${Date.now()}`,
      name: 'Nova regra',
      channel: 'in_app',
      enabled: true,
      trigger: 'custom_trigger',
    }
    setNotifications((previous) => [...previous, next])
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveNotificationRule(next)
    }
  }

  const removeNotificationRule = (ruleId: string) => {
    setNotifications((previous) => previous.filter((rule) => rule.id !== ruleId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteNotificationRule(ruleId)
    }
  }

  const addAutomationRule = () => {
    const next: AutomationRule = {
      id: `auto-${Date.now()}`,
      name: 'Nova automação',
      enabled: true,
      triggerType: 'stage_entered',
      triggerConfig: {},
      actionType: 'create_task',
      actionConfig: {},
    }
    setAutomationRules((previous) => [...previous, next])
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveAutomationRule(next)
    }
  }

  const updateAutomationRule = (ruleId: string, updates: Partial<AutomationRule>) => {
    setAutomationRules((previous) => {
      const next = previous.map((rule) => (rule.id === ruleId ? { ...rule, ...updates } : rule))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((r) => r.id === ruleId)
        if (changed) void saveAutomationRule(changed)
      }
      return next
    })
  }

  const removeAutomationRule = (ruleId: string) => {
    setAutomationRules((previous) => previous.filter((rule) => rule.id !== ruleId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteAutomationRule(ruleId)
    }
  }

  const runBirthdayCampaign = () => {
    const today = new Date()
    const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const birthdayLeads = leads.filter((lead) => {
      const raw = lead.customFields?.birthday ?? lead.customFields?.birth_date ?? ''
      const iso = String(raw)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
      return iso.slice(5) === mmdd
    })

    birthdayLeads.forEach((lead) => {
      addInteraction({
        leadId: lead.id,
        patientName: lead.patientName,
        channel: 'system',
        direction: 'system',
        author: 'Campanha aniversário',
        content: 'Lead com aniversário hoje. Sugerir envio de mensagem de parabéns.',
        happenedAt: new Date().toISOString(),
      })
      addLeadTask({
        leadId: lead.id,
        title: 'Enviar parabéns de aniversário',
        assigneeId: lead.ownerId,
        dueAt: new Date().toISOString(),
        status: 'open',
        taskType: 'birthday_campaign',
        metadata: { auto: true },
      })
    })

    return birthdayLeads.length
  }

  const updatePipeline = (pipelineId: string, updates: Partial<Pipeline>) => {
    setPipelineCatalog((previous) => {
      const next = previous.map((pipeline) => (pipeline.id === pipelineId ? { ...pipeline, ...updates } : pipeline))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((pipeline) => pipeline.id === pipelineId)
        if (changed) {
          void savePipelineConfig(changed)
        }
      }
      return next
    })
  }

  const addPipeline = () => {
    const next: Pipeline = {
      id: `pipeline-${Date.now()}`,
      name: 'Novo pipeline',
      boardConfig: {},
      stages: [
        { id: `stage-${Date.now()}-1`, name: 'Entrada' },
        { id: `stage-${Date.now()}-2`, name: 'Contato' },
      ],
    }
    setPipelineCatalog((previous) => [...previous, next])
    setSelectedPipelineId(next.id)
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void savePipelineConfig(next)
    }
  }

  const removePipeline = (pipelineId: string) => {
    setPipelineCatalog((previous) => {
      const next = previous.filter((pipeline) => pipeline.id !== pipelineId)
      if (next.length > 0 && selectedPipelineId === pipelineId) {
        setSelectedPipelineId(next[0].id)
      }
      return next
    })
    setLeads((previous) => previous.filter((lead) => lead.pipelineId !== pipelineId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deletePipelineConfig(pipelineId)
    }
  }

  const addStageToPipeline = (pipelineId: string) => {
    const stage: Stage = { id: `stage-${Date.now()}`, name: 'Nova etapa' }
    setPipelineCatalog((previous) => {
      const next = previous.map((pipeline) =>
        pipeline.id === pipelineId ? { ...pipeline, stages: [...pipeline.stages, stage] } : pipeline,
      )
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((pipeline) => pipeline.id === pipelineId)
        if (changed) {
          void savePipelineConfig(changed)
        }
      }
      return next
    })
  }

  const moveStage = (pipelineId: string, stageId: string, direction: 'up' | 'down') => {
    setPipelineCatalog((previous) => {
      const next = previous.map((pipeline) => {
        if (pipeline.id !== pipelineId) return pipeline
        const index = pipeline.stages.findIndex((stage) => stage.id === stageId)
        if (index < 0) return pipeline
        const targetIndex = direction === 'up' ? index - 1 : index + 1
        if (targetIndex < 0 || targetIndex >= pipeline.stages.length) return pipeline

        const reordered = [...pipeline.stages]
        const [moved] = reordered.splice(index, 1)
        reordered.splice(targetIndex, 0, moved)
        return { ...pipeline, stages: reordered }
      })

      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((pipeline) => pipeline.id === pipelineId)
        if (changed) {
          void savePipelineConfig(changed)
        }
      }
      return next
    })
  }

  const updateStage = (pipelineId: string, stageId: string, updates: Partial<Stage>) => {
    setPipelineCatalog((previous) => {
      const next = previous.map((pipeline) => {
        if (pipeline.id !== pipelineId) return pipeline
        return {
          ...pipeline,
          stages: pipeline.stages.map((stage) => (stage.id === stageId ? { ...stage, ...updates } : stage)),
        }
      })
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((pipeline) => pipeline.id === pipelineId)
        if (changed) {
          void savePipelineConfig(changed)
        }
      }
      return next
    })
  }

  const removeStage = (pipelineId: string, stageId: string) => {
    setPipelineCatalog((previous) => {
      const next = previous.map((pipeline) => {
        if (pipeline.id !== pipelineId) return pipeline
        return {
          ...pipeline,
          stages: pipeline.stages.filter((stage) => stage.id !== stageId),
        }
      })
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        void deleteStageConfig(stageId)
      }
      return next
    })
    setLeads((previous) => previous.filter((lead) => lead.stageId !== stageId))
  }

  useEffect(() => {
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void syncFromSupabase()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync apenas quando dataMode muda
  }, [dataMode])

  useEffect(() => {
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void refreshWebhookJobs()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh apenas quando dataMode muda
  }, [dataMode])

  useEffect(() => {
    if (dataMode !== 'supabase' || !isSupabaseConfigured) return

    void getCurrentSession().then(async (currentSession) => {
      setSession(currentSession)
      if (!currentSession) return
      try {
        await ensureAppProfile(currentSession)
        await syncForcedAdminRole(currentSession, parseForceAdminEmails())
        setProfileReloadTick((t) => t + 1)
      } catch (error) {
        setAuthNotice(`Perfil: ${error instanceof Error ? error.message : String(error)}`)
      }
    })

    const subscription = onAuthStateChanged((updatedSession) => {
      setSession(updatedSession)
      if (!updatedSession) return
      void (async () => {
        try {
          await ensureAppProfile(updatedSession)
          await syncForcedAdminRole(updatedSession, parseForceAdminEmails())
          setProfileReloadTick((t) => t + 1)
        } catch (error) {
          setAuthNotice(`Perfil: ${error instanceof Error ? error.message : String(error)}`)
        }
      })()
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [dataMode])

  useEffect(() => {
    if (!session) return
    void getMyProfile()
      .then((profile) => {
        if (profile) {
          const email = session.user.email?.toLowerCase() ?? ''
          const forced = parseForceAdminEmails()
          const role =
            forced.length > 0 && email && forced.includes(email) ? 'admin' : profile.role
          setActingRole(role)
          setDisplayNameDraft(profile.displayName)
          setOnboardingDone(profile.displayName.trim().length > 1)
        }
      })
      .catch(() => {
        setAuthNotice('Não foi possível carregar o perfil. Tente sair e entrar de novo; se continuar, fale com o suporte.')
      })
  }, [session, users, profileReloadTick])

  const effectiveRole = actingRole

  const myAppUserId = useMemo(() => {
    if (!session?.user?.email) return null
    const email = session.user.email.toLowerCase()
    return users.find((u) => u.email.toLowerCase() === email)?.id ?? null
  }, [session, users])

  const currentPermission = useMemo((): PermissionProfile => {
    const matchRole = (list: PermissionProfile[], role: string) =>
      list.find((p) => p.role === role) ??
      list.find((p) => p.role.toLowerCase() === role.toLowerCase())

    const base =
      matchRole(permissions, effectiveRole) ??
      matchRole(initialPermissions, effectiveRole) ??
      ({
        id: 'fallback',
        role: effectiveRole,
        canEditBoards: false,
        canRouteLeads: false,
        canManageUsers: false,
        canViewTvPanel: true,
      } as PermissionProfile)

    if (useRolePreview) {
      return base
    }

    if (effectiveRole === 'admin') {
      return {
        ...base,
        role: 'admin',
        canEditBoards: true,
        canRouteLeads: true,
        canManageUsers: true,
        canViewTvPanel: base.canViewTvPanel !== false,
      }
    }

    return base
  }, [permissions, effectiveRole, useRolePreview])

  const completeOnboarding = async () => {
    const displayName = displayNameDraft.trim()
    if (displayName.length < 2) {
      setAuthNotice('Informe um nome valido para continuar.')
      return
    }

    setIsLoading(true)
    try {
      await updateMyProfile({ displayName })
      setOnboardingDone(true)
      setAuthNotice('Perfil atualizado com sucesso.')
      await syncFromSupabase()
    } catch (error) {
      setAuthNotice(`Falha ao atualizar perfil: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const runInviteTeamMember = async (email: string, displayName: string, role: AppUser['role']) => {
    if (!isSupabaseConfigured) {
      setAuthNotice('Sistema não está configurado. Fale com o suporte ou o administrador.')
      return
    }
    if (!currentPermission.canManageUsers) {
      setAuthNotice('Sem permissao para convidar usuarios.')
      return
    }
    setIsLoading(true)
    try {
      await inviteTeamMember({ email: email.trim().toLowerCase(), displayName: displayName.trim() || email, role })
      setAuthNotice('Convite enviado por e-mail. A pessoa convidada receberá as instruções de acesso.')
    } catch (error) {
      setAuthNotice(`Falha no convite: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const runProvisionUser = async (payload: {
    appUserId: string
    email: string
    displayName: string
    role: AppUser['role']
    password: string
    passwordConfirm: string
  }): Promise<boolean> => {
    if (!isSupabaseConfigured) {
      setAuthNotice('Sistema não está configurado. Fale com o suporte ou o administrador.')
      return false
    }
    if (!currentPermission.canManageUsers) {
      setAuthNotice('Sem permissao para criar usuarios.')
      return false
    }
    const email = payload.email.trim().toLowerCase()
    if (!email.includes('@')) {
      setAuthNotice('Informe um e-mail valido.')
      return false
    }
    if (payload.password.length < 8) {
      setAuthNotice('A senha deve ter pelo menos 8 caracteres.')
      return false
    }
    if (payload.password !== payload.passwordConfirm) {
      setAuthNotice('Senha e confirmacao nao coincidem.')
      return false
    }
    setIsLoading(true)
    try {
      await provisionUserWithPassword({
        email,
        password: payload.password,
        displayName: payload.displayName.trim() || email.split('@')[0] || 'usuario',
        role: payload.role,
        appUserId: payload.appUserId,
      })
      setAuthNotice('Acesso criado. O usuario ja pode entrar com e-mail e senha.')
      await syncFromSupabase()
      return true
    } catch (error) {
      setAuthNotice(`Falha ao criar acesso: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
      return false
    } finally {
      setIsLoading(false)
    }
  }

  const runWebhookReplay = async () => {
    if (!supabase) {
      setSyncNotice('Sistema não está configurado. Fale com o suporte ou o administrador.')
      return
    }

    if (!currentPermission.canManageUsers) {
      setSyncNotice('Sem permissão para reprocessar mensagens.')
      return
    }

    setIsLoading(true)
    try {
      await createWebhookReplayJob({
        source: 'whatsapp-webhook',
        note: 'Reprocessamento manual de webhooks WhatsApp disparado pelo administrador.',
      })
      await refreshWebhookJobs()
      setSyncNotice('Reprocessamento acionado com sucesso.')
    } catch (error) {
      setSyncNotice(`Falha no replay: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchAuditPage = async (params: {
    page: number
    pageSize: number
    action?: 'INSERT' | 'UPDATE' | 'DELETE'
    targetTable?: string
    sinceIso?: string
  }) => {
    if (dataMode !== 'supabase' || !isSupabaseConfigured) return
    const result = await loadAuditLogsPage(params)
    setAuditRows(result.rows)
    setAuditTotal(result.total)
  }

  const saveTagDefinition = (row: LeadTagDefinition) => {
    setLeadTagDefinitions((p) => {
      const i = p.findIndex((t) => t.id === row.id)
      if (i === -1) return [...p, row].sort((a, b) => a.name.localeCompare(b.name))
      const n = [...p]
      n[i] = row
      return n
    })
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void upsertLeadTagDefinition(row)
    }
  }

  const applyLeadTagIds = (leadId: string, tagIds: string[]) => {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, tagIds } : l)))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void setLeadTagIdsForLead(leadId, tagIds)
    }
  }

  const saveRoomRow = (room: Room) => {
    setRooms((p) => {
      const i = p.findIndex((r) => r.id === room.id)
      if (i === -1) return [...p, room].sort((a, b) => a.sortOrder - b.sortOrder)
      const n = [...p]
      n[i] = room
      return n
    })
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void upsertRoom(room)
    }
  }

  const saveAppointmentRow = (a: Appointment) => {
    setAppointments((p) => {
      const i = p.findIndex((x) => x.id === a.id)
      if (i === -1) return [...p, a].sort((x, y) => x.startsAt.localeCompare(y.startsAt))
      const n = [...p]
      n[i] = a
      return n
    })
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void upsertAppointment(a)
    }
  }

  const removeAppointmentRow = (appointmentId: string) => {
    setAppointments((p) => p.filter((x) => x.id !== appointmentId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteAppointmentRow(appointmentId).catch(() => {
        void syncFromSupabase()
      })
    }
  }

  return {
    dataMode,
    pipelineCatalog,
    setPipelineCatalog,
    selectedPipelineId,
    setSelectedPipelineId,
    selectedPipeline,
    kanbanFieldsOrdered,
    leads,
    filteredLeads,
    selectedLeadId,
    setSelectedLeadId,
    selectedLead,
    selectedLeadHistory,
    interactions,
    sdrMembers,
    workloadBySdr,
    totalHotLeads,
    totalQualified,
    captureNotice,
    queueJobs,
    auditRows,
    auditTotal,
    channels,
    metrics,
    workflowFields,
    permissions,
    notifications,
    users,
    tvWidgets,
    dashboardWidgets,
    dataViews,
    orgSettings,
    tvKpiSeries,
    leadTasks,
    automationRules,
    surveyTemplates,
    surveyDispatches,
    surveyResponses,
    leadTagDefinitions,
    saveTagDefinition,
    applyLeadTagIds,
    rooms,
    appointments,
    saveRoomRow,
    saveAppointmentRow,
    removeAppointmentRow,
    myAppUserId,
    draftMessage,
    draftAttachments,
    setDraftMessage,
    setDraftAttachments,
    triageByLead,
    isLoading,
    syncNotice,
    session,
    onboardingDone,
    displayNameDraft,
    setDisplayNameDraft,
    actingRole,
    setActingRole,
    useRolePreview,
    setUseRolePreview,
    effectiveRole,
    currentPermission,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    authNotice,
    getOwnerName,
    ensureStandardKanbanSetup,
    bulkUpdateLeads,
    moveLead,
    moveLeadToPipeline,
    reorderLeadCard,
    persistLeadPatch,
    importLeadsFromParsed,
    importInteractionsFromPayload,
    addLeadTask,
    updateLeadTask,
    removeLead,
    removeLeadTask,
    reorderLeadTasks,
    recordSurveyResponse,
    dispatchNpsForLead,
    simulateMetaCapture,
    sendMessage,
    sendStickerMessage,
    updateInteractionMessage,
    deleteInteractionMessage,
    retryFailedJobs,
    syncFromSupabase,
    refreshChatFromSupabase,
    refreshWebhookJobs,
    fetchAuditPage,
    seedSupabase,
    runSignIn,
    runSignUp,
    runSignOut,
    completeOnboarding,
    createTestAuthUsers,
    runWebhookReplay,
    runInviteTeamMember,
    runProvisionUser,
    updateChannel,
    addChannel,
    removeChannel,
    moveChannelPriority,
    updateMetric,
    addMetric,
    removeMetric,
    updateWorkflowField,
    addWorkflowField,
    removeWorkflowField,
    updatePermissionProfile,
    addPermissionProfile,
    removePermissionProfile,
    updateNotificationRule,
    addNotificationRule,
    removeNotificationRule,
    addAutomationRule,
    updateAutomationRule,
    removeAutomationRule,
    runBirthdayCampaign,
    addUser,
    updateUser,
    removeUser,
    addTvWidget,
    updateTvWidget,
    removeTvWidget,
    moveTvWidget,
    addDashboardWidget,
    updateDashboardWidget,
    removeDashboardWidget,
    moveDashboardWidget,
    addDataView,
    updateDataView,
    removeDataView,
    updateOrgSettings,
    updatePipeline,
    addPipeline,
    removePipeline,
    addStageToPipeline,
    moveStage,
    updateStage,
    removeStage,
  }
}
