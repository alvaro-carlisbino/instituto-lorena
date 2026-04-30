import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical,
  MessageSquareHeart,
  Trash2,
  Clock,
} from 'lucide-react'
import { toast } from 'sonner'

import { HelpDrawer } from '@/components/page/HelpDrawer'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import type { Pipeline, Stage } from '@/mocks/crmMock'

const BOARDS_HELP = [
  {
    icon: '🔀',
    title: 'O que é um funil?',
    content: (
      <p>
        Um funil representa uma jornada do lead — por exemplo, "Consulta Inicial" ou "Cirurgia".
        Cada funil tem etapas que mostram em que fase o paciente está.
      </p>
    ),
  },
  {
    icon: '📋',
    title: 'O que é uma etapa?',
    content: (
      <p>
        Etapas são as fases dentro do funil: "Novo contato", "Agendado", "Atendido". 
        Arraste as etapas para reordenar. O lead avança de etapa conforme o atendimento progride.
      </p>
    ),
  },
  {
    icon: '⚡',
    title: 'Automações de mensagem',
    content: (
      <p>
        Configure uma mensagem automática de WhatsApp que é enviada assim que um lead 
        entra em determinada etapa. Ideal para confirmações de agenda ou boas-vindas.
      </p>
    ),
  },
  {
    icon: '⏱️',
    title: 'Prazo (SLA)',
    content: (
      <p>
        O prazo em minutos indica quanto tempo o lead pode ficar nessa etapa antes 
        de ser marcado como atrasado no quadro. Deixe em branco para sem prazo.
      </p>
    ),
  },
]

// ─── Sortable Stage Row ────────────────────────────────────────────────────────

type SortableStageRowProps = {
  stage: Stage
  pipeline: Pipeline
  bc: Record<string, unknown>
  onDelete: () => void
  onOpenAutomation: () => void
}

