import { useCrm } from '@/context/CrmContext'
import { AiCopilotWidget } from '@/components/leads/AiCopilotWidget'
import { DynamicFieldRenderer } from '@/components/leads/DynamicFieldRenderer'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import type { Lead, Interaction } from '@/mocks/crmMock'

type Props = {
  lead: Lead
  history: Interaction[]
}

export function WorkspaceLeadSidebar({ lead, history }: Props) {
  const crm = useCrm()

  const handleUpdateLead = (updatedLead: Lead) => {
    crm.persistLeadPatch(updatedLead)
  }

  return (
    <Card className="flex h-full w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-card shadow-none hidden xl:flex">
      <CardHeader className="shrink-0 border-b border-border/20 p-3 sm:p-4 bg-muted/5">
        <CardTitle className="text-sm font-semibold">Ficha do Paciente</CardTitle>
      </CardHeader>
      
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="space-y-6">
          <AiCopilotWidget lead={lead} interactions={history} />

          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Campos Personalizados
            </h3>
            {crm.workflowFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum campo configurado.</p>
            ) : (
              <div className="space-y-3">
                {crm.workflowFields.map((field) => (
                  <DynamicFieldRenderer
                    key={field.id}
                    field={field}
                    lead={lead}
                    compact={true}
                    onChange={handleUpdateLead}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </Card>
  )
}
