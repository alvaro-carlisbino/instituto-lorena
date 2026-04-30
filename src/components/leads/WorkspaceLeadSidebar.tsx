import { useCrm } from '@/context/CrmContext'
import { AiCopilotWidget } from '@/components/leads/AiCopilotWidget'
import { DynamicFieldRenderer } from '@/components/leads/DynamicFieldRenderer'
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
    <Card className="hidden h-full min-h-0 min-w-0 w-full max-w-full shrink-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-card shadow-none lg:flex lg:max-w-[min(100%,320px)] lg:basis-[min(320px,32vw)] xl:max-w-[min(100%,380px)] xl:basis-[min(360px,30vw)]">
      <CardHeader className="shrink-0 border-b border-border/20 bg-muted/5 p-3 sm:p-4">
        <CardTitle className="text-sm font-semibold">Ficha do Paciente</CardTitle>
      </CardHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4">
        <div className="space-y-5 sm:space-y-6">
          <AiCopilotWidget lead={lead} interactions={history} />

          <div className="space-y-3 sm:space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Campos Personalizados
            </h3>
            {crm.workflowFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum campo configurado.</p>
            ) : (
              <div className="flex flex-col gap-4 sm:gap-5">
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
      </div>
    </Card>
  )
}
