import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

const formatMetricValue = (value: number, unit: 'percent' | 'minutes' | 'count') => {
  if (unit === 'percent') return `${value}%`
  if (unit === 'minutes') return `${value} min`
  return String(value)
}

export function MetricsPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Métricas ajustáveis" subtitle="Sem permissão para editar métricas no perfil atual.">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Visualização liberada; edição de metas não está disponível para este perfil.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Métricas ajustáveis" subtitle="Defina metas e acompanhe performance em tempo real.">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={crm.addMetric}>
          Nova métrica
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {crm.metrics.map((metric) => {
          const performance = metric.target > 0 ? Math.round((metric.value / metric.target) * 100) : 0

          return (
            <Card key={metric.id} className="shadow-sm">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <Input
                  value={metric.label}
                  onChange={(event) => crm.updateMetric(metric.id, { label: event.target.value })}
                  className="max-w-[14rem] font-medium"
                />
                <span className="text-lg font-semibold tabular-nums">{formatMetricValue(metric.value, metric.unit)}</span>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(performance, 100)}%` }}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Valor atual</Label>
                    <Input
                      type="number"
                      value={metric.value}
                      onChange={(event) => crm.updateMetric(metric.id, { value: Number(event.target.value) })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Meta</Label>
                    <Input
                      type="number"
                      value={metric.target}
                      onChange={(event) => crm.updateMetric(metric.id, { target: Number(event.target.value) })}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Unidade</Label>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    value={metric.unit}
                    onChange={(event) =>
                      crm.updateMetric(metric.id, { unit: event.target.value as 'percent' | 'minutes' | 'count' })
                    }
                  >
                    <option value="count">count</option>
                    <option value="percent">percent</option>
                    <option value="minutes">minutes</option>
                  </select>
                </div>
                <p className="text-sm text-muted-foreground">Performance: {performance}% da meta</p>
              </CardContent>
              <CardFooter>
                <Button type="button" variant="destructive" size="sm" onClick={() => crm.removeMetric(metric.id)}>
                  Remover métrica
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </AppLayout>
  )
}
