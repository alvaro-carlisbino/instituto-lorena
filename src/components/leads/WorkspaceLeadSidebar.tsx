import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

import { useCrm } from '@/context/CrmContext'
import { AiCopilotWidget } from '@/components/leads/AiCopilotWidget'
import { DynamicFieldRenderer } from '@/components/leads/DynamicFieldRenderer'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { workflowFieldsForContext } from '@/lib/leadFields'
import type { Lead, Interaction, WorkflowField } from '@/mocks/crmMock'

type Props = {
  lead: Lead
  history: Interaction[]
}

function groupFieldsBySection(fields: WorkflowField[]): [string, WorkflowField[]][] {
  const map = new Map<string, WorkflowField[]>()
  for (const f of fields) {
    const key = (f.section ?? '').trim() || 'Outros'
    const list = map.get(key) ?? []
    list.push(f)
    map.set(key, list)
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
  }
  return [...map.entries()].sort((a, b) => {
    const minA = Math.min(...a[1].map((x) => x.sortOrder))
    const minB = Math.min(...b[1].map((x) => x.sortOrder))
    return minA - minB || a[0].localeCompare(b[0])
  })
}

export function WorkspaceLeadSidebar({ lead, history }: Props) {
  const crm = useCrm()

  const handleUpdateLead = (updatedLead: Lead) => {
    crm.persistLeadPatch(updatedLead)
  }

  const sidebarFields = useMemo(() => {
    return workflowFieldsForContext(crm.workflowFields, 'lead_detail').filter((f) => f.fieldKey !== 'patient_name')
  }, [crm.workflowFields])

  const sections = useMemo(() => groupFieldsBySection(sidebarFields), [sidebarFields])

  return (
    <Card className="hidden h-full min-h-0 min-w-0 w-full max-w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-card shadow-none 2xl:flex 2xl:max-w-[min(100%,420px)] 2xl:basis-[min(400px,32vw)]">
      <CardHeader className="shrink-0 space-y-2 border-b border-border/20 bg-muted/5 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-tight">Ficha do lead</CardTitle>
          <Link
            to={`/leads?leadId=${encodeURIComponent(lead.id)}`}
            className={buttonVariants({ variant: 'outline', size: 'sm', className: 'h-8 shrink-0 text-xs' })}
          >
            Abrir no Kanban
          </Link>
        </div>
        <p className="m-0 text-[11px] leading-snug text-muted-foreground">
          Campos com o mesmo critério do detalhe do lead; o nome do paciente está na coluna do meio.
        </p>
      </CardHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:px-3 sm:py-3">
        <div className="space-y-4 sm:space-y-5">
          <AiCopilotWidget lead={lead} interactions={history} />

          <div className="space-y-2">
            <h3 className="px-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Campos ({sidebarFields.length})
            </h3>
            {sidebarFields.length === 0 ? (
              <p className="px-0.5 text-xs text-muted-foreground">Nenhum campo visível em «detalhe do lead».</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sections.map(([sectionName, list], idx) => (
                  <details
                    key={sectionName}
                    className="group rounded-lg border border-border/50 bg-muted/10 open:bg-muted/[0.18]"
                    open={idx === 0}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-2 text-left [&::-webkit-details-marker]:hidden">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {sectionName}
                        <span className="ml-1 font-mono font-normal text-foreground/70">({list.length})</span>
                      </span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                    </summary>
                    <div className="flex flex-col gap-2 border-t border-border/30 px-1.5 pb-2 pt-1">
                      {list.map((field) => (
                        <DynamicFieldRenderer
                          key={field.id}
                          field={field}
                          lead={lead}
                          compact
                          onChange={handleUpdateLead}
                        />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
