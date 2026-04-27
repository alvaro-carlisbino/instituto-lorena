import { useMemo, useState } from 'react'
import { Search, Tags } from 'lucide-react'

import { LeadChatThread } from '@/components/leads/LeadChatThread'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

const QUICK_REPLIES = [
  'Oi! Tudo bem? Posso te ajudar com valores e horários.',
  'Temos horários disponíveis nesta semana. Prefere manhã ou tarde?',
  'Perfeito, vou te encaminhar os próximos passos para fechar.',
]

export function ChatWorkspacePage() {
  const crm = useCrm()
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')

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

  return (
    <AppLayout title="Chat comercial" subtitle="Workspace estilo WhatsApp Web para atendimento completo.">
      <div className="grid min-h-[72vh] gap-4 lg:grid-cols-[320px_1fr_320px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/60 p-3">
            <CardTitle className="text-sm font-semibold">Conversas</CardTitle>
            <div className="grid gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" placeholder="Buscar conversa..." />
              </div>
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger>
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
                <SelectTrigger>
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
                className={`w-full rounded-md border px-3 py-2 text-left transition ${
                  crm.selectedLeadId === lead.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'
                }`}
                onClick={() => crm.setSelectedLeadId(lead.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="m-0 truncate text-sm font-medium">{lead.patientName}</p>
                  <Badge variant="outline">{lead.temperature}</Badge>
                </div>
                <p className="m-0 truncate text-xs text-muted-foreground">{lead.summary}</p>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="flex min-h-[72vh] flex-col overflow-hidden">
          <CardHeader className="border-b border-border/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-semibold">{activeLead?.patientName ?? 'Sem conversa selecionada'}</CardTitle>
                <p className="m-0 text-xs text-muted-foreground">{activeLead?.phone ?? 'Selecione um lead à esquerda'}</p>
              </div>
              <div className="flex gap-2">
                {QUICK_REPLIES.map((reply, idx) => (
                  <Button
                    key={idx}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => crm.setDraftMessage(reply)}
                  >
                    Resposta {idx + 1}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 p-2">
            {activeLead ? (
              <LeadChatThread leadId={activeLead.id} history={activeHistory} canCompose={crm.currentPermission.canRouteLeads} />
            ) : (
              <p className="m-auto text-sm text-muted-foreground">Nenhuma conversa disponível.</p>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/60 p-3">
            <CardTitle className="text-sm font-semibold">Contexto do lead</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3 text-sm">
            {activeLead ? (
              <>
                <p className="m-0"><strong>Pipeline:</strong> {crm.pipelineCatalog.find((p) => p.id === activeLead.pipelineId)?.name ?? activeLead.pipelineId}</p>
                <p className="m-0"><strong>Etapa:</strong> {activeLead.stageId}</p>
                <p className="m-0"><strong>Responsável:</strong> {crm.getOwnerName(activeLead.ownerId)}</p>
                <p className="m-0"><strong>Pontuação:</strong> {activeLead.score}</p>
                <div className="rounded-md border border-border p-2">
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

