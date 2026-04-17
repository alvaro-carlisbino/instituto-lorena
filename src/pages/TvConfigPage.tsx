import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
    <AppLayout title="Configuração da tela TV" subtitle="Defina widgets, ordem e o que aparece no painel de TV.">
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
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <Input
                      value={widget.title}
                      onChange={(event) => crm.updateTvWidget(widget.id, { title: event.target.value })}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                        value={widget.widgetType}
                        onChange={(event) =>
                          crm.updateTvWidget(widget.id, {
                            widgetType: event.target.value as 'kpi' | 'bar',
                          })
                        }
                      >
                        <option value="kpi">kpi</option>
                        <option value="bar">bar</option>
                      </select>
                      <Input
                        value={widget.metricKey}
                        onChange={(event) => crm.updateTvWidget(widget.id, { metricKey: event.target.value })}
                        placeholder="Métrica"
                        className="max-w-[10rem]"
                      />
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-input"
                          checked={widget.enabled}
                          onChange={(event) => crm.updateTvWidget(widget.id, { enabled: event.target.checked })}
                        />
                        Ativo
                      </label>
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
