import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import './App.css'
import {
  initialInteractions,
  initialLeads,
  integrationStatus,
  pipelines,
  sdrTeam,
  sourceLabel,
} from './mocks/crmMock'
import { getDataProviderMode } from './services/dataMode'
import type { Interaction, Lead, TriageResult } from './mocks/crmMock'
import { isSupabaseConfigured } from './lib/supabaseClient'
import {
  ensureAppProfile,
  getCurrentSession,
  onAuthStateChanged,
  signInWithEmail,
  signOutSession,
  signUpWithEmail,
} from './services/authSupabase'
import {
  insertInteraction,
  insertLead,
  loadCrmData,
  seedDemoData,
  seedTestUsers,
  updateLeadStage,
} from './services/crmSupabase'

type QueueJob = {
  id: string
  source: 'meta-webhook' | 'whatsapp-webhook' | 'ai-triage'
  status: 'queued' | 'processing' | 'retry' | 'done'
  createdAt: string
  note: string
}

const queueSeed: QueueJob[] = [
  {
    id: 'job-901',
    source: 'meta-webhook',
    status: 'queued',
    createdAt: '2026-04-17T11:04:00Z',
    note: 'Lead de campanha implante premium aguardando enriquecimento.',
  },
  {
    id: 'job-902',
    source: 'ai-triage',
    status: 'processing',
    createdAt: '2026-04-17T11:05:10Z',
    note: 'Classificando mensagem com sentimento de urgencia.',
  },
  {
    id: 'job-903',
    source: 'whatsapp-webhook',
    status: 'retry',
    createdAt: '2026-04-17T11:06:15Z',
    note: 'Timeout de entrega, nova tentativa em 30 segundos.',
  },
]

const templateGallery = [
  { id: 'tpl-1', name: 'Primeiro contato', channel: 'WhatsApp', state: 'Aprovado' },
  { id: 'tpl-2', name: 'Follow-up 24h', channel: 'WhatsApp', state: 'Aprovado' },
  { id: 'tpl-3', name: 'Reativacao 7 dias', channel: 'WhatsApp', state: 'Rascunho' },
]

const aiPlaybooks = [
  {
    id: 'pb-1',
    name: 'Qualificacao inicial',
    objective: 'Identificar interesse, urgencia e poder de compra.',
    fallback: 'Encaminhar para SDR se confianca < 80%.',
  },
  {
    id: 'pb-2',
    name: 'Resposta a objecoes',
    objective: 'Apoiar SDR com respostas consultivas para duvidas sensiveis.',
    fallback: 'Alertar gestor em termos de risco clinico.',
  },
]

