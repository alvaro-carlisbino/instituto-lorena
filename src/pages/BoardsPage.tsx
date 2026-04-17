import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
        {crm.pipelineCatalog.map((pipeline) => (
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
            <CardContent>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {pipeline.stages.map((stage) => (
                  <li key={stage.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <Input
                      value={stage.name}
                      onChange={(event) => crm.updateStage(pipeline.id, stage.id, { name: event.target.value })}
                      className="max-w-sm"
                    />
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
        ))}
      </div>
    </AppLayout>
  )
}
