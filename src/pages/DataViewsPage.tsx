import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { columnLabel } from '@/lib/leadColumnLabels'
import { getLeadFieldValue } from '@/lib/leadFields'

const DEFAULT_COLUMNS = ['patient_name', 'phone', 'summary'] as const

export function DataViewsPage() {
  const crm = useCrm()
  const [selectedViewId, setSelectedViewId] = useState<string | null>(crm.dataViews[0]?.id ?? null)

  const columnCatalog = useMemo(() => {
    const keys = new Set<string>()
    for (const k of DEFAULT_COLUMNS) keys.add(k)
    keys.add('source')
    keys.add('temperature')
    keys.add('score')
    for (const f of crm.workflowFields) keys.add(f.fieldKey)
    return Array.from(keys)
  }, [crm.workflowFields])

  if (!crm.currentPermission.canEditBoards) {
    return (
      <AppLayout title="Visões">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Peça acesso de gestor ou administrador.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  const activeView = crm.dataViews.find((v) => v.id === selectedViewId) ?? crm.dataViews[0] ?? null
  const activeColumns = activeView?.config.columns?.length
    ? activeView.config.columns
    : [...DEFAULT_COLUMNS]

  const toggleColumn = (fieldKey: string, checked: boolean) => {
    if (!activeView) return
    const set = new Set(activeColumns)
    if (checked) set.add(fieldKey)
    else set.delete(fieldKey)
    const nextOrder = columnCatalog.filter((k) => set.has(k))
    if (nextOrder.length === 0) return
    crm.updateDataView(activeView.id, { config: { ...activeView.config, columns: nextOrder } })
  }

  return (
    <AppLayout title="Visões">
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
                    {activeColumns.map((col) => (
                      <th key={col} className="p-2 font-medium">
                        {columnLabel(col, crm.workflowFields)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {crm.leads.slice(0, 12).map((lead) => (
                    <tr key={lead.id} className="border-b border-border/80">
                      {activeColumns.map((col) => (
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
              <div className="mt-6 grid gap-4 border-t border-border/60 pt-4">
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">Colunas visíveis na tabela</Label>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
                    {columnCatalog.map((key) => (
                      <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-input"
                          checked={activeColumns.includes(key)}
                          onChange={(e) => toggleColumn(key, e.target.checked)}
                        />
                        <span>{columnLabel(key, crm.workflowFields)}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid max-w-md gap-2">
                  <Label>Ordenar por</Label>
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={activeView.config.sortField ?? ''}
                    onChange={(e) =>
                      crm.updateDataView(activeView.id, {
                        config: { ...activeView.config, sortField: e.target.value || undefined },
                      })
                    }
                  >
                    <option value="">(sem ordenação extra)</option>
                    {activeColumns.map((col) => (
                      <option key={col} value={col}>
                        {columnLabel(col, crm.workflowFields)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
