import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

export function BoardsPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canEditBoards) {
    return (
      <AppLayout title="Boards e pipelines" subtitle="Sem permissão para editar boards com o papel atual.">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Seu perfil não pode alterar pipelines e etapas.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Boards e pipelines" subtitle="Configure funis, etapas e regras de movimentação do kanban.">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={crm.addPipeline}>
          Novo pipeline
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {crm.pipelineCatalog.map((pipeline) => {
          const bc = pipeline.boardConfig ?? {}
          return (
          <Card key={pipeline.id} className="shadow-sm">
            <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <Input
                value={pipeline.name}
                onChange={(event) => crm.updatePipeline(pipeline.id, { name: event.target.value })}
                className="max-w-md font-semibold"
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => crm.addStageToPipeline(pipeline.id)}>
                  Nova etapa
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={() => crm.removePipeline(pipeline.id)}>
                  Remover
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">Ordem dos campos no Kanban (chaves separadas por vírgula)</Label>
                <Input
                  className="font-mono text-sm"
                  defaultValue={(bc.kanbanFieldOrder ?? []).join(', ')}
                  onBlur={(event) => {
                    const keys = event.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                    crm.updatePipeline(pipeline.id, {
                      boardConfig: { ...bc, kanbanFieldOrder: keys },
                    })
                  }}
                />
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {pipeline.stages.map((stage) => (
                  <li key={stage.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        value={stage.name}
                        onChange={(event) => crm.updateStage(pipeline.id, stage.id, { name: event.target.value })}
                        className="max-w-sm"
                      />
                      <div className="flex items-center gap-2">
                        <Label className="m-0 shrink-0 text-xs text-muted-foreground">SLA (min)</Label>
                        <Input
                          type="number"
                          min={1}
                          className="w-24"
                          value={bc.stageSlaMinutes?.[stage.id] ?? ''}
                          onChange={(event) => {
                            const v = event.target.value === '' ? undefined : Number(event.target.value)
                            const nextSla = { ...(bc.stageSlaMinutes ?? {}) }
                            if (v === undefined || Number.isNaN(v)) delete nextSla[stage.id]
                            else nextSla[stage.id] = v
                            crm.updatePipeline(pipeline.id, {
                              boardConfig: { ...bc, stageSlaMinutes: nextSla },
                            })
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => crm.moveStage(pipeline.id, stage.id, 'up')}>
                        Subir
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => crm.moveStage(pipeline.id, stage.id, 'down')}>
                        Descer
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => crm.removeStage(pipeline.id, stage.id)}
                      >
                        Excluir etapa
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )})}
      </div>
    </AppLayout>
  )
}
