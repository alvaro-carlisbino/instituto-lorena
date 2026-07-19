import { LayoutDashboardIcon } from 'lucide-react'

import { WidgetLayoutEditor } from '@/components/config/WidgetLayoutEditor'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

export function DashboardConfigPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Painel">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Seu perfil não pode alterar os cards do dashboard.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Painel">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={crm.addDashboardWidget}>
          Novo card
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="pt-6">
          {crm.dashboardWidgets.length === 0 ? (
            <EmptyState
              icon={LayoutDashboardIcon}
              title="Nenhum card configurado"
              description='Clique em "Novo card" para adicionar um indicador ao dashboard.'
            />
          ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {crm.dashboardWidgets
              .sort((a, b) => a.position - b.position)
              .map((card) => (
                <li key={card.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor={`dash-title-${card.id}`} className="text-xs text-muted-foreground">Título do card</Label>
                      <Input
                        id={`dash-title-${card.id}`}
                        value={card.title}
                        onChange={(event) => crm.updateDashboardWidget(card.id, { title: event.target.value })}
                        placeholder="Ex.: Leads ativos"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`dash-metric-${card.id}`} className="text-xs text-muted-foreground">Métrica</Label>
                      <Select
                        value={card.metricKey}
                        onValueChange={(value) => {
                          if (!value) return
                          crm.updateDashboardWidget(card.id, { metricKey: value })
                        }}
                      >
                        <SelectTrigger id={`dash-metric-${card.id}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            'leads-active',
                            'leads-hot',
                            'qualified-ai',
                            'channels-active',
                            ...crm.metrics.map((m) => m.id),
                          ].includes(card.metricKey) ? null : (
                            <SelectItem value={card.metricKey}>Métrica atual</SelectItem>
                          )}
                          <SelectItem value="leads-active">Leads ativos (contagem)</SelectItem>
                          <SelectItem value="leads-hot">Leads quentes</SelectItem>
                          <SelectItem value="qualified-ai">Qualificados (IA)</SelectItem>
                          <SelectItem value="channels-active">Canais ativos</SelectItem>
                          {crm.metrics.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Label className="cursor-pointer text-sm font-normal sm:col-span-2">
                      <Checkbox
                        checked={card.enabled}
                        onCheckedChange={(checked) => crm.updateDashboardWidget(card.id, { enabled: checked })}
                      />
                      Mostrar no dashboard
                    </Label>
                    <div className="sm:col-span-2">
                      <Label className="mb-2 block text-xs font-medium text-muted-foreground">Posição na tela (opcional)</Label>
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
          )}
        </CardContent>
      </Card>
    </AppLayout>
  )
}
