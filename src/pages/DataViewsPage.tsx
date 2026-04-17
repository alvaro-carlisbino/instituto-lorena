import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { getLeadFieldValue } from '@/lib/leadFields'

export function DataViewsPage() {
  const crm = useCrm()
  const [selectedViewId, setSelectedViewId] = useState<string | null>(crm.dataViews[0]?.id ?? null)

  if (!crm.currentPermission.canEditBoards) {
    return (
      <AppLayout title="Visões de dados" subtitle="Sem permissão para editar visões salvas.">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Peça acesso de gestor ou administrador.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  const activeView = crm.dataViews.find((v) => v.id === selectedViewId) ?? crm.dataViews[0] ?? null

  return (
    <AppLayout title="Visões de dados" subtitle="Tabelas configuráveis por colunas de campo (MVP).">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={crm.addDataView}>
          Nova visão
        </Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Visões salvas</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {crm.dataViews.map((view) => (
              <div
                key={view.id}
                className={`flex flex-col gap-2 rounded-md border p-2 ${selectedViewId === view.id ? 'border-primary bg-primary/5' : 'border-border'}`}
              >
                <button
                  type="button"
                  className="text-left text-xs text-muted-foreground"
                  onClick={() => setSelectedViewId(view.id)}
                >
                  Selecionar
                </button>
                <Input
                  value={view.name}
                  onChange={(e) => crm.updateDataView(view.id, { name: e.target.value })}
                  className="text-sm font-medium"
                />
                <Button type="button" variant="destructive" size="sm" onClick={() => crm.removeDataView(view.id)}>
                  Excluir
                </Button>
              </div>
            ))}
            {crm.dataViews.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma visão ainda.</p> : null}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Pré-visualização</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {activeView ? (
              <table className="w-full min-w-[28rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {(activeView.config.columns ?? ['patient_name', 'phone', 'summary']).map((col) => (
                      <th key={col} className="p-2 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {crm.leads.slice(0, 12).map((lead) => (
                    <tr key={lead.id} className="border-b border-border/80">
                      {(activeView.config.columns ?? ['patient_name', 'phone', 'summary']).map((col) => (
                        <td key={col} className="p-2 text-muted-foreground">
                          {String(getLeadFieldValue(lead, col) ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground">Crie uma visão para ver a tabela.</p>
            )}
            {activeView ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label>Colunas (vírgula)</Label>
                  <Input
                    className="font-mono text-xs"
                    defaultValue={(activeView.config.columns ?? []).join(', ')}
                    onBlur={(e) => {
                      const columns = e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean)
                      crm.updateDataView(activeView.id, { config: { ...activeView.config, columns } })
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <Label>Ordenar por campo</Label>
                  <Input
                    className="font-mono text-xs"
                    value={activeView.config.sortField ?? ''}
                    onChange={(e) =>
                      crm.updateDataView(activeView.id, {
                        config: { ...activeView.config, sortField: e.target.value || undefined },
                      })
                    }
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
