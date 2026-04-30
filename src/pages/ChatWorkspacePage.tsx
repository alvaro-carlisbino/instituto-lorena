import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { toast } from 'sonner'

import { ConversationModeSwitch } from '@/components/leads/ConversationModeSwitch'
import { LeadChatThread } from '@/components/leads/LeadChatThread'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { WorkspaceLeadSidebar } from '@/components/leads/WorkspaceLeadSidebar'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { labelForIdName } from '@/lib/selectDisplay'
import { getConversationState, setConversationMode, type ConversationOwnerMode } from '@/services/conversationControl'
import { isLeadWhatsappComposeBlocked } from '@/lib/leadFields'

const MODE_SUMMARY: Record<ConversationOwnerMode, string> = {
  human: 'Humano',
  ai: 'IA',
  auto: 'Misto',
}

export function ChatWorkspacePage() {
  const crm = useCrm()
  const { dataMode, refreshChatFromSupabase } = crm
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [leadMode, setLeadMode] = useState<ConversationOwnerMode>('auto')
  const [modeLoading, setModeLoading] = useState(false)

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

  const conversations = useMemo(() => {
    const text = search.trim().toLowerCase()
    return crm.leads
      .filter((lead) => {
        if (ownerFilter !== 'all' && lead.ownerId !== ownerFilter) return false
        if (!text) return true
        return [lead.patientName, lead.phone, lead.summary].join(' ').toLowerCase().includes(text)
      })
      .sort((a, b) => {
        const ah = crm.interactions.find((i) => i.leadId === a.id)?.happenedAt ?? a.createdAt
        const bh = crm.interactions.find((i) => i.leadId === b.id)?.happenedAt ?? b.createdAt
        return new Date(bh).getTime() - new Date(ah).getTime()
      })
  }, [crm.leads, crm.interactions, ownerFilter, search])

  const activeLead = crm.selectedLead ?? conversations[0] ?? null
  const waComposeBlocked = activeLead ? isLeadWhatsappComposeBlocked(activeLead) : false
  const activeHistory = useMemo(
    () => (activeLead ? crm.interactions.filter((i) => i.leadId === activeLead.id) : []),
    [crm.interactions, activeLead],
  )

  useEffect(() => {
    const leadId = searchParams.get('leadId')
    if (!leadId) return
    if (crm.leads.some((lead) => lead.id === leadId)) {
      crm.setSelectedLeadId(leadId)
    }
  }, [crm, searchParams])

  useEffect(() => {
    if (ownerFilter !== 'all' && !crm.users.some((u) => u.id === ownerFilter)) {
      setOwnerFilter('all')
    }
  }, [crm.users, ownerFilter])

  useEffect(() => {
    if (!activeLead || crm.dataMode !== 'supabase') return
    setModeLoading(true)
    void getConversationState(activeLead.id)
      .then((state) => setLeadMode((state.owner_mode as ConversationOwnerMode) ?? 'auto'))
      .catch(() => setLeadMode('auto'))
      .finally(() => setModeLoading(false))
  }, [activeLead, crm.dataMode])

  useEffect(() => {
    if (dataMode !== 'supabase' || !isSupabaseConfigured || !supabase) return
    const client = supabase

    const channel = client
      .channel('crm-chat-interactions-leads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'interactions' }, () => {
        void refreshChatFromSupabase()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        void refreshChatFromSupabase()
      })
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [dataMode, refreshChatFromSupabase])

  return (
    <AppLayout title="Conversas" fullHeight={true} mainClassName="p-3 sm:p-4 bg-muted/30 dark:bg-transparent">
      <div className="flex h-full w-full min-h-0 flex-col gap-3 overflow-hidden lg:flex-row lg:gap-4">
        {/* Left Column: Lead List */}
        <Card className="flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border/40 bg-card/70 shadow-xl backdrop-blur-md 
          h-[40dvh] lg:h-full lg:w-[min(320px,32vw)] lg:max-w-[340px] lg:min-w-[280px]">
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
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-border/40">
            {conversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-muted-foreground/60">
                <p className="text-xs">Nenhuma conversa encontrada</p>
              </div>
            ) : (
              <div className="divide-y divide-border/5">
                {conversations.map((lead) => (
                  <button
                    key={lead.id}
                    onClick={() => crm.setSelectedLeadId(lead.id)}
                    className={cn(
                      'flex w-full flex-col gap-1 p-3 text-left transition-all duration-200 hover:bg-muted/30 sm:px-4',
                      crm.selectedLeadId === lead.id ? 'bg-primary/5 shadow-[inset_3px_0_0_0_hsl(var(--primary))]' : 'transparent',
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className={cn(
                        "truncate text-sm font-medium tracking-tight",
                        crm.selectedLeadId === lead.id ? "text-primary" : "text-foreground"
                      )}>
                        {lead.patientName}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                        {lead.createdAt ? format(new Date(lead.createdAt), 'HH:mm', { locale: ptBR }) : ''}
                      </span>
                    </div>
                    <p className="line-clamp-1 w-full text-xs text-muted-foreground/70 leading-normal">
                      {lead.summary || 'Sem resumo disponível'}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        lead.temperature === 'hot' ? "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.3)]" : 
                        lead.temperature === 'warm' ? "bg-yellow-500" : "bg-blue-500"
                      )} title={lead.temperature} />
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40">
                        {lead.source === 'whatsapp' ? 'WhatsApp' : lead.source === 'meta_instagram' ? 'Instagram' : 'CRM'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Middle Column: Chat Area */}
        <Card className="flex min-w-0 flex-[3] flex-col overflow-hidden rounded-2xl border border-border/40 bg-card shadow-xl lg:h-full">
          {activeLead ? (
            <>
              <CardHeader className="shrink-0 border-b border-border/20 bg-muted/5 p-3 sm:px-5 sm:py-4">
                <div className="flex items-center justify-between gap-4">
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
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground/80">
                      <span className="font-mono">{activeLead.phone ? activeLead.phone : 'Sem telefone'}</span>
                      <span className="text-muted-foreground/30">•</span>
                      <span className="capitalize">{activeLead.source.replace('meta_', '')}</span>
                    </div>
                  </div>
                  
                  <div className="hidden lg:block">
                    <ConversationModeSwitch
                      value={leadMode}
                      loading={modeLoading}
                      size="sm"
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
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/10 p-2 sm:p-4 dark:bg-background/20">
                <LeadChatThread
                  leadId={activeLead.id}
                  history={activeHistory}
                  canCompose={crm.currentPermission.canRouteLeads && !waComposeBlocked}
                  readOnlyInstagramHint={waComposeBlocked}
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

        {/* Right Column: Lead Sidebar */}
        {activeLead && (
          <WorkspaceLeadSidebar 
            lead={activeLead} 
            history={activeHistory}
            className="hidden h-full 2xl:flex 2xl:w-[380px] 2xl:shrink-0" 
          />
        )}
      </div>
    </AppLayout>
  )
}