function SortableStageRow({
  stage,
  pipeline,
  bc,
  onDelete,
  onOpenAutomation,
}: SortableStageRowProps) {
  const crm = useCrm()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const boardConfig = bc as {
    stageSlaMinutes?: Record<string, number>
    stageAutomations?: Record<string, { enabled: boolean; template: string }>
  }

  const hasAutomation = boardConfig.stageAutomations?.[stage.id]?.enabled

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between hover:bg-muted/5 px-2 -mx-2 transition-colors rounded-lg"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground touch-none shrink-0"
          aria-label="Arrastar para reordenar"
        >
          <GripVertical className="size-4" />
        </button>

        <Input
          value={stage.name}
          onChange={(e) =>
            crm.updateStage(pipeline.id, stage.id, { name: e.target.value })
          }
          className="max-w-sm border-t-0 border-r-0 border-l-0 border-b border-foreground/30 bg-transparent focus-visible:ring-0 focus-visible:border-primary px-0 font-semibold tracking-wide text-sm rounded-none"
        />

        {/* SLA badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Clock className="size-3.5 text-muted-foreground/60" />
          <Input
            type="number"
            min={1}
            className="w-20 text-xs text-center border-border/50 h-7"
            placeholder="∞ min"
            value={boardConfig.stageSlaMinutes?.[stage.id] ?? ''}
            onChange={(e) => {
              const v =
                e.target.value === '' ? undefined : Number(e.target.value)
              const nextSla = { ...(boardConfig.stageSlaMinutes ?? {}) }
              if (v === undefined || Number.isNaN(v)) delete nextSla[stage.id]
              else nextSla[stage.id] = v
              crm.updatePipeline(pipeline.id, {
                boardConfig: {
                  ...(pipeline.boardConfig ?? {}),
                  stageSlaMinutes: nextSla,
                },
              })
            }}
          />
          <span className="text-[10px] text-muted-foreground">min</span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 pl-7 sm:pl-0">
        <Button
          type="button"
          variant={hasAutomation ? 'default' : 'outline'}
          size="sm"
          className="h-8 px-3 text-xs font-medium gap-1.5"
          onClick={onOpenAutomation}
        >
          <MessageSquareHeart className="size-3.5" />
          {hasAutomation ? 'Automação ativa' : 'Automação'}
          {hasAutomation && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              ON
            </Badge>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-destructive/60 hover:text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          aria-label="Remover etapa"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function BoardsPage() {
  const crm = useCrm()
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'pipeline' | 'stage'
    id: string
    pipelineId?: string
    name?: string
  } | null>(null)
  const [automationTarget, setAutomationTarget] = useState<{
    pipelineId: string
    stageId: string
    name: string
  } | null>(null)
  const [draftAutomation, setDraftAutomation] = useState({
    enabled: false,
    template: '',
  })

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleOpenAutomation = (
    pipelineId: string,
    stageId: string,
    name: string,
    config: Record<string, unknown>,
  ) => {
    const automations =
      (config.stageAutomations as Record<
        string,
        { enabled: boolean; template: string }
      >) ?? {}
    const current = automations[stageId] ?? { enabled: false, template: '' }
    setDraftAutomation(current)
    setAutomationTarget({ pipelineId, stageId, name })
  }

  const handleSaveAutomation = () => {
    if (!automationTarget) return
    const pipeline = crm.pipelineCatalog.find(
      (p) => p.id === automationTarget.pipelineId,
    )
    if (pipeline) {
      const bc = pipeline.boardConfig ?? {}
      const automations = {
        ...((bc.stageAutomations as Record<
          string,
          { enabled: boolean; template: string }
        >) ?? {}),
      }
      automations[automationTarget.stageId] = draftAutomation
      crm.updatePipeline(pipeline.id, {
        boardConfig: { ...bc, stageAutomations: automations },
      })
      toast.success('Automação salva com sucesso.')
    }
    setAutomationTarget(null)
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    if (deleteTarget.type === 'pipeline') {
      crm.removePipeline(deleteTarget.id)
      toast.success('Funil removido.')
    } else if (deleteTarget.pipelineId) {
      crm.removeStage(deleteTarget.pipelineId, deleteTarget.id)
      toast.success('Etapa removida.')
    }
    setDeleteTarget(null)
  }

  const handleStageDragEnd = (
    event: DragEndEvent,
    pipeline: Pipeline,
  ) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const stages = pipeline.stages
    const oldIndex = stages.findIndex((s) => s.id === active.id)
    const newIndex = stages.findIndex((s) => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(stages, oldIndex, newIndex)
    crm.updatePipeline(pipeline.id, { stages: reordered })
  }

  if (!crm.currentPermission.canEditBoards) {
    return (
      <AppLayout title="Funis e etapas">
        <Card className="shadow-none border-border rounded-xl bg-muted/10">
          <CardContent className="pt-6 text-sm font-semibold text-destructive">
            <p className="m-0">
              Seu perfil não tem permissão para editar funis. Fale com o
              administrador.
            </p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Funis e etapas"
      actions={<HelpDrawer title="Como configurar funis" sections={BOARDS_HELP} />}
    >
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Button
          type="button"
          onClick={() => {
            crm.addPipeline()
            toast.success('Novo funil criado.')
          }}
        >
          + Novo funil
        </Button>
        <p className="text-xs text-muted-foreground">
          Arraste as etapas para reordenar.
        </p>
      </div>

      {crm.pipelineCatalog.length === 0 ? (
        <EmptyState
          icon={MessageSquareHeart}
          title="Nenhum funil configurado"
          description="Crie um funil para definir as etapas do atendimento aos pacientes."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {crm.pipelineCatalog.map((pipeline) => {
            const bc = (pipeline.boardConfig ?? {}) as Record<string, unknown>
            return (
              <Card
                key={pipeline.id}
                className="shadow-none border border-border bg-card"
              >
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 bg-muted/5 pb-4 rounded-t-xl">
                  <div className="flex-1 min-w-0">
                    <Label className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground mb-1 block">
                      Nome do funil
                    </Label>
                    <Input
                      value={pipeline.name}
                      onChange={(e) =>
                        crm.updatePipeline(pipeline.id, { name: e.target.value })
                      }
                      className="max-w-xs font-semibold text-base border-foreground/20 bg-background"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        crm.addStageToPipeline(pipeline.id)
                        toast.success('Etapa adicionada.')
                      }}
                    >
                      + Etapa
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                      onClick={() =>
                        setDeleteTarget({
                          type: 'pipeline',
                          id: pipeline.id,
                          name: pipeline.name,
                        })
                      }
                    >
                      <Trash2 className="size-4 mr-1" />
                      Remover funil
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="pt-4 pb-5">
                  {pipeline.stages.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Nenhuma etapa ainda. Clique em "+ Etapa" para começar.
                    </p>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(event) =>
                        handleStageDragEnd(event, pipeline)
                      }
                    >
                      <SortableContext
                        items={pipeline.stages.map((s) => s.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <ul className="divide-y divide-border/50 list-none m-0 p-0">
                          {pipeline.stages.map((stage) => (
                            <SortableStageRow
                              key={stage.id}
                              stage={stage}
                              pipeline={pipeline}
                              bc={bc}
                              onDelete={() =>
                                setDeleteTarget({
                                  type: 'stage',
                                  id: stage.id,
                                  pipelineId: pipeline.id,
                                  name: stage.name,
                                })
                              }
                              onOpenAutomation={() =>
                                handleOpenAutomation(
                                  pipeline.id,
                                  stage.id,
                                  stage.name,
                                  bc,
                                )
                              }
                            />
                          ))}
                        </ul>
                      </SortableContext>
                    </DndContext>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={
          deleteTarget?.type === 'pipeline'
            ? 'Remover funil?'
            : 'Remover etapa?'
        }
        description={`Tem certeza que deseja remover "${deleteTarget?.name ?? ''}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Sim, remover"
        onConfirm={handleConfirmDelete}
      />

      {/* Automation Dialog */}
      <Dialog
        open={automationTarget !== null}
        onOpenChange={(open) => !open && setAutomationTarget(null)}
      >
        <DialogContent className="max-h-[min(92dvh,calc(100dvh-2rem))] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              ⚡ Automação: {automationTarget?.name}
            </DialogTitle>
            <DialogDescription>
              Configure uma mensagem automática de WhatsApp enviada quando um
              lead entrar nesta etapa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/10 p-3">
              <Switch
                id="auto-enabled"
                checked={draftAutomation.enabled}
                onCheckedChange={(checked) =>
                  setDraftAutomation({ ...draftAutomation, enabled: checked })
                }
              />
              <Label htmlFor="auto-enabled" className="cursor-pointer text-sm font-medium">
                Ativar mensagem automática ao entrar nesta etapa
              </Label>
            </div>

            <div className="space-y-2">
              <Label>Mensagem</Label>
              <Textarea
                value={draftAutomation.template}
                onChange={(e) =>
                  setDraftAutomation({
                    ...draftAutomation,
                    template: e.target.value,
                  })
                }
                placeholder="Ex: Olá {{nome}}, sua consulta está confirmada! 😊"
                className="min-h-[min(7.5rem,28dvh)] sm:min-h-[120px]"
                disabled={!draftAutomation.enabled}
              />
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-bold text-muted-foreground/60">Inserir variáveis</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Nome Completo', value: '{{nome}}' },
                    { label: 'Primeiro Nome', value: '{{primeiro_nome}}' },
                    { label: 'Telefone', value: '{{telefone}}' },
                    { label: 'Link de Agendamento', value: '{{link_agendamento}}' },
                  ].map((v) => (
                    <Button
                      key={v.value}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] bg-muted/30 hover:bg-primary/10 hover:text-primary transition-colors border-dashed"
                      onClick={() =>
                        setDraftAutomation({
                          ...draftAutomation,
                          template: draftAutomation.template + v.value,
                        })
                      }
                    >
                      + {v.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutomationTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveAutomation}>Salvar automação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
