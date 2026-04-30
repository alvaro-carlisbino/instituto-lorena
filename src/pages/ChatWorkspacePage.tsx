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
    <AppLayout title="Conversas" mainClassName="py-2 sm:py-3 space-y-0 lg:pb-4">
      <div className="flex w-full min-h-0 flex-1 basis-0 flex-col gap-3 overflow-hidden lg:flex-row lg:items-stretch lg:gap-4" style={{ height: 'calc(100dvh - 10.5rem)', maxHeight: '940px' }}>
        <Card className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-card shadow-none
          max-h-[min(28vh,200px)] sm:max-h-[min(32vh,240px)]
          lg:h-full lg:max-h-none lg:w-[min(260px,30vw)] lg:max-w-[280px] lg:min-w-[240px]
          xl:w-[min(300px,24vw)] xl:max-w-[300px] w-full min-h-0">
          <CardHeader className="shrink-0 border-b border-border/20 p-3 sm:p-4">
            <div className="flex items-baseline justify-between gap-2">
              <CardTitle className="m-0 text-sm font-semibold">Lista</CardTitle>
              <span className="text-xs font-mono font-medium tabular-nums text-muted-foreground" aria-live="polite">
                {conversations.length}
              </span>
            </div>
            <div className="grid gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-xl border-border/70 pl-8" placeholder="Buscar conversa..." />
              </div>
                <Select value={ownerFilter} onValueChange={(value) => setOwnerFilter(value ?? 'all')}>
                  <LabeledSelectTrigger className="rounded-lg border-border/40 font-medium" size="sm">
                    {ownerSelectLabel}
                  </LabeledSelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos responsáveis</SelectItem>
                    {crm.users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {conversations.map((lead) => (
              <button
                key={lead.id}
                type="button"
                className={`w-full rounded-xl border px-3 py-2 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                  crm.selectedLeadId === lead.id ? 'border-primary bg-primary/10 shadow-sm' : 'border-border/70 hover:bg-muted/40'
                }`}
                aria-label={`Abrir conversa com ${lead.patientName}`}
                onClick={() => crm.setSelectedLeadId(lead.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="m-0 truncate text-sm font-medium">{lead.patientName}</p>
                  <Badge variant="outline">{lead.temperature}</Badge>
                </div>
                <p className="m-0 truncate text-xs text-muted-foreground">{lead.summary}</p>
              </button>
            ))}
            {conversations.length === 0 ? (
              <div className="px-2 py-8 text-center">
                <p className="m-0 text-sm font-medium text-foreground">Nenhuma conversa por aqui</p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">Tente outro termo de busca ou ajuste os filtros.</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 min-w-[320px] flex-[2] basis-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-card shadow-none lg:h-full">
          <CardHeader className="shrink-0 border-b border-border/20 p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1 overflow-hidden">
                <CardTitle className="truncate text-base font-semibold sm:text-lg" aria-live="polite">
                  {activeLead?.patientName ?? 'Sem conversa selecionada'}
                </CardTitle>
                <p className="m-0 text-xs text-muted-foreground sm:text-sm">
                  {activeLead?.phone ?? 'Selecione um lead na lista em cima (ou à esquerda)'}
                </p>
                {activeLead ? (
                  <>
                    <details className="mt-2 max-w-2xl rounded-lg border border-border/50 bg-muted/15 lg:hidden">
                      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                        <span className="text-muted-foreground">Modo de atendimento:</span>{' '}
                        {MODE_SUMMARY[leadMode]}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">(tocar para alterar)</span>
                      </summary>
                      <div className="border-t border-border/40 px-2 pb-2 pt-2">
                        <ConversationModeSwitch
                          value={leadMode}
                          loading={modeLoading}
                          showFooterHint={false}
                          onChange={(next) => {
                            setModeLoading(true)
                            void setConversationMode(activeLead.id, next)
                              .then((state) => {
                                setLeadMode(state.owner_mode)
                                if (next === 'human') toast.success('Atendimento: só a equipe.')
                                else if (next === 'ai') toast.success('Atendimento: assistente de IA ativa nesta conversa.')
                                else toast.success('Atendimento: modo misto (regras + equipe).')
                              })
                              .catch((error) =>
                                toast.error(error instanceof Error ? error.message : 'Não foi possível alterar o modo.'),
                              )
                              .finally(() => setModeLoading(false))
                          }}
                        />
                      </div>
                    </details>
                    <div className="mt-3 hidden max-w-2xl lg:block">
                      <ConversationModeSwitch
                        value={leadMode}
                        loading={modeLoading}
                        onChange={(next) => {
                          setModeLoading(true)
                          void setConversationMode(activeLead.id, next)
                            .then((state) => {
                              setLeadMode(state.owner_mode)
                              if (next === 'human') toast.success('Atendimento: só a equipe.')
                              else if (next === 'ai') toast.success('Atendimento: assistente de IA ativa nesta conversa.')
                              else toast.success('Atendimento: modo misto (regras + equipe).')
                            })
                            .catch((error) => toast.error(error instanceof Error ? error.message : 'Não foi possível alterar o modo.'))
                            .finally(() => setModeLoading(false))
                        }}
                      />
                    </div>
                  </>
                ) : null}
              </div>
              <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:max-w-none lg:max-w-[min(100%,26rem)]">
                {activeLead ? (
                  <Link
                    to={`/leads?leadId=${encodeURIComponent(activeLead.id)}`}
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                      className: '2xl:hidden rounded-lg text-xs sm:text-sm',
                    })}
                  >
                    Ficha completa
                  </Link>
                ) : null}
                {!waComposeBlocked ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-lg border-border/70 text-xs transition-all duration-200 hover:-translate-y-0.5 sm:text-sm"
                    onClick={() => crm.setDraftMessage('Oi! Tudo bem? Posso te ajudar com valores e horários?')}
                  >
                    Mensagem Padrão
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden bg-muted/25 p-2 sm:p-3 dark:bg-background/80"
            style={{ minHeight: 'min(52dvh, 24rem)' }}
          >
            {activeLead ? (
              <LeadChatThread
                leadId={activeLead.id}
                history={activeHistory}
                canCompose={crm.currentPermission.canRouteLeads && !waComposeBlocked}
                readOnlyInstagramHint={waComposeBlocked}
              />
            ) : (
              <div className="m-auto text-center flex flex-col items-center justify-center h-full">
                <p className="text-lg font-medium text-foreground">Selecione uma conversa</p>
                <p className="mt-2 text-sm text-muted-foreground">Escolha um lead na lista para visualizar o histórico de mensagens.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {activeLead ? (
          <WorkspaceLeadSidebar lead={activeLead} history={activeHistory} />
        ) : null}
      </div>
    </AppLayout>
  )
}

