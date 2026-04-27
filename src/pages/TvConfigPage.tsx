import { WidgetLayoutEditor } from '@/components/config/WidgetLayoutEditor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

export function TvConfigPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canViewTvPanel) {
    return (
      <AppLayout title="Configuração da tela TV" subtitle="Sem permissão para o painel TV.">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Seu perfil não pode configurar o painel de TV.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Configuração da tela TV"
      subtitle="O que a TV mostra: widgets e ordem, só com formulário."
    >
      <Card className="mb-4 border-border/80 shadow-sm">
        <CardContent className="pt-4 text-sm text-muted-foreground">
          <CardDescription className="text-sm leading-relaxed text-muted-foreground">
            O painel organiza os blocos em uma grade de 12 colunas. A posição de cada bloco é definida pela coluna, linha e largura.
          </CardDescription>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={crm.addTvWidget}>
          Novo widget
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {crm.tvWidgets
              .sort((a, b) => a.position - b.position)
              .map((widget) => (
                <li key={widget.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label className="text-xs text-muted-foreground">Título no painel</Label>
                      <Input
                        value={widget.title}
                        onChange={(event) => crm.updateTvWidget(widget.id, { title: event.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-xs text-muted-foreground">Tipo de bloco</Label>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={widget.widgetType}
                        onChange={(event) =>
                          crm.updateTvWidget(widget.id, {
                            widgetType: event.target.value as 'kpi' | 'bar',
                          })
                        }
                      >
                        <option value="kpi">Indicador (número grande)</option>
                        <option value="bar">Gráfico de barras (resumo)</option>
                      </select>
                    </div>
                    <div className="grid gap-2 sm:col-span-2">
                      <Label className="text-xs text-muted-foreground">Métrica a mostrar</Label>
                      <select
                        className="h-9 max-w-md rounded-md border border-input bg-background px-2 text-sm"
                        value={widget.metricKey}
                        onChange={(event) => crm.updateTvWidget(widget.id, { metricKey: event.target.value })}
                      >
                        {crm.metrics.some((m) => m.id === widget.metricKey) ? null : (
                          <option value={widget.metricKey}>Métrica atual</option>
                        )}
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
                        checked={widget.enabled}
                        onChange={(event) => crm.updateTvWidget(widget.id, { enabled: event.target.checked })}
                      />
                      Mostrar este widget no painel
                    </label>
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
        </CardContent>
      </Card>
    </AppLayout>
  )
}
