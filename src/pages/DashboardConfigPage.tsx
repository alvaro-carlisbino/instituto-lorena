import { WidgetLayoutEditor } from '@/components/config/WidgetLayoutEditor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    <AppLayout
      title="Configuração do dashboard"
      subtitle="Escolha títulos, métricas e ordem dos cards — tudo por listas e números, sem JSON."
    >
      <Card className="mb-4 border-border/80 shadow-sm">
        <CardContent className="pt-4">
          <CardDescription className="text-sm leading-relaxed text-muted-foreground">
            Cada card mostra um número ligado a uma métrica. A grelha abaixo reserva-se para quando o dashboard passar a usar posições fixas no ecrã (opcional).
          </CardDescription>
        </CardContent>
      </Card>

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
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label className="text-xs text-muted-foreground">Título do card</Label>
                      <Input
                        value={card.title}
                        onChange={(event) => crm.updateDashboardWidget(card.id, { title: event.target.value })}
                        placeholder="Ex.: Leads ativos"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-xs text-muted-foreground">Métrica</Label>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={card.metricKey}
                        onChange={(event) => crm.updateDashboardWidget(card.id, { metricKey: event.target.value })}
                      >
                        {[
                          'leads-active',
                          'leads-hot',
                          'qualified-ai',
                          'channels-active',
                          ...crm.metrics.map((m) => m.id),
                        ].includes(card.metricKey) ? null : (
                          <option value={card.metricKey}>Métrica atual ({card.metricKey})</option>
                        )}
                        <option value="leads-active">Leads ativos (contagem)</option>
                        <option value="leads-hot">Leads quentes</option>
                        <option value="qualified-ai">Qualificados (IA)</option>
                        <option value="channels-active">Canais ativos</option>
                        {crm.metrics.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={card.enabled}
                        onChange={(event) => crm.updateDashboardWidget(card.id, { enabled: event.target.checked })}
                      />
                      Mostrar no dashboard
                    </label>
                    <div className="sm:col-span-2">
                      <Label className="mb-2 block text-xs font-medium text-muted-foreground">Posição (grelha reservada)</Label>
                      <WidgetLayoutEditor
                        layout={card.layout ?? {}}
                        helpId={`dash-layout-help-${card.id}`}
                        onLayoutChange={(next) => crm.updateDashboardWidget(card.id, { layout: next })}
                      />
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
