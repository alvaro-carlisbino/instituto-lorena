import { useMemo, useRef, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Mail, Search, UserRound } from 'lucide-react'

import { ConversationModeSwitch } from '@/components/leads/ConversationModeSwitch'
import { LeadChatThread } from '@/components/leads/LeadChatThread'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { WorkspaceLeadSidebar } from '@/components/leads/WorkspaceLeadSidebar'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { getSourceStyle } from '@/lib/channelStyles'
import { cn } from '@/lib/utils'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { labelForIdName } from '@/lib/selectDisplay'
import { businessHoursFromAiConfig } from '@/lib/aiTypingIndicator'
import {
  getAiConfig,
  getConversationState,
  setConversationMode,
  type ConversationOwnerMode,
} from '@/services/conversationControl'
import { getLeadPhoneDisplay, isLeadWhatsappComposeBlocked } from '@/lib/leadFields'
import { formatConversationHeaderStamp, formatConversationStamp } from '@/lib/chatDates'
import { fetchWhatsappChannelInstances, type BotKind } from '@/services/whatsappChannelInstances'
import { useUnreadConversations } from '@/hooks/useUnreadConversations'

const MODE_SUMMARY: Record<ConversationOwnerMode, string> = {
  human: 'Humano',
  ai: 'IA',
  auto: 'Misto',
}

/** Iniciais para o avatar do contato na lista (1ª + última palavra). */
function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/**
 * Workspace de conversas. Sem props = inbox comercial completo (todas as linhas).
 * Com `restrictToBotKind` (ex.: 'sales') só mostra os leads das linhas de WhatsApp
 * daquele tipo — base da aba Tricopill, que reaproveita esta mesma UI.
 */