function App() {
  const dataMode = getDataProviderMode()
  const [pipelineCatalog, setPipelineCatalog] = useState(pipelines)
  const [sdrMembers, setSdrMembers] = useState(sdrTeam)
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(pipelines[0].id)
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [interactions, setInteractions] = useState<Interaction[]>(initialInteractions)
  const [selectedLeadId, setSelectedLeadId] = useState<string>(initialLeads[0].id)
  const [draftMessage, setDraftMessage] = useState<string>('')
  const [tab, setTab] = useState<'kanban' | 'historico' | 'operacoes'>('kanban')
  const [routingCursor, setRoutingCursor] = useState<number>(0)
  const [captureNotice, setCaptureNotice] = useState<string>('')
  const [queueJobs, setQueueJobs] = useState<QueueJob[]>(queueSeed)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [syncNotice, setSyncNotice] = useState<string>('')
  const [session, setSession] = useState<Session | null>(null)
  const [authEmail, setAuthEmail] = useState<string>('')
  const [authPassword, setAuthPassword] = useState<string>('')
  const [authNotice, setAuthNotice] = useState<string>('')
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
    () => leads.filter((lead) => lead.pipelineId === selectedPipeline.id),
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
  const totalQualified = Object.values(triageByLead).filter(
    (entry) => entry.classification === 'qualified',
  ).length

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

  const moveLead = (leadId: string, direction: 'prev' | 'next') => {
    const targetLead = leads.find((lead) => lead.id === leadId)
    if (!targetLead) return

    const stages = selectedPipeline.stages
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
        summary: 'Quer saber valores de tratamento para pele e disponibilidade sabado.',
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
      ownerId: owner.id,
      pipelineId: selectedPipeline.id,
      stageId: firstStage.id,
      summary: candidate.summary,
    }

    setLeads((previous) => [newLead, ...previous])
    setSelectedLeadId(newLead.id)
    setCaptureNotice(`Novo lead capturado via ${sourceLabel[newLead.source]} e roteado para ${owner.name}.`)

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
    if (normalized.includes('preco') || normalized.includes('valor') || normalized.includes('quero agendar')) {
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
      content: `${triage.classification} (${Math.round(
        triage.confidence * 100,
      )}%): ${triage.recommendation}`,
      happenedAt: new Date().toISOString(),
    })

    setQueueJobs((previous) => [
      {
        id: `job-${Date.now()}`,
        source: 'ai-triage',
        status: 'done',
        createdAt: new Date().toISOString(),
        note: 'Triagem executada apos envio de mensagem manual.',
      },
      ...previous,
    ])
  }

  const retryFailedJobs = () => {
    setQueueJobs((previous) =>
      previous.map((job) => (job.status === 'retry' ? { ...job, status: 'processing' } : job)),
    )
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
        setAuthNotice(`Falha ao criar usuarios auth: ${failures.join(', ')}`)
      } else {
        setAuthNotice('Usuarios de auth criados/atualizados. Senha padrao: Teste@12345')
      }
    } catch (error) {
      setAuthNotice(
        `Falha ao criar usuarios auth: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
      )
    } finally {
      setIsLoading(false)
    }
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
      if (snapshot.pipelines.length > 0) {
        setSelectedPipelineId((current) =>
          snapshot.pipelines.some((pipeline) => pipeline.id === current)
            ? current
            : snapshot.pipelines[0].id,
        )
      }
      if (snapshot.leads.length > 0) {
        setSelectedLeadId((current) =>
          snapshot.leads.some((lead) => lead.id === current) ? current : snapshot.leads[0].id,
        )
      }
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

  useEffect(() => {
    if (dataMode === 'supabase' && isSupabaseConfigured) {
      void syncFromSupabase()
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="kicker">CRM LIMITLESS | MODULO 1</p>
          <h1>Fundacao comercial da clinica</h1>
          <p className="subtitle">Frontend CRM com modo Supabase para uso real inicial.</p>
          <p className="mode-pill">
            Modo de dados: {dataMode} | Supabase configurado: {isSupabaseConfigured ? 'sim' : 'nao'}
          </p>
          {syncNotice ? <p className="sync-notice">{syncNotice}</p> : null}
          {authNotice ? <p className="sync-notice">{authNotice}</p> : null}
        </div>
        <div className="header-actions">
          <input
            value={authEmail}
            onChange={(event) => setAuthEmail(event.target.value)}
            placeholder="email"
          />
          <input
            value={authPassword}
            onChange={(event) => setAuthPassword(event.target.value)}
            placeholder="senha"
            type="password"
          />
          <button onClick={() => void runSignIn()} disabled={isLoading || !isSupabaseConfigured}>
            Login
          </button>
          <button onClick={() => void runSignUp()} disabled={isLoading || !isSupabaseConfigured}>
            Criar conta
          </button>
          <button onClick={() => void runSignOut()} disabled={isLoading || !isSupabaseConfigured || !session}>
            Sair
          </button>
          <button onClick={() => void createTestAuthUsers()} disabled={isLoading || !isSupabaseConfigured}>
            Criar auth teste
          </button>
          <button onClick={() => void syncFromSupabase()} disabled={isLoading || !isSupabaseConfigured}>
            {isLoading ? 'Sincronizando...' : 'Sincronizar Supabase'}
          </button>
          <button onClick={() => void seedSupabase()} disabled={isLoading || !isSupabaseConfigured}>
            Seed usuarios + dados
          </button>
          <button className="primary" onClick={simulateMetaCapture}>
            Simular captura Meta
          </button>
          <select value={selectedPipelineId} onChange={(event) => setSelectedPipelineId(event.target.value)}>
            {pipelineCatalog.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </select>
          <span className="auth-chip">{session?.user.email ?? 'nao autenticado'}</span>
        </div>
      </header>

      <section className="metrics-grid">
        <article>
          <p>Leads ativos</p>
          <strong>{leads.length}</strong>
        </article>
        <article>
          <p>Leads quentes</p>
          <strong>{totalHotLeads}</strong>
        </article>
        <article>
          <p>Qualificados por IA</p>
          <strong>{totalQualified}</strong>
        </article>
        <article>
          <p>Disponibilidade APIs</p>
          <strong>99.3%</strong>
        </article>
      </section>

      {captureNotice ? <p className="notice">{captureNotice}</p> : null}

      <nav className="tabs">
        <button className={tab === 'kanban' ? 'active' : ''} onClick={() => setTab('kanban')}>
          Kanban
        </button>
        <button className={tab === 'historico' ? 'active' : ''} onClick={() => setTab('historico')}>
          Historico unificado
        </button>
        <button className={tab === 'operacoes' ? 'active' : ''} onClick={() => setTab('operacoes')}>
          Operacoes e IA
        </button>
      </nav>

      {tab === 'kanban' ? (
        <main className="content-grid">
          <section className="kanban-board">
            {selectedPipeline.stages.map((stage) => (
              <article key={stage.id} className="kanban-column">
                <header>
                  <h2>{stage.name}</h2>
                  <span>{filteredLeads.filter((lead) => lead.stageId === stage.id).length}</span>
                </header>

                <div className="column-scroll">
                  {filteredLeads
                    .filter((lead) => lead.stageId === stage.id)
                    .map((lead) => (
                      <div
                        key={lead.id}
                        className={`lead-card ${selectedLeadId === lead.id ? 'selected' : ''}`}
                        onClick={() => setSelectedLeadId(lead.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') setSelectedLeadId(lead.id)
                        }}
                      >
                        <div className="lead-card-top">
                          <p>{lead.patientName}</p>
                          <span className={`temperature ${lead.temperature}`}>{lead.temperature}</span>
                        </div>
                        <small>{sourceLabel[lead.source]}</small>
                        <p className="summary">{lead.summary}</p>
                        <div className="meta-row">
                          <span>Score {lead.score}</span>
                          <span>{getOwnerName(lead.ownerId)}</span>
                        </div>
                        <div className="card-actions">
                          <button onClick={() => moveLead(lead.id, 'prev')}>Voltar</button>
                          <button onClick={() => moveLead(lead.id, 'next')}>Avancar</button>
                        </div>
                      </div>
                    ))}
                </div>
              </article>
            ))}
          </section>

          <aside className="sidebar">
            <section>
              <h3>Lead selecionado</h3>
              {selectedLead ? (
                <>
                  <p className="lead-name">{selectedLead.patientName}</p>
                  <p>{selectedLead.phone}</p>
                  <p>{selectedLead.summary}</p>
                </>
              ) : (
                <p>Selecione um lead no quadro.</p>
              )}
            </section>

            <section>
              <h3>Triagem IA (mock)</h3>
              {selectedLead && triageByLead[selectedLead.id] ? (
                <div className="triage-result">
                  <p>
                    Classe: <strong>{triageByLead[selectedLead.id].classification}</strong>
                  </p>
                  <p>Confianca: {Math.round(triageByLead[selectedLead.id].confidence * 100)}%</p>
                  <p>{triageByLead[selectedLead.id].recommendation}</p>
                </div>
              ) : (
                <p>Nenhuma triagem registrada ainda.</p>
              )}

              <textarea
                value={draftMessage}
                onChange={(event) => setDraftMessage(event.target.value)}
                placeholder="Digite mensagem para WhatsApp (ex: quero agendar e saber valores)."
              />
              <button className="primary full" onClick={sendMessage}>
                Enviar mensagem + rodar triagem
              </button>
            </section>

            <section>
              <h3>Roteamento SDR</h3>
              <ul className="sdr-list">
                {workloadBySdr.map((sdr) => (
                  <li key={sdr.id}>
                    <span>{sdr.name}</span>
                    <strong>{sdr.total} leads</strong>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3>Integracoes externas</h3>
              <ul className="integration-list">
                {integrationStatus.map((item) => (
                  <li key={item.id}>
                    <span>{item.name}</span>
                    <div>
                      <strong>{item.status}</strong>
                      <small>{item.latency}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </main>
      ) : tab === 'historico' ? (
        <section className="history-screen">
          <header>
            <h2>Timeline por paciente</h2>
            <p>Visao unica das interacoes de atendimento, IA e sistema.</p>
          </header>

          <div className="history-layout">
            <aside>
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  className={selectedLeadId === lead.id ? 'active' : ''}
                  onClick={() => setSelectedLeadId(lead.id)}
                >
                  <span>{lead.patientName}</span>
                  <small>{sourceLabel[lead.source]}</small>
                </button>
              ))}
            </aside>

            <article>
              <h3>{selectedLead?.patientName ?? 'Sem lead selecionado'}</h3>
              <ul>
                {selectedLeadHistory.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.author}</strong>
                      <small>{new Date(item.happenedAt).toLocaleString('pt-BR')}</small>
                    </div>
                    <p>{item.content}</p>
                    <span>
                      {item.channel} | {item.direction}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </section>
      ) : (
        <section className="operations-screen">
          <div className="operations-grid">
            <article>
              <header>
                <h2>Fila de processamento</h2>
                <button onClick={retryFailedJobs}>Reprocessar falhas</button>
              </header>
              <ul className="ops-list">
                {queueJobs.map((job) => (
                  <li key={job.id}>
                    <div>
                      <strong>{job.source}</strong>
                      <small>{new Date(job.createdAt).toLocaleString('pt-BR')}</small>
                    </div>
                    <p>{job.note}</p>
                    <span className={`status-pill ${job.status}`}>{job.status}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article>
              <header>
                <h2>Galeria de templates</h2>
              </header>
              <ul className="ops-list compact">
                {templateGallery.map((template) => (
                  <li key={template.id}>
                    <div>
                      <strong>{template.name}</strong>
                      <small>{template.channel}</small>
                    </div>
                    <span className="status-pill done">{template.state}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article>
              <header>
                <h2>Playbooks de IA</h2>
              </header>
              <ul className="ops-list">
                {aiPlaybooks.map((playbook) => (
                  <li key={playbook.id}>
                    <div>
                      <strong>{playbook.name}</strong>
                    </div>
                    <p>{playbook.objective}</p>
                    <small>{playbook.fallback}</small>
                  </li>
                ))}
              </ul>
            </article>

            <article>
              <header>
                <h2>Checklist de producao</h2>
              </header>
              <ul className="ops-list compact">
                <li>
                  <strong>Webhook Meta assinado</strong>
                  <span className="status-pill done">ok</span>
                </li>
                <li>
                  <strong>Canal WhatsApp validado</strong>
                  <span className="status-pill processing">pendente</span>
                </li>
                <li>
                  <strong>Prompt IA versionado</strong>
                  <span className="status-pill done">ok</span>
                </li>
                <li>
                  <strong>Fallback para humano</strong>
                  <span className="status-pill done">ok</span>
                </li>
              </ul>
            </article>
          </div>
        </section>
      )}
    </div>
  )
}

export default App
