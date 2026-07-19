import { useMemo, useState } from 'react'
import { Table2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { columnLabel } from '@/lib/leadColumnLabels'
import { getLeadFieldValue } from '@/lib/leadFields'

const DEFAULT_COLUMNS = ['patient_name', 'phone', 'summary'] as const

const SORT_NONE = '__none__'

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
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" className="w-full sm:w-auto" onClick={crm.addDataView}>
          Nova visão
        </Button>
      </div>

      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
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
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="w-fit justify-start px-1 text-xs font-normal text-muted-foreground"
                  aria-pressed={selectedViewId === view.id}
                  onClick={() => setSelectedViewId(view.id)}
                >
                  Selecionar
                </Button>
                <Input
                  value={view.name}
                  onChange={(e) => crm.updateDataView(view.id, { name: e.target.value })}
                  aria-label="Nome da visão"
                  className="text-sm font-medium"
                />
                <Button type="button" variant="destructive" size="sm" onClick={() => crm.removeDataView(view.id)}>
                  Excluir
                </Button>
              </div>
            ))}
            {crm.dataViews.length === 0 ? (
              <EmptyState
                icon={Table2Icon}
                title="Nenhuma visão ainda"
                description='Clique em "Nova visão" para criar a primeira.'
                className="py-6"
              />
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Pré-visualização</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 overflow-x-auto">
            {activeView ? (
              <Table className="w-full min-w-[28rem] border-collapse text-sm">
                <TableHeader>
                  <TableRow className="border-b border-border text-left">
                    {activeColumns.map((col) => (
                      <TableHead key={col} className="p-2 font-medium">
                        {columnLabel(col, crm.workflowFields)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {crm.leads.slice(0, 12).map((lead) => (
                    <TableRow key={lead.id} className="border-b border-border/80">
                      {activeColumns.map((col) => (
                        <TableCell key={col} className="p-2 text-muted-foreground">
                          {String(getLeadFieldValue(lead, col) ?? '')}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={Table2Icon}
                title="Nenhuma visão selecionada"
                description="Crie uma visão para ver a tabela."
                className="py-6"
              />
            )}
            {activeView ? (
              <div className="mt-6 grid gap-4 border-t border-border/60 pt-4">
                <div className="grid gap-2">
                  <Label className="text-sm font-medium">Colunas visíveis na tabela</Label>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
                    {columnCatalog.map((key) => (
                      <Label key={key} className="cursor-pointer text-sm font-normal">
                        <Checkbox
                          checked={activeColumns.includes(key)}
                          onCheckedChange={(checked) => toggleColumn(key, checked)}
                        />
                        <span>{columnLabel(key, crm.workflowFields)}</span>
                      </Label>
                    ))}
                  </div>
                </div>
                <div className="grid max-w-md gap-2">
                  <Label htmlFor="dataview-sort">Ordenar por</Label>
                  <Select
                    value={activeView.config.sortField ?? SORT_NONE}
                    onValueChange={(value) => {
                      if (!value) return
                      crm.updateDataView(activeView.id, {
                        config: { ...activeView.config, sortField: value === SORT_NONE ? undefined : value },
                      })
                    }}
                  >
                    <SelectTrigger id="dataview-sort" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SORT_NONE}>(sem ordenação extra)</SelectItem>
                      {activeColumns.map((col) => (
                        <SelectItem key={col} value={col}>
                          {columnLabel(col, crm.workflowFields)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
