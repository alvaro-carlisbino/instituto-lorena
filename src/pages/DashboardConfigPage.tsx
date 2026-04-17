import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

export function DashboardConfigPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Configuração do dashboard" subtitle="Sem permissão para editar o dashboard.">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Seu perfil não pode alterar os cards do dashboard.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Configuração do dashboard" subtitle="Escolha cards, ordem e métricas exibidas no dashboard comercial.">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={crm.addDashboardWidget}>
          Novo card
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {crm.dashboardWidgets
              .sort((a, b) => a.position - b.position)
              .map((card) => (
                <li key={card.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <Input
                      value={card.title}
                      onChange={(event) => crm.updateDashboardWidget(card.id, { title: event.target.value })}
                      placeholder="Título"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <Input
                        value={card.metricKey}
                        onChange={(event) => crm.updateDashboardWidget(card.id, { metricKey: event.target.value })}
                        placeholder="Chave da métrica"
                        className="max-w-[12rem]"
                      />
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-input"
                          checked={card.enabled}
                          onChange={(event) => crm.updateDashboardWidget(card.id, { enabled: event.target.checked })}
                        />
                        Ativo
                      </label>
                    </div>
                    <div className="col-span-full grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <Label className="text-xs">Layout (JSON)</Label>
                        <Textarea
                          rows={3}
                          className="font-mono text-xs"
                          defaultValue={JSON.stringify(card.layout ?? {}, null, 2)}
                          onBlur={(e) => {
                            try {
                              crm.updateDashboardWidget(card.id, { layout: JSON.parse(e.target.value || '{}') })
                            } catch {
                              /* ignore */
                            }
                          }}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Config (JSON)</Label>
                        <Textarea
                          rows={3}
                          className="font-mono text-xs"
                          defaultValue={JSON.stringify(card.widgetConfig ?? {}, null, 2)}
                          onBlur={(e) => {
                            try {
                              crm.updateDashboardWidget(card.id, { widgetConfig: JSON.parse(e.target.value || '{}') })
                            } catch {
                              /* ignore */
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => crm.moveDashboardWidget(card.id, 'up')}>
                      Subir
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => crm.moveDashboardWidget(card.id, 'down')}>
                      Descer
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => crm.removeDashboardWidget(card.id)}>
                      Remover
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
