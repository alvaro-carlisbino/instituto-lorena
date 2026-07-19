import { MonitorIcon } from 'lucide-react'

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

export function TvConfigPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canViewTvPanel) {
    return (
      <AppLayout title="Tela TV">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Seu perfil não pode configurar o painel de TV.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Tela TV">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={crm.addTvWidget}>
          Novo widget
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="pt-6">
          {crm.tvWidgets.length === 0 ? (
            <EmptyState
              icon={MonitorIcon}
              title="Nenhum widget configurado"
              description='Clique em "Novo widget" para montar o painel de TV.'
            />
          ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {crm.tvWidgets
              .sort((a, b) => a.position - b.position)
              .map((widget) => (
                <li key={widget.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor={`tv-title-${widget.id}`} className="text-xs text-muted-foreground">Título no painel</Label>
                      <Input
                        id={`tv-title-${widget.id}`}
                        value={widget.title}
                        onChange={(event) => crm.updateTvWidget(widget.id, { title: event.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`tv-type-${widget.id}`} className="text-xs text-muted-foreground">Tipo de bloco</Label>
                      <Select
                        value={widget.widgetType}
                        onValueChange={(value) => {
                          if (!value) return
                          crm.updateTvWidget(widget.id, {
                            widgetType: value as 'kpi' | 'bar',
                          })
                        }}
                      >
                        <SelectTrigger id={`tv-type-${widget.id}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="kpi">Indicador (número grande)</SelectItem>
                          <SelectItem value="bar">Gráfico de barras (resumo)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2 sm:col-span-2">
                      <Label htmlFor={`tv-metric-${widget.id}`} className="text-xs text-muted-foreground">Métrica a mostrar</Label>
                      <Select
                        value={widget.metricKey}
                        onValueChange={(value) => {
                          if (!value) return
                          crm.updateTvWidget(widget.id, { metricKey: value })
                        }}
                      >
                        <SelectTrigger id={`tv-metric-${widget.id}`} className="w-full max-w-md">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {crm.metrics.some((m) => m.id === widget.metricKey) ? null : (
                            <SelectItem value={widget.metricKey}>Métrica atual</SelectItem>
                          )}
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
                        checked={widget.enabled}
                        onCheckedChange={(checked) => crm.updateTvWidget(widget.id, { enabled: checked })}
                      />
                      Mostrar este widget no painel
                    </Label>
                    <div className="sm:col-span-2">
                      <Label className="mb-2 block text-xs font-medium text-muted-foreground">Posição na tela</Label>
                      <WidgetLayoutEditor
                        layout={widget.layout ?? {}}
                        helpId={`tv-layout-help-${widget.id}`}
                        onLayoutChange={(next) => crm.updateTvWidget(widget.id, { layout: next })}
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => crm.moveTvWidget(widget.id, 'up')}>
                      Subir
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => crm.moveTvWidget(widget.id, 'down')}>
                      Descer
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => crm.removeTvWidget(widget.id)}>
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
