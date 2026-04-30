import { useMemo, useState } from 'react'
import { ClipboardListIcon, UserIcon } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DynamicFieldRenderer } from '@/components/leads/DynamicFieldRenderer'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { useCrm } from '@/context/CrmContext'
import { sourceLabel } from '@/hooks/useCrmState'
import { AppLayout } from '@/layouts/AppLayout'
import { workflowFieldsForContext } from '@/lib/leadFields'
import { cn } from '@/lib/utils'

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  phone: 'Telefone',
  meta_lead: 'Meta',
  manual: 'Manual',
  webhook: 'Link externo',
  in_app: 'No app',
}

const DIRECTION_LABEL: Record<string, string> = {
  inbound: 'Entrada',
  outbound: 'Saída',
}

export function HistoryPage() {
  const crm = useCrm()
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [page, setPage] = useState<number>(1)
  const pageSize = 6

  const visibleLeads = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()
    return crm.leads.filter((lead) => {
      if (!normalized) return true
      return lead.patientName.toLowerCase().includes(normalized) || lead.summary.toLowerCase().includes(normalized)
    })
  }, [crm.leads, searchTerm])

  const totalPages = Math.max(1, Math.ceil(visibleLeads.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paginatedLeads = visibleLeads.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <AppLayout title="Histórico">
      <Card className="shadow-none border-border rounded-none">
        <CardContent className="space-y-6 pt-6">
          {crm.isLoading ? <SkeletonBlocks rows={5} /> : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              className="w-full min-w-0 sm:max-w-xs"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value)
                setPage(1)
              }}
              placeholder="Buscar paciente"
            />
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((previous) => Math.max(1, previous - 1))}>
                Anterior
              </Button>
              <Badge variant="secondary" className="tabular-nums">
                {currentPage}/{totalPages}
              </Badge>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}>
                Próxima
              </Button>
            </div>
          </div>

          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
            <aside className="flex max-h-[min(40dvh,18rem)] flex-col gap-px overflow-y-auto border border-border bg-border/50 lg:max-h-none">
              {paginatedLeads.length === 0 && !crm.isLoading ? (
                <EmptyState
                  icon={UserIcon}
                  title="Nenhum paciente encontrado"
                  description="Ajuste a busca ou aguarde novos leads entrarem no sistema."
                  className="py-8"
                />
              ) : (
                paginatedLeads.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    className={cn(
                      'px-4 py-3 text-left text-sm transition bg-card hover:bg-muted/30 focus:outline-none',
                      crm.selectedLeadId === lead.id && 'bg-muted/10 font-bold border-l-2 border-l-primary'
                    )}
                    onClick={() => crm.setSelectedLeadId(lead.id)}
                  >
                    <span className="block truncate tracking-wide text-foreground uppercase">{lead.patientName}</span>
                    <span className="block text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mt-1">{sourceLabel[lead.source]}</span>
                  </button>
                ))
              )}
            </aside>

            <article className="min-h-[min(24dvh,12rem)] min-w-0 bg-card border-none shadow-none lg:min-h-[12rem]">
              {crm.selectedLead ? (
                <>
                  <h3 className="mt-0 pb-4 text-sm tracking-widest uppercase font-bold text-foreground border-b border-border mb-6">{crm.selectedLead.patientName}</h3>
                  {crm.currentPermission.canRouteLeads ? (
                    <div className="mb-4 grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2">
                      {workflowFieldsForContext(crm.workflowFields, 'lead_detail').map((field) => {
                        const lead = crm.selectedLead
                        if (!lead) return null
                        return (
                          <DynamicFieldRenderer
                            key={field.id}
                            field={field}
                            lead={lead}
                            onChange={(next) => crm.persistLeadPatch(next)}
                          />
                        )
                      })}
                    </div>
                  ) : null}
                  {crm.selectedLeadHistory.length === 0 ? (
                    <EmptyState
                      icon={ClipboardListIcon}
                      title="Nenhum registro"
                      description="Este paciente ainda não possui interações registradas."
                      className="py-8"
                    />
                  ) : (
                    <ul className="m-0 list-none space-y-px bg-border/50 pt-px border-t border-border mt-8">
                      {crm.selectedLeadHistory.map((item) => (
                        <li key={item.id} className="bg-card p-4 hover:bg-muted/10 transition-colors">
                          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/30 pb-2 mb-3">
                            <strong className="text-xs uppercase font-bold tracking-wider">{item.author}</strong>
                            <small className="text-[10px] tabular-nums font-mono font-semibold text-muted-foreground">{new Date(item.happenedAt).toLocaleString('pt-BR')}</small>
                          </div>
                          <p className="my-0 mb-4 text-sm leading-relaxed text-foreground/80">{item.content}</p>
                          <div className="flex gap-2">
                            <Badge variant="outline" className="rounded-none text-[9px] uppercase tracking-widest">{CHANNEL_LABEL[item.channel] ?? item.channel}</Badge>
                            <Badge variant="secondary" className="rounded-none text-[9px] uppercase tracking-widest">{DIRECTION_LABEL[item.direction] ?? item.direction}</Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <EmptyState
                  icon={UserIcon}
                  title="Nenhum paciente selecionado"
                  description="Selecione um paciente na lista ao lado para ver o histórico de interações."
                  className="py-12"
                />
              )}
            </article>
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
