import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ensureAppProfile,
  getCurrentSession,
  getMyProfile,
  onAuthStateChanged,
  signInWithEmail,
  signOutSession,
  signUpWithEmail,
  updateMyProfile,
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
  deleteWorkflowField,
  insertInteraction,
  insertLead,
  loadWebhookJobs,
  loadCrmData,
  loadAuditLogsPage,
  createWebhookReplayJob,
  savePipelineConfig,
  saveChannelConfig,
  saveMetricConfig,
  saveNotificationRule,
  savePermissionProfile,
  saveAppUser,
  saveDashboardWidget,
  saveTvWidget,
  saveWorkflowField,
  seedDemoData,
  seedTestUsers,
  saveLeadOrdering,
  updateLeadStage,
} from '../services/crmSupabase'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import {
  initialDashboardWidgets,
  initialAppUsers,
  initialChannels,
  initialInteractions,
  initialLeads,
  initialMetrics,
  initialNotifications,
  initialPermissions,
  initialTvWidgets,
  initialWorkflowFields,
  pipelines,
  sdrTeam,
  tvKpiSeries,
} from '../mocks/crmMock'
import type {
  ChannelConfig,
  AppUser,
  Interaction,
  DashboardWidget,
  Lead,
  MetricConfig,
  NotificationRule,
  PermissionProfile,
  Pipeline,
  Sdr,
  Stage,
  TvWidget,
  TriageResult,
  WorkflowField,
} from '../mocks/crmMock'
import { getDataProviderMode } from '../services/dataMode'
import { supabase } from '../lib/supabaseClient'

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

