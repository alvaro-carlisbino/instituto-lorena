import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon, FolderKanbanIcon, MessageSquareHeart } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

export function BoardsPage() {
  const crm = useCrm()
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'pipeline' | 'stage'; id: string; pipelineId?: string; name?: string } | null>(null)
  const [automationTarget, setAutomationTarget] = useState<{ pipelineId: string; stageId: string; name: string } | null>(null)
  const [draftAutomation, setDraftAutomation] = useState({ enabled: false, template: '' })

  const handleOpenAutomation = (pipelineId: string, stageId: string, name: string, config: any) => {
    const automations = config.stageAutomations || {}
    const current = automations[stageId] || { enabled: false, template: '' }
    setDraftAutomation(current)
    setAutomationTarget({ pipelineId, stageId, name })
  }

  const handleSaveAutomation = () => {
    if (!automationTarget) return
    const pipeline = crm.pipelineCatalog.find(p => p.id === automationTarget.pipelineId)
    if (pipeline) {
      const bc = pipeline.boardConfig ?? {}
      const automations = { ...(bc.stageAutomations ?? {}) }
      automations[automationTarget.stageId] = draftAutomation
      
      crm.updatePipeline(pipeline.id, {
        boardConfig: { ...bc, stageAutomations: automations }
      })
      toast.success('Automação salva com sucesso.')
    }
    setAutomationTarget(null)
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    if (deleteTarget.type === 'pipeline') {
      crm.removePipeline(deleteTarget.id)
      toast.success('Funil removido com sucesso.')
    } else if (deleteTarget.pipelineId) {
      crm.removeStage(deleteTarget.pipelineId, deleteTarget.id)
      toast.success('Etapa removida com sucesso.')
    }
    setDeleteTarget(null)
  }

  if (!crm.currentPermission.canEditBoards) {
    return (
      <AppLayout title="Funis e etapas">
        <Card className="shadow-none border-border rounded-none bg-muted/10">
          <CardContent className="pt-6 text-sm font-semibold uppercase tracking-widest text-destructive">
            <p className="m-0">Seu perfil não tem privilégios de administrador de funil.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Funis e etapas">
      <div className="flex flex-wrap gap-2 mb-8">
        <Button type="button" onClick={() => { crm.addPipeline(); toast.success('Funil criado.') }} className="rounded-none uppercase tracking-widest font-bold">
          Novo pipeline
        </Button>
      </div>

      {crm.pipelineCatalog.length === 0 ? (
        <EmptyState
          icon={FolderKanbanIcon}
          title="Nenhum pipeline configurado"
          description="Crie um pipeline para definir as etapas do funil de vendas."
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          {crm.pipelineCatalog.map((pipeline) => {
            const bc = pipeline.boardConfig ?? {}
            return (
              <Card key={pipeline.id} className="shadow-none rounded-none border border-border bg-card">
                <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 bg-muted/10 pb-4">
                  <Input
                    value={pipeline.name}
                    onChange={(event) => crm.updatePipeline(pipeline.id, { name: event.target.value })}
                    className="max-w-md font-bold uppercase tracking-widest rounded-none border-foreground/20 bg-background"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" className="rounded-none uppercase tracking-widest font-semibold" onClick={() => { crm.addStageToPipeline(pipeline.id); toast.success('Etapa adicionada.') }}>
                      Nova etapa
                    </Button>
                    <Button type="button" variant="destructive" size="sm" className="rounded-none uppercase tracking-widest font-semibold" onClick={() => setDeleteTarget({ type: 'pipeline', id: pipeline.id, name: pipeline.name })}>
                      Remover
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6 pt-6">
                  <div className="grid gap-2">
                    <Label className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">Ordem dos campos no quadro (nomes separados por vírgula)</Label>
                    <Input
                      className="font-mono text-xs rounded-none bg-muted/5 border-foreground/20"
                      defaultValue={(bc.kanbanFieldOrder ?? []).join(', ')}
                      onBlur={(event) => {
                        const keys = event.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean)
                        crm.updatePipeline(pipeline.id, {
                          boardConfig: { ...bc, kanbanFieldOrder: keys },
                        })
                        toast.success('Ordem dos campos atualizada.')
                      }}
                    />
                  </div>
                  <ul className="divide-y divide-border border-t border-border mt-4">
                    {pipeline.stages.map((stage) => (
                      <li key={stage.id} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between hover:bg-muted/5 px-2 -mx-2 transition-colors">
                        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                          <Input
                            value={stage.name}
                            onChange={(event) => crm.updateStage(pipeline.id, stage.id, { name: event.target.value })}
                            className="max-w-sm rounded-none border-t-0 border-r-0 border-l-0 border-b border-foreground/30 bg-transparent focus-visible:ring-0 focus-visible:border-primary px-0 font-bold tracking-wide uppercase text-sm"
                          />
                          <div className="flex items-center gap-2">
                            <Label className="m-0 shrink-0 text-[10px] uppercase font-bold tracking-widest text-muted-foreground">Prazo (min)</Label>
                            <Input
                              type="number"
                              min={1}
                              className="w-20 rounded-none font-mono text-xs text-center border-border/50"
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
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <Button 
                            type="button" 
                            variant={bc.stageAutomations?.[stage.id]?.enabled ? "default" : "outline"} 
                            size="sm" 
                            className="rounded-none h-8 px-3 text-xs font-bold gap-1"
                            onClick={() => handleOpenAutomation(pipeline.id, stage.id, stage.name, bc)}
                          >
                            <MessageSquareHeart className="w-3.5 h-3.5" />
                            {bc.stageAutomations?.[stage.id]?.enabled ? 'Automação Ativa' : 'Automação'}
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="rounded-none h-8 px-3" onClick={() => crm.moveStage(pipeline.id, stage.id, 'up')}>
                            <ChevronUpIcon className="size-4" />
                          </Button>
                          <Button type="button" variant="outline" size="sm" className="rounded-none h-8 px-3" onClick={() => crm.moveStage(pipeline.id, stage.id, 'down')}>
                            <ChevronDownIcon className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="rounded-none text-[10px] uppercase tracking-widest font-bold h-8"
                            onClick={() => setDeleteTarget({ type: 'stage', id: stage.id, pipelineId: pipeline.id, name: stage.name })}
                          >
                            Remover
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={deleteTarget?.type === 'pipeline' ? 'Remover pipeline' : 'Remover etapa'}
        description={`Tem certeza que deseja remover "${deleteTarget?.name ?? ''}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        onConfirm={handleConfirmDelete}
      />

      {/* Automation Config Dialog */}
      <Dialog open={automationTarget !== null} onOpenChange={(open) => !open && setAutomationTarget(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Automação: {automationTarget?.name}</DialogTitle>
            <DialogDescription>
              Configure uma mensagem automática que será enviada via WhatsApp assim que um Lead for movido para esta etapa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                id="auto-enabled"
                checked={draftAutomation.enabled}
                onChange={(e) => setDraftAutomation({ ...draftAutomation, enabled: e.target.checked })}
              />
              <Label htmlFor="auto-enabled" className="text-sm cursor-pointer">Ativar disparo automático de mensagem</Label>
            </div>
            
            <div className="space-y-2">
              <Label>Template da Mensagem</Label>
              <Textarea 
                value={draftAutomation.template}
                onChange={(e) => setDraftAutomation({ ...draftAutomation, template: e.target.value })}
                placeholder="Ex: Olá {{nome}}, sua consulta está agendada!"
                className="min-h-[120px]"
                disabled={!draftAutomation.enabled}
              />
              <p className="text-[10px] text-muted-foreground">Variáveis disponíveis: {'{{nome}}, {{telefone}}'}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAutomationTarget(null)}>Cancelar</Button>
            <Button onClick={handleSaveAutomation}>Salvar Automação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
