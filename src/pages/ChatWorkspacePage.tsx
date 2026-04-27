import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Tags } from 'lucide-react'
import { toast } from 'sonner'

import { LeadChatThread } from '@/components/leads/LeadChatThread'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { getConversationState, setConversationMode, type ConversationOwnerMode } from '@/services/conversationControl'

const QUICK_REPLIES = [
  'Oi! Tudo bem? Posso te ajudar com valores e horários.',
  'Temos horários disponíveis nesta semana. Prefere manhã ou tarde?',
  'Perfeito, vou te encaminhar os próximos passos para fechar.',
]

export function ChatWorkspacePage() {
  const crm = useCrm()
  const { dataMode, refreshChatFromSupabase } = crm
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')
  const [leadMode, setLeadMode] = useState<ConversationOwnerMode>('auto')
  const [modeLoading, setModeLoading] = useState(false)

  const conversations = useMemo(() => {
    const text = search.trim().toLowerCase()
    return crm.leads
      .filter((lead) => {
        if (ownerFilter !== 'all' && lead.ownerId !== ownerFilter) return false
        if (tagFilter !== 'all' && lead.temperature !== tagFilter) return false
        if (!text) return true
        return [lead.patientName, lead.phone, lead.summary].join(' ').toLowerCase().includes(text)
      })
      .sort((a, b) => {
        const ah = crm.interactions.find((i) => i.leadId === a.id)?.happenedAt ?? a.createdAt
        const bh = crm.interactions.find((i) => i.leadId === b.id)?.happenedAt ?? b.createdAt
        return new Date(bh).getTime() - new Date(ah).getTime()
      })
  }, [crm.leads, crm.interactions, ownerFilter, search, tagFilter])

  const activeLead = crm.selectedLead ?? conversations[0] ?? null
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
    <AppLayout title="Central de conversas" subtitle="Atendimento rápido, organizado e fácil para toda a equipe.">
      <div className="grid min-h-[72vh] gap-4 lg:grid-cols-[320px_1fr_320px]">
        <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
          <CardHeader className="border-b border-border/60 bg-muted/20 p-3">
            <CardTitle className="text-sm font-semibold">Conversas</CardTitle>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {conversations.length} conversa(s) encontrada(s)
            </p>
            <div className="grid gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-xl border-border/70 pl-8" placeholder="Buscar conversa..." />
              </div>
              <Select value={ownerFilter} onValueChange={(value) => setOwnerFilter(value ?? 'all')}>
                <SelectTrigger className="rounded-xl border-border/70">
                  <SelectValue placeholder="Responsável" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos responsáveis</SelectItem>
                  {crm.users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={tagFilter} onValueChange={(v) => setTagFilter(v as 'all' | 'hot' | 'warm' | 'cold')}>
                <SelectTrigger className="rounded-xl border-border/70">
                  <SelectValue placeholder="Etiqueta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas etiquetas</SelectItem>
                  <SelectItem value="hot">Quente</SelectItem>
                  <SelectItem value="warm">Morno</SelectItem>
                  <SelectItem value="cold">Frio</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="max-h-[62vh] space-y-2 overflow-y-auto p-2">
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

        <Card className="flex min-h-[72vh] flex-col overflow-hidden rounded-2xl border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
          <CardHeader className="border-b border-border/60 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-semibold" aria-live="polite">
                  {activeLead?.patientName ?? 'Sem conversa selecionada'}
                </CardTitle>
                <p className="m-0 text-xs text-muted-foreground">{activeLead?.phone ?? 'Selecione um lead à esquerda'}</p>
                {activeLead ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">Atendimento:</span>
                    <Button
                      type="button"
                      size="sm"
                      variant={leadMode === 'human' ? 'default' : 'outline'}
                      disabled={modeLoading}
                      onClick={() => {
                        setModeLoading(true)
                        void setConversationMode(activeLead.id, 'human')
                          .then((state) => {
                            setLeadMode(state.owner_mode)
                            toast.success('Conversa em modo humano.')
                          })
                          .catch((error) => toast.error(error instanceof Error ? error.message : 'Falha ao alterar modo.'))
                          .finally(() => setModeLoading(false))
                      }}
                    >
                      Humano
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={leadMode === 'ai' ? 'default' : 'outline'}
                      disabled={modeLoading}
                      onClick={() => {
                        setModeLoading(true)
                        void setConversationMode(activeLead.id, 'ai')
                          .then((state) => {
                            setLeadMode(state.owner_mode)
                            toast.success('Conversa em modo IA.')
                          })
                          .catch((error) => toast.error(error instanceof Error ? error.message : 'Falha ao alterar modo.'))
                          .finally(() => setModeLoading(false))
                      }}
                    >
                      IA
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={leadMode === 'auto' ? 'default' : 'outline'}
                      disabled={modeLoading}
                      onClick={() => {
                        setModeLoading(true)
                        void setConversationMode(activeLead.id, 'auto')
                          .then((state) => {
                            setLeadMode(state.owner_mode)
                            toast.success('Conversa em modo automático por regras.')
                          })
                          .catch((error) => toast.error(error instanceof Error ? error.message : 'Falha ao alterar modo.'))
                          .finally(() => setModeLoading(false))
                      }}
                    >
                      Auto
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {QUICK_REPLIES.map((reply, idx) => (
                  <Button
                    key={idx}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-lg border-border/70 transition-all duration-200 hover:-translate-y-0.5"
                    onClick={() => crm.setDraftMessage(reply)}
                  >
                    Resposta {idx + 1}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 bg-[#f7f9fc] p-2 dark:bg-background">
            {activeLead ? (
              <LeadChatThread leadId={activeLead.id} history={activeHistory} canCompose={crm.currentPermission.canRouteLeads} />
            ) : (
              <div className="m-auto text-center">
                <p className="m-0 text-sm font-medium text-foreground">Nenhuma conversa disponível</p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">Quando houver mensagens, elas aparecem aqui automaticamente.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
          <CardHeader className="border-b border-border/60 bg-muted/20 p-3">
            <CardTitle className="text-sm font-semibold">Contexto do lead</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3 text-sm">
            {activeLead ? (
              <>
                <p className="m-0"><strong>Pipeline:</strong> {crm.pipelineCatalog.find((p) => p.id === activeLead.pipelineId)?.name ?? activeLead.pipelineId}</p>
                <p className="m-0"><strong>Etapa:</strong> {activeLead.stageId}</p>
                <p className="m-0"><strong>Responsável:</strong> {crm.getOwnerName(activeLead.ownerId)}</p>
                <p className="m-0"><strong>Pontuação:</strong> {activeLead.score}</p>
                <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5">
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Tags className="size-3.5" /> Etiquetas
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{activeLead.temperature}</Badge>
                    <Badge variant="secondary">{activeLead.source}</Badge>
                  </div>
                </div>
              </>
            ) : (
              <p className="m-0 text-muted-foreground">Selecione uma conversa para ver o contexto.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}