export const sourceLabel = {
  meta_facebook: 'Meta Facebook',
  meta_instagram: 'Meta Instagram',
  whatsapp: 'WhatsApp',
  manual: 'Manual',
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
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [syncNotice, setSyncNotice] = useState<string>('')
  const [session, setSession] = useState<Session | null>(null)
  const [authEmail, setAuthEmail] = useState<string>('')
  const [authPassword, setAuthPassword] = useState<string>('')
  const [authNotice, setAuthNotice] = useState<string>('')
  const [actingRole, setActingRole] = useState<'admin' | 'gestor' | 'sdr'>('admin')
  const [useRolePreview, setUseRolePreview] = useState<boolean>(false)
  const [displayNameDraft, setDisplayNameDraft] = useState<string>('')
  const [onboardingDone, setOnboardingDone] = useState<boolean>(false)
  const [auditRows, setAuditRows] = useState<AuditLogEntry[]>([])
  const [auditTotal, setAuditTotal] = useState<number>(0)
  const [triageByLead, setTriageByLead] = useState<Record<string, TriageResult>>({
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
      total: leads.filter((lead) => lead.ownerId === sdr.id && !lead.stageId.includes('fechado')).length,
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

    const targetStageName =
      selectedPipeline.stages.find((stage) => stage.id === target.stageId)?.name ?? 'Etapa atualizada'

    addInteraction({
      leadId: leadToMove.id,
      patientName: leadToMove.patientName,
      channel: 'system',
      direction: 'system',
      author: 'Kanban DnD',
      content: `Lead reposicionado para ${targetStageName} na ordem ${boundedIndex + 1}.`,
      happenedAt: new Date().toISOString(),
    })
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
      author: 'Kanban',
      content: `Lead movido para a etapa: ${nextStage.name}.`,
      happenedAt: new Date().toISOString(),
    })
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
    }

    setLeads((previous) => [newLead, ...previous])
    setSelectedLeadId(newLead.id)
    setCaptureNotice(`Novo lead via ${sourceLabel[newLead.source]} roteado para ${owner.name}.`)

    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void insertLead(newLead)
    }

    addInteraction({
      leadId: newLead.id,
      patientName: newLead.patientName,
      channel: 'meta',
      direction: 'in',
      author: 'Meta Graph API',
      content: 'Lead capturado automaticamente via webhook (mock).',
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

  const runAiTriage = (lead: Lead, text: string): TriageResult => {
    const normalized = text.toLowerCase()
    if (normalized.includes('preco') || normalized.includes('valor') || normalized.includes('agendar')) {
      return {
        leadId: lead.id,
        classification: 'qualified',
        confidence: 0.9,
        recommendation: 'Lead com intencao comercial clara. Escalar para SDR agora.',
      }
    }
    if (normalized.includes('duvida') || normalized.includes('medo') || normalized.includes('dor')) {
      return {
        leadId: lead.id,
        classification: 'human_handoff',
        confidence: 0.78,
        recommendation: 'Encaminhar para atendimento humano com linguagem consultiva.',
      }
    }
    return {
      leadId: lead.id,
      classification: 'not_qualified',
      confidence: 0.72,
      recommendation: 'Manter nutricao automatica e tentar novo contato em 24h.',
    }
  }

  const sendMessage = () => {
    if (!selectedLead || !draftMessage.trim()) return

    const outbound = draftMessage.trim()
    setDraftMessage('')

    addInteraction({
      leadId: selectedLead.id,
      patientName: selectedLead.patientName,
      channel: 'whatsapp',
      direction: 'out',
      author: getOwnerName(selectedLead.ownerId),
      content: outbound,
      happenedAt: new Date().toISOString(),
    })

    const triage = runAiTriage(selectedLead, outbound)
    setTriageByLead((previous) => ({ ...previous, [selectedLead.id]: triage }))

    addInteraction({
      leadId: selectedLead.id,
      patientName: selectedLead.patientName,
      channel: 'ai',
      direction: 'system',
      author: 'AI Triage',
      content: `${triage.classification} (${Math.round(triage.confidence * 100)}%): ${triage.recommendation}`,
      happenedAt: new Date().toISOString(),
    })
  }

  const retryFailedJobs = () => {
    setQueueJobs((previous) =>
      previous.map((job) => (job.status === 'retry' ? { ...job, status: 'processing' } : job)),
    )
  }

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
      await refreshWebhookJobs()
      setSyncNotice('Dados sincronizados com Supabase.')
    } catch (error) {
      setSyncNotice(`Falha ao carregar Supabase: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
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
      setSyncNotice('Usuarios de teste e dados demo criados no Supabase.')
    } catch (error) {
      setSyncNotice(`Falha ao criar seed: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
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
      setAuthNotice('Conta criada. Se email confirmation estiver ativo, confirme no email.')
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
        setAuthNotice(`Falha ao criar auth: ${failures.join(', ')}`)
      } else {
        setAuthNotice('Usuarios de auth criados/atualizados. Senha padrao: Teste@12345')
      }
    } catch (error) {
      setAuthNotice(`Falha ao criar usuarios auth: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
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
    const next: WorkflowField = {
      id: `wf-${Date.now()}`,
      label: 'Novo campo',
      fieldType: 'text',
      required: false,
      options: [],
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
      role: 'sdr',
      active: true,
    }
    setUsers((previous) => [...previous, next])
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void saveAppUser(next)
    }
  }

  const updateUser = (userId: string, updates: Partial<AppUser>) => {
    setUsers((previous) => {
      const next = previous.map((user) => (user.id === userId ? { ...user, ...updates } : user))
      if (dataMode === 'supabase' && isSupabaseConfigured) {
        const changed = next.find((user) => user.id === userId)
        if (changed) {
          void saveAppUser(changed)
        }
      }
      return next
    })
  }

  const removeUser = (userId: string) => {
    setUsers((previous) => previous.filter((user) => user.id !== userId))
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void deleteAppUser(userId)
    }
  }

  const addTvWidget = () => {
    const next: TvWidget = {
      id: `tv-${Date.now()}`,
      title: 'Novo widget',
      widgetType: 'kpi',
      metricKey: 'new-leads-day',
      enabled: true,
      position: tvWidgets.length + 1,
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
  }, [dataMode])

  useEffect(() => {
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void refreshWebhookJobs()
    }
  }, [dataMode])

  useEffect(() => {
    if (dataMode !== 'supabase' || !isSupabaseConfigured) return

    void getCurrentSession().then((currentSession) => {
      setSession(currentSession)
      if (currentSession) {
        void ensureAppProfile(currentSession)
      }
    })

    const subscription = onAuthStateChanged((updatedSession) => {
      setSession(updatedSession)
      if (updatedSession) {
        void ensureAppProfile(updatedSession)
      }
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
          setActingRole(profile.role)
          setDisplayNameDraft(profile.displayName)
          setOnboardingDone(profile.displayName.trim().length > 1)
        }
      })
      .catch(() => {
        setAuthNotice('Nao foi possivel ler perfil. Verifique RLS/app_profiles.')
      })
  }, [session, users])

  const effectiveRole = actingRole

  const currentPermission =
    permissions.find((permission) => permission.role === effectiveRole) ??
    ({
      id: 'fallback',
      role: 'sdr',
      canEditBoards: false,
      canRouteLeads: false,
      canManageUsers: false,
      canViewTvPanel: true,
    } as PermissionProfile)

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

  const runWebhookReplay = async () => {
    if (!supabase) {
      setSyncNotice('Supabase nao configurado.')
      return
    }

    if (!currentPermission.canManageUsers) {
      setSyncNotice('Sem permissao para reprocessar webhooks.')
      return
    }

    setIsLoading(true)
    try {
      await createWebhookReplayJob({
        source: 'meta-webhook',
        note: 'Reprocessamento manual de webhook disparado pelo admin.',
      })
      await refreshWebhookJobs()
      setSyncNotice('Reprocessamento acionado com sucesso.')
    } catch (error) {
      setSyncNotice(`Falha no replay: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
    } finally {
      setIsLoading(false)
    }
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

  return {
    dataMode,
    pipelineCatalog,
    setPipelineCatalog,
    selectedPipelineId,
    setSelectedPipelineId,
    selectedPipeline,
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
    tvKpiSeries,
    draftMessage,
    setDraftMessage,
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
    moveLead,
    reorderLeadCard,
    simulateMetaCapture,
    sendMessage,
    retryFailedJobs,
    syncFromSupabase,
    refreshWebhookJobs,
    fetchAuditPage,
    seedSupabase,
    runSignIn,
    runSignUp,
    runSignOut,
    completeOnboarding,
    createTestAuthUsers,
    runWebhookReplay,
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
    updatePipeline,
    addPipeline,
    removePipeline,
    addStageToPipeline,
    moveStage,
    updateStage,
    removeStage,
  }
}
