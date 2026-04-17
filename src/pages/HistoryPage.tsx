import { useMemo, useState } from 'react'

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
    <AppLayout title="Histórico unificado" subtitle="Linha do tempo por paciente com canais e IA.">
      <Card className="shadow-sm">
        <CardContent className="space-y-4 pt-6">
          {crm.isLoading ? <SkeletonBlocks rows={5} /> : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Input
              className="max-w-xs"
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

          <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_1fr]">
            <aside className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-2">
              {paginatedLeads.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  className={cn(
                    'rounded-md px-3 py-2 text-left text-sm transition hover:bg-background',
                    crm.selectedLeadId === lead.id && 'bg-background font-medium shadow-sm'
                  )}
                  onClick={() => crm.setSelectedLeadId(lead.id)}
                >
                  <span className="block truncate">{lead.patientName}</span>
                  <span className="block text-xs text-muted-foreground">{sourceLabel[lead.source]}</span>
                </button>
              ))}
            </aside>

            <article className="min-h-[12rem] rounded-lg border border-border bg-card p-4 shadow-sm">
              <h3 className="mt-0 text-base font-semibold">{crm.selectedLead?.patientName ?? 'Nenhum lead selecionado'}</h3>
              {crm.selectedLead && crm.currentPermission.canRouteLeads ? (
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
              <ul className="m-0 list-none space-y-3 p-0">
                {crm.selectedLeadHistory.map((item) => (
                  <li key={item.id} className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <strong className="text-sm">{item.author}</strong>
                      <small className="text-xs text-muted-foreground">{new Date(item.happenedAt).toLocaleString('pt-BR')}</small>
                    </div>
                    <p className="my-2 text-sm">{item.content}</p>
                    <span className="text-xs text-muted-foreground">
                      {item.channel} · {item.direction}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
