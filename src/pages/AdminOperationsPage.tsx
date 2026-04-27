import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

export function AdminOperationsPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="Operação Admin" subtitle="Gestão prática e governança comercial.">
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">Somente admin pode acessar esta página.</CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Operação Admin" subtitle="Atalhos rápidos para gestão completa e automações comerciais.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Kanban padrão</CardTitle>
            <CardDescription>Restaura/garante o pipeline padrão organizado.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              onClick={() => {
                crm.ensureStandardKanbanSetup()
                toast.success('Kanban padrão garantido.')
              }}
            >
              Garantir Kanban padrão
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Campanha de aniversário</CardTitle>
            <CardDescription>Gera tarefas e registro operacional para aniversariantes de hoje.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const count = crm.runBirthdayCampaign()
                toast.success(count > 0 ? `${count} lead(s) com aniversário processado(s).` : 'Nenhum aniversariante hoje.')
              }}
            >
              Rodar campanha agora
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Automações</CardTitle>
            <CardDescription>Regras de trigger e ação para escala comercial.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button type="button" size="sm" onClick={crm.addAutomationRule}>
              Nova automação
            </Button>
            {crm.automationRules.map((rule) => (
              <div key={rule.id} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Input value={rule.name} onChange={(e) => crm.updateAutomationRule(rule.id, { name: e.target.value })} />
                  <Switch checked={rule.enabled} onCheckedChange={(checked) => crm.updateAutomationRule(rule.id, { enabled: checked })} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Trigger</Label>
                    <Input value={rule.triggerType} onChange={(e) => crm.updateAutomationRule(rule.id, { triggerType: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">Ação</Label>
                    <Input value={rule.actionType} onChange={(e) => crm.updateAutomationRule(rule.id, { actionType: e.target.value })} />
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button type="button" size="sm" variant="destructive" onClick={() => crm.removeAutomationRule(rule.id)}>
                    Remover
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Governança e escala</CardTitle>
            <CardDescription>Visão rápida de auditoria e fila de integração.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="m-0 text-sm"><strong>Jobs webhook:</strong> {crm.queueJobs.length}</p>
            <p className="m-0 text-sm"><strong>Logs auditoria:</strong> {crm.auditTotal}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => void crm.refreshWebhookJobs()}>
                Atualizar fila
              </Button>
              <Button type="button" variant="outline" onClick={() => void crm.fetchAuditPage({ page: 0, pageSize: 20 })}>
                Carregar auditoria
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}