export function ChatWorkspacePage({
  title = 'Conversas',
  restrictToBotKind,
}: { title?: string; restrictToBotKind?: BotKind } = {}) {
  const crm = useCrm()
  const { dataMode } = crm
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [sortMode, setSortMode] = useState<'recent' | 'long_wait'>('recent')
  const [leadMode, setLeadMode] = useState<ConversationOwnerMode>('auto')
  const [modeLoading, setModeLoading] = useState(false)
  const [leadSheetOpen, setLeadSheetOpen] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const { isUnread, unreadCount, markSeen, markUnread } = useUnreadConversations(crm.interactions)
  // Ids das linhas de WhatsApp do tipo `restrictToBotKind` (ex.: vendas/Tricopill).
  // null = ainda carregando; Set vazio = nenhuma linha desse tipo configurada.
  const [restrictInstanceIds, setRestrictInstanceIds] = useState<Set<string> | null>(null)
  const [aiConversationBase, setAiConversationBase] = useState<{
    ownerMode: ConversationOwnerMode
    aiEnabled: boolean
    businessHoursStartHour: number
    businessHoursEndHour: number
  } | null>(null)

  const ownerSelectLabel = useMemo(
    () =>
      labelForIdName(
        ownerFilter,
        crm.users.map((u) => ({ id: u.id, name: u.name })),
        { value: 'all', label: 'Todos responsáveis' },
        'Responsável',
      ),
    [ownerFilter, crm.users],
  )

  /**
   * `waitingSinceByLead`: timestamp da última inbound do paciente quando NÃO houve
   * resposta humana/IA subsequente. `null` quando o lead está em dia. Usado pela
   * ordenação "Longa espera" (mais antigo primeiro = mais urgente).
   */
  const waitingSinceByLead = useMemo(() => {
    const lastIn = new Map<string, number>()
    const lastOut = new Map<string, number>()
    for (const i of crm.interactions) {
      const t = new Date(i.happenedAt).getTime()
      if (Number.isNaN(t)) continue
      if (i.direction === 'in') {
        if (!lastIn.has(i.leadId) || t > (lastIn.get(i.leadId) ?? 0)) lastIn.set(i.leadId, t)
      } else if (i.direction === 'out') {
        if (!lastOut.has(i.leadId) || t > (lastOut.get(i.leadId) ?? 0)) lastOut.set(i.leadId, t)
      }
    }
    const result = new Map<string, number | null>()
    for (const [leadId, inTs] of lastIn) {
      const outTs = lastOut.get(leadId) ?? 0
      result.set(leadId, inTs > outTs ? inTs : null)
    }
    return result
  }, [crm.interactions])

  useEffect(() => {
    if (!restrictToBotKind) {
      setRestrictInstanceIds(null)
      return
    }
    let alive = true
    void fetchWhatsappChannelInstances()
      .then((rows) => {
        if (!alive) return
        setRestrictInstanceIds(
          new Set(rows.filter((r) => r.botKind === restrictToBotKind).map((r) => r.id)),
        )
      })
      .catch(() => {
        if (alive) setRestrictInstanceIds(new Set())
      })
    return () => {
      alive = false
    }
  }, [restrictToBotKind])

  const conversations = useMemo(() => {
    const text = search.trim().toLowerCase()
    const filtered = crm.leads.filter((lead) => {
      if (restrictToBotKind) {
        if (!restrictInstanceIds) return false
        if (!lead.whatsappInstanceId || !restrictInstanceIds.has(lead.whatsappInstanceId)) return false
      }
      if (ownerFilter !== 'all' && lead.ownerId !== ownerFilter) return false
      if (unreadOnly && !isUnread(lead.id)) return false
      if (!text) return true
      return [lead.patientName, lead.phone, lead.summary].join(' ').toLowerCase().includes(text)
    })

    if (sortMode === 'long_wait') {
      // Leads aguardando resposta primeiro, mais antigos no topo.
      // Lead sem espera pendente cai pro fim (ordenado por interação recente).
      return filtered.sort((a, b) => {
        const aw = waitingSinceByLead.get(a.id) ?? null
        const bw = waitingSinceByLead.get(b.id) ?? null
        if (aw !== null && bw !== null) return aw - bw
        if (aw !== null) return -1
        if (bw !== null) return 1
        const ah = crm.interactions.find((i) => i.leadId === a.id)?.happenedAt ?? a.createdAt
        const bh = crm.interactions.find((i) => i.leadId === b.id)?.happenedAt ?? b.createdAt
        return new Date(bh).getTime() - new Date(ah).getTime()
      })
    }

    return filtered.sort((a, b) => {
      const ah = crm.interactions.find((i) => i.leadId === a.id)?.happenedAt ?? a.createdAt
      const bh = crm.interactions.find((i) => i.leadId === b.id)?.happenedAt ?? b.createdAt
      return new Date(bh).getTime() - new Date(ah).getTime()
    })
  }, [crm.leads, crm.interactions, ownerFilter, search, sortMode, waitingSinceByLead, restrictToBotKind, restrictInstanceIds, unreadOnly, isUnread])

  const activeLead = crm.selectedLead ?? conversations[0] ?? null
  const waComposeBlocked = activeLead ? isLeadWhatsappComposeBlocked(activeLead) : false
  const activeHistory = useMemo(
    () => (activeLead ? crm.interactions.filter((i) => i.leadId === activeLead.id) : []),
    [crm.interactions, activeLead],
  )

  // Aplica o leadId da URL apenas uma vez por valor distinto. Antes este efeito
  // dependia de `crm` (objeto novo a cada render), entao rodava em TODO render e
  // forcava a selecao de volta para o lead da URL — travando a troca de lead.
  const leadIdParam = searchParams.get('leadId')
  const appliedLeadIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!leadIdParam) return
    if (appliedLeadIdRef.current === leadIdParam) return
    if (crm.leads.some((lead) => lead.id === leadIdParam)) {
      appliedLeadIdRef.current = leadIdParam
      crm.setSelectedLeadId(leadIdParam)
    }
  }, [leadIdParam, crm.leads, crm.setSelectedLeadId])

  useEffect(() => {
    if (ownerFilter !== 'all' && !crm.users.some((u) => u.id === ownerFilter)) {
      setOwnerFilter('all')
    }
  }, [crm.users, ownerFilter])

  useEffect(() => {
    if (!activeLead || crm.dataMode !== 'supabase') {
      setAiConversationBase(null)
      return
    }
    setModeLoading(true)
    void Promise.all([getConversationState(activeLead.id), getAiConfig()])
      .then(([state, cfg]) => {
        setLeadMode((state.owner_mode as ConversationOwnerMode) ?? 'auto')
        const bh = cfg ? businessHoursFromAiConfig(cfg) : { startHour: 8, endHour: 20 }
        setAiConversationBase({
          ownerMode: (state.owner_mode as ConversationOwnerMode) ?? 'auto',
          aiEnabled: state.ai_enabled !== false,
          businessHoursStartHour: bh.startHour,
          businessHoursEndHour: bh.endHour,
        })
      })
      .catch(() => {
        setLeadMode('auto')
        setAiConversationBase(null)
      })
      .finally(() => setModeLoading(false))
  }, [activeLead, crm.dataMode])

  const aiGateForThread = useMemo(() => {
    if (!aiConversationBase) return null
    return { ...aiConversationBase, ownerMode: leadMode }
  }, [aiConversationBase, leadMode])

  // Conversa ABERTA pelo atendente (selectedLeadId explícito) conta como lida — e re-marca
  // quando chega mensagem nova com ela aberta. Usamos selectedLeadId em vez de activeLead de
  // propósito: a 1ª conversa da lista aparece por fallback mas NÃO deve "auto-ler" sozinha,
  // senão o "marcar como não lida" seria revertido na hora.
  useEffect(() => {
    if (crm.selectedLeadId) markSeen(crm.selectedLeadId)
  }, [crm.selectedLeadId, activeHistory, markSeen])

  useEffect(() => {
    if (dataMode !== 'supabase' || !isSupabaseConfigured || !supabase) return
    const client = supabase

    const channel = client
      .channel('crm-chat-conversation-mode')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_conversation_states' }, (payload) => {
        const lid = activeLead?.id
        const row = payload.new as { lead_id?: string } | undefined
        if (lid && row?.lead_id === lid) {
          void getConversationState(lid).then((state) => {
            setLeadMode((state.owner_mode as ConversationOwnerMode) ?? 'auto')
            setAiConversationBase((prev) => ({
              ownerMode: (state.owner_mode as ConversationOwnerMode) ?? 'auto',
              aiEnabled: state.ai_enabled !== false,
              businessHoursStartHour: prev?.businessHoursStartHour ?? 8,
              businessHoursEndHour: prev?.businessHoursEndHour ?? 20,
            }))
          })
        }
      })
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [dataMode, activeLead?.id])

  return (
    <AppLayout title={title} fullHeight={true} mainClassName="min-h-0 p-2 sm:p-3 md:p-4 bg-muted/30 dark:bg-transparent">
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-2 overflow-hidden sm:gap-3 md:flex-row md:gap-4">
        {/* Left Column: Lead List */}
        <Card className="flex max-h-[38dvh] w-full shrink-0 flex-col gap-0 overflow-hidden rounded-2xl border border-border/40 bg-card/70 py-0 shadow-xl backdrop-blur-md min-[480px]:max-h-[42dvh] md:h-full md:max-h-none md:min-h-0 md:w-[min(300px,34vw)] md:max-w-[340px] md:min-w-[260px]">
          <CardHeader className="shrink-0 border-b border-border/20 bg-muted/5 p-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold">Mensagens</CardTitle>
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] tabular-nums">
                {conversations.length}
              </Badge>
            </div>
            <div className="mt-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground/70" />
                <Input 
                  value={search} 
                  onChange={(e) => setSearch(e.target.value)} 
                  className="h-9 rounded-lg border-border/60 bg-background/50 pl-8 text-xs focus:bg-background" 
                  placeholder="Buscar contato..." 
                />
              </div>
              <Select value={ownerFilter} onValueChange={(value) => setOwnerFilter(value ?? 'all')}>
                <LabeledSelectTrigger className="h-8 rounded-lg border-border/30 bg-background/30 text-[11px]" size="sm">
                  {ownerSelectLabel}
                </LabeledSelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todos responsáveis</SelectItem>
                  {crm.users.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-xs">
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={sortMode}
                onValueChange={(value) => setSortMode((value === 'long_wait' ? 'long_wait' : 'recent'))}
              >
                <LabeledSelectTrigger className="h-8 rounded-lg border-border/30 bg-background/30 text-[11px]" size="sm">
                  {sortMode === 'long_wait' ? 'Longa espera' : 'Mais recentes'}
                </LabeledSelectTrigger>
                <SelectContent>
                  <SelectItem value="recent" className="text-xs">Mais recentes</SelectItem>
                  <SelectItem value="long_wait" className="text-xs">Longa espera</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant={unreadOnly ? 'default' : 'outline'}
                size="sm"
                onClick={() => setUnreadOnly((v) => !v)}
                className="h-8 w-full justify-between rounded-lg px-2.5 text-[11px]"
                title="Mostrar só conversas com mensagem nova não lida"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3.5" />
                  {unreadOnly ? 'Só não lidas' : 'Não lidas'}
                </span>
                {unreadCount > 0 ? (
                  <span
                    className={cn(
                      'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums',
                      unreadOnly ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground',
                    )}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                ) : null}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-border/40">
            {conversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-muted-foreground/60">
                <p className="text-xs">Nenhuma conversa encontrada</p>
              </div>
            ) : (
              <div className="divide-y divide-border/5">
                {conversations.map((lead) => {
                  const waitingSince = waitingSinceByLead.get(lead.id) ?? null
                  const waitingMinutes = waitingSince ? Math.floor((Date.now() - waitingSince) / 60000) : 0
                  const waitingLabel = waitingMinutes >= 60
                    ? `${Math.floor(waitingMinutes / 60)}h${waitingMinutes % 60 ? ` ${waitingMinutes % 60}m` : ''}`
                    : `${waitingMinutes}m`
                  const unread = isUnread(lead.id)
                  const isActive = crm.selectedLeadId === lead.id
                  return (
                  <button
                    key={lead.id}
                    onClick={() => { markSeen(lead.id); crm.setSelectedLeadId(lead.id) }}
                    className={cn(
                      'flex w-full gap-3 p-3 text-left transition-all duration-200 hover:bg-muted/30 sm:px-4',
                      isActive
                        ? 'bg-primary/5 shadow-[inset_3px_0_0_0_hsl(var(--primary))]'
                        : unread ? 'bg-primary/[0.03]' : 'transparent',
                    )}
                  >
                    <span
                      className={cn(
                        'relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tracking-tight',
                        unread ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                      )}
                      aria-hidden
                    >
                      {initials(lead.patientName)}
                      {unread ? (
                        <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-card" />
                      ) : null}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className={cn(
                        "truncate text-sm tracking-tight",
                        unread ? "font-bold text-foreground" : isActive ? "font-medium text-primary" : "font-medium text-foreground"
                      )}>
                        {lead.patientName}
                      </span>
                      <span className={cn(
                        "shrink-0 text-[10px] tabular-nums",
                        unread ? "font-semibold text-primary" : "text-muted-foreground/60"
                      )}>
                        {formatConversationStamp(lead.last_interaction_at ?? lead.createdAt)}
                      </span>
                    </div>
                    <p className={cn(
                      "line-clamp-1 w-full text-xs leading-normal",
                      unread ? "font-medium text-foreground/80" : "text-muted-foreground/70"
                    )}>
                      {lead.summary || 'Sem resumo disponível'}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        lead.temperature === 'hot' ? "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.3)]" :
                        lead.temperature === 'warm' ? "bg-yellow-500" : "bg-blue-500"
                      )} title={lead.temperature} />
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                          getSourceStyle(lead.source).pill,
                        )}
                      >
                        <span className={cn('h-1 w-1 rounded-full', getSourceStyle(lead.source).dot)} aria-hidden />
                        {getSourceStyle(lead.source).label}
                      </span>
                      {waitingSince ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider',
                            waitingMinutes >= 30
                              ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                          )}
                          title={`Última mensagem do paciente sem resposta há ${waitingLabel}`}
                        >
                          ⏱ {waitingLabel}
                        </span>
                      ) : null}
                    </div>
                    </div>
                  </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Middle Column: Chat Area */}
        <Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden rounded-2xl border border-border/40 bg-card py-0 shadow-xl md:flex-[3]">
          {activeLead ? (
            <>
              <CardHeader className="shrink-0 border-b border-border/20 bg-muted/5 p-3 sm:px-5 sm:py-4">
                <div className="flex flex-wrap items-start justify-between gap-2 sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="truncate text-base font-bold tracking-tight sm:text-lg">
                        {activeLead.patientName}
                      </CardTitle>
                      {activeLead.temperature === 'hot' && (
                        <Badge className="bg-orange-500/10 text-orange-600 hover:bg-orange-500/10 dark:text-orange-400 border-none px-1.5 py-0 text-[10px]">
                          HOT
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground/80">
                      {(() => {
                        const ph = getLeadPhoneDisplay(activeLead)
                        return (
                          <span
                            className={ph.isReal ? 'font-mono' : 'italic text-muted-foreground/55'}
                            title={ph.isReal ? undefined : 'Telefone real ainda não recebido do ManyChat'}
                          >
                            {ph.label}
                          </span>
                        )
                      })()}
                      <span className="text-muted-foreground/30">•</span>
                      <span className="capitalize">{activeLead.source.replace('meta_', '')}</span>
                      {(() => {
                        const stamp = formatConversationHeaderStamp(activeLead.last_interaction_at ?? activeLead.createdAt)
                        return stamp ? (
                          <>
                            <span className="text-muted-foreground/30">•</span>
                            <span title="Data da última mensagem">{stamp}</span>
                          </>
                        ) : null
                      })()}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl gap-1.5 text-xs"
                      onClick={() => {
                        markUnread(activeLead.id)
                        crm.setSelectedLeadId('')
                        toast.success('Conversa marcada como não lida')
                      }}
                      title="Marcar esta conversa como não lida (volta a aparecer em destaque na lista)"
                    >
                      <Mail className="size-3.5" />
                      <span className="hidden sm:inline">Não lida</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="lg:hidden rounded-xl gap-1.5 text-xs"
                      onClick={() => setLeadSheetOpen(true)}
                    >
                      <UserRound className="size-3.5" />
                      Ficha
                    </Button>
                    <div className="hidden lg:block">
                      <ConversationModeSwitch
                        value={leadMode}
                        loading={modeLoading}
                        onChange={(next) => {
                          setModeLoading(true)
                          void setConversationMode(activeLead.id, next)
                            .then((state) => {
                              setLeadMode(state.owner_mode as ConversationOwnerMode)
                              toast.success(`Modo alterado para ${MODE_SUMMARY[next]}`)
                            })
                            .catch(() => toast.error('Falha ao alterar modo'))
                            .finally(() => setModeLoading(false))
                        }}
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/10 p-2 sm:p-4 dark:bg-background/20">
                <LeadChatThread
                  leadId={activeLead.id}
                  history={activeHistory}
                  canCompose={crm.currentPermission.canRouteLeads && !waComposeBlocked}
                  readOnlyInstagramHint={waComposeBlocked}
                  aiConversationBase={crm.dataMode === 'supabase' ? aiGateForThread : null}
                />
              </CardContent>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-12 text-center">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/5 shadow-inner">
                <span className="text-3xl grayscale-[0.5] opacity-50">📬</span>
              </div>
              <h3 className="text-lg font-semibold tracking-tight">Sua Central de Mensagens</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground/80">
                Selecione um lead na lista lateral para iniciar o atendimento ou ver o histórico completo.
              </p>
            </div>
          )}
        </Card>

        {/* Right Column: Lead Sidebar (desktop lg+) */}
        {activeLead && (
          <WorkspaceLeadSidebar 
            lead={activeLead} 
            history={activeHistory}
            className="hidden h-full min-h-0 lg:flex lg:w-[min(340px,28vw)] lg:shrink-0" 
          />
        )}

        {/* Lead Sheet (mobile/tablet) */}
        {activeLead && (
          <Sheet open={leadSheetOpen} onOpenChange={setLeadSheetOpen}>
            <SheetContent side="right" className="w-[min(100vw,420px)] p-0 overflow-hidden">
              <SheetHeader className="sr-only">
                <SheetTitle>Ficha do lead</SheetTitle>
                <SheetDescription>Campos e etapa do lead na conversa</SheetDescription>
              </SheetHeader>
              <WorkspaceLeadSidebar
                lead={activeLead}
                history={activeHistory}
                className="flex h-full w-full rounded-none border-0 shadow-none"
              />
            </SheetContent>
          </Sheet>
        )}
      </div>
    </AppLayout>
  )
}

