import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { DynamicFieldRenderer } from '@/components/leads/DynamicFieldRenderer'
import { LeadChatThread } from '@/components/leads/LeadChatThread'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useCrm } from '@/context/CrmContext'
import { sourceLabel } from '@/hooks/useCrmState'
import { workflowFieldsForContext } from '@/lib/leadFields'
import { CRM_ASSISTANT_PATH } from '@/services/crmAiAssistant'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LeadDetailSheet({ open, onOpenChange }: Props) {
  const crm = useCrm()
  const lead = crm.selectedLead
  const pipeline = lead ? crm.pipelineCatalog.find((p) => p.id === lead.pipelineId) : null
  const stageName = lead && pipeline ? pipeline.stages.find((s) => s.id === lead.stageId)?.name ?? lead.stageId : ''

  const leadHistory = useMemo(() => {
    if (!lead) return []
    return crm.interactions.filter((i) => i.leadId === lead.id)
  }, [crm.interactions, lead])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {lead ? (
          <>
            <SheetHeader className="border-b border-border p-4 text-left">
              <SheetTitle className="pr-10 text-left">{lead.patientName}</SheetTitle>
              <SheetDescription className="text-left">
                <span className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{pipeline?.name ?? lead.pipelineId}</Badge>
                  <Badge variant="outline">{stageName}</Badge>
                  <Badge variant="outline">{sourceLabel[lead.source]}</Badge>
                  <Badge variant="outline">{crm.getOwnerName(lead.ownerId)}</Badge>
                </span>
              </SheetDescription>
              <div className="pt-2">
                <Link
                  to={`${CRM_ASSISTANT_PATH}?leadId=${encodeURIComponent(lead.id)}&focus=lead`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Assistente IA sobre este lead
                </Link>
              </div>
            </SheetHeader>

            <div className="grid gap-4 p-4">
              <section aria-labelledby="lead-fields-heading">
                <h2 id="lead-fields-heading" className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Campos
                </h2>
                {crm.currentPermission.canRouteLeads ? (
                  <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2">
                    {workflowFieldsForContext(crm.workflowFields, 'lead_detail').map((field) => (
                      <DynamicFieldRenderer
                        key={field.id}
                        field={field}
                        lead={lead}
                        onChange={(next) => crm.persistLeadPatch(next)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem permissão para editar campos.</p>
                )}
              </section>

              <section aria-labelledby="lead-chat-heading" className="flex min-h-[18rem] flex-col">
                <h2 id="lead-chat-heading" className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Conversas
                </h2>
                <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card p-2">
                  <LeadChatThread
                    leadId={lead.id}
                    history={leadHistory}
                    canCompose={crm.currentPermission.canRouteLeads}
                  />
                </div>
              </section>
            </div>
          </>
        ) : (
          <SheetHeader className="p-4">
            <SheetTitle>Lead</SheetTitle>
            <SheetDescription>Nenhum lead selecionado.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}
