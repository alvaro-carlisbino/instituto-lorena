import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

export function AdminOperationsPage() {
  const crm = useCrm()
  const [isRefreshingQueue, setIsRefreshingQueue] = useState(false)
  const [isRefreshingAudit, setIsRefreshingAudit] = useState(false)

  const handleAddAutomation = () => {
    crm.addAutomationRule()
    toast.success('Nova automação criada.')
  }

  const handleRemoveAutomation = (id: string) => {
    crm.removeAutomationRule(id)
    toast.success('Automação removida.')
  }

  const handleRefreshQueue = async () => {
    setIsRefreshingQueue(true)
    try {
      await crm.refreshWebhookJobs()
      toast.success('Fila atualizada com sucesso.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar a fila.')
    } finally {
      setIsRefreshingQueue(false)
    }
  }

  const handleRefreshAudit = async () => {
    setIsRefreshingAudit(true)
    try {
      await crm.fetchAuditPage({ page: 0, pageSize: 20 })
      toast.success('Auditoria carregada com sucesso.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar a auditoria.')
    } finally {
      setIsRefreshingAudit(false)
    }
  }

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="Operação Admin">
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">Somente admin pode acessar esta página.</CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Operação Admin">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Kanban padrão</CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              className="rounded-xl"
              onClick={() => {
                crm.ensureStandardKanbanSetup()
                toast.success('Kanban padrão garantido.')
              }}
            >
              Garantir Kanban padrão
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Campanha de aniversário</CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-border/70 transition-all duration-200 hover:-translate-y-0.5"
              onClick={() => {
                const count = crm.runBirthdayCampaign()
                toast.success(count > 0 ? `${count} lead(s) com aniversário processado(s).` : 'Nenhum aniversariante hoje.')
              }}
            >
              Rodar campanha agora
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Automações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button type="button" size="sm" className="rounded-lg" onClick={handleAddAutomation}>
              Nova automação
            </Button>
            {crm.automationRules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 text-center">
                <p className="m-0 text-sm font-medium text-foreground">Nenhuma automação criada</p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">Clique em "Nova automação" para começar.</p>
              </div>
            ) : null}
            {crm.automationRules.map((rule) => (
              <div key={rule.id} className="rounded-xl border border-border/70 bg-background/70 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm">
                <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Input
                    className="min-w-0 flex-1 rounded-lg border-border/70"
                    value={rule.name}
                    onChange={(e) => crm.updateAutomationRule(rule.id, { name: e.target.value })}
                  />
                  <Switch
                    className="shrink-0 sm:mt-0"
                    checked={rule.enabled}
                    onCheckedChange={(checked) => crm.updateAutomationRule(rule.id, { enabled: checked })}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Quando acontece</Label>
                    <Input className="rounded-lg border-border/70" value={rule.triggerType} onChange={(e) => crm.updateAutomationRule(rule.id, { triggerType: e.target.value })} placeholder="Ex.: entrou em contato" />
                  </div>
                  <div>
                    <Label className="text-xs">O que fazer</Label>
                    <Input className="rounded-lg border-border/70" value={rule.actionType} onChange={(e) => crm.updateAutomationRule(rule.id, { actionType: e.target.value })} placeholder="Ex.: criar tarefa para atendente" />
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button type="button" size="sm" variant="destructive" onClick={() => handleRemoveAutomation(rule.id)}>
                    Remover
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Governança e escala</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="m-0 text-sm"><strong>Mensagens em processamento:</strong> {crm.queueJobs.length}</p>
            <p className="m-0 text-sm"><strong>Registros de atividade:</strong> {crm.auditTotal}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={isRefreshingQueue} onClick={() => void handleRefreshQueue()}>
                {isRefreshingQueue ? 'Atualizando fila...' : 'Atualizar fila'}
              </Button>
              <Button type="button" variant="outline" disabled={isRefreshingAudit} onClick={() => void handleRefreshAudit()}>
                {isRefreshingAudit ? 'Carregando auditoria...' : 'Carregar auditoria'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}

