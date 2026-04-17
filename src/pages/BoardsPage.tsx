import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'

export function BoardsPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canEditBoards) {
    return (
      <AppLayout title="Boards e Pipelines" subtitle="Sem permissao para editar boards com o papel atual.">
        <section className="panel">
          <p>Seu perfil nao possui permissao para alterar pipelines e etapas.</p>
        </section>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Boards e Pipelines" subtitle="Configure funis, etapas e regras de movimentacao do kanban.">
      <section className="panel toolbar">
        <button className="primary" onClick={crm.addPipeline}>
          Novo pipeline
        </button>
      </section>

      <section className="panel-grid two-col">
        {crm.pipelineCatalog.map((pipeline) => (
          <article key={pipeline.id} className="panel">
            <header>
              <input
                value={pipeline.name}
                onChange={(event) => crm.updatePipeline(pipeline.id, { name: event.target.value })}
              />
              <div className="inline-actions">
                <button onClick={() => crm.addStageToPipeline(pipeline.id)}>Nova etapa</button>
                <button className="danger" onClick={() => crm.removePipeline(pipeline.id)}>
                  Remover
                </button>
              </div>
            </header>

            <ul className="editable-list">
              {pipeline.stages.map((stage) => (
                <li key={stage.id}>
                  <input
                    value={stage.name}
                    onChange={(event) => crm.updateStage(pipeline.id, stage.id, { name: event.target.value })}
                  />
                  <div className="inline-actions">
                    <button onClick={() => crm.moveStage(pipeline.id, stage.id, 'up')}>Subir</button>
                    <button onClick={() => crm.moveStage(pipeline.id, stage.id, 'down')}>Descer</button>
                    <button className="danger" onClick={() => crm.removeStage(pipeline.id, stage.id)}>
                      Excluir etapa
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </AppLayout>
  )
}
