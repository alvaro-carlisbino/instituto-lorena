import { useState } from 'react'
import { BarChart3Icon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { cn } from '@/lib/utils'

const UNIT_OPTIONS = [
  { value: 'count', label: 'Contagem' },
  { value: 'percent', label: 'Percentual' },
  { value: 'minutes', label: 'Minutos' },
] as const

const formatMetricValue = (value: number, unit: 'percent' | 'minutes' | 'count') => {
  if (unit === 'percent') return `${value}%`
  if (unit === 'minutes') return `${value} min`
  return String(value)
}

export function MetricsPage() {
  const crm = useCrm()
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null)

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    crm.removeMetric(deleteTarget.id)
    toast.success('Métrica removida com sucesso.')
    setDeleteTarget(null)
  }

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
    <AppLayout title="Métricas ajustáveis" subtitle="Metas e acompanhamento (cartões do painel).">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => { crm.addMetric(); toast.success('Métrica criada.') }}>
          Nova métrica
        </Button>
      </div>

      {crm.metrics.length === 0 ? (
        <EmptyState
          icon={BarChart3Icon}
          title="Nenhuma métrica configurada"
          description="Crie métricas para acompanhar a performance do time comercial."
        />
      ) : (
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
                  <div className="h-3 w-full overflow-hidden rounded-full bg-muted relative">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        performance >= 80 ? 'bg-success' : performance >= 50 ? 'bg-warning' : 'bg-destructive',
                      )}
                      style={{ width: `${Math.min(performance, 100)}%` }}
                    />
                    {performance > 15 && (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-foreground mix-blend-difference">
                        {performance}%
                      </span>
                    )}
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
                    <Select
                      value={metric.unit}
                      onValueChange={(value) =>
                        crm.updateMetric(metric.id, { unit: value as 'percent' | 'minutes' | 'count' })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-sm text-muted-foreground">Performance: {performance}% da meta</p>
                </CardContent>
                <CardFooter>
                  <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteTarget({ id: metric.id, label: metric.label })}>
                    <Trash2Icon className="size-4 mr-1" />
                    Remover métrica
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Remover métrica"
        description={`Tem certeza que deseja remover a métrica "${deleteTarget?.label ?? ''}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        onConfirm={handleConfirmDelete}
      />
    </AppLayout>
  )
}
