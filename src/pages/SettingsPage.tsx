import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

export function SettingsPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canEditBoards) {
    return (
      <AppLayout title="Configurações gerais" subtitle="Sem permissão para editar configurações estruturais.">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Seu perfil não pode alterar workflow, perfis e notificações.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Configurações gerais" subtitle="Permissões, campos de workflow e regras de notificação.">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Campos de workflow</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={crm.addWorkflowField}>
              Novo campo
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {crm.workflowFields.map((field) => (
                <li key={field.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <Input
                      value={field.label}
                      onChange={(event) => crm.updateWorkflowField(field.id, { label: event.target.value })}
                      className="max-w-[12rem]"
                    />
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                      value={field.fieldType}
                      onChange={(event) =>
                        crm.updateWorkflowField(field.id, {
                          fieldType: event.target.value as 'text' | 'select' | 'number' | 'date',
                        })
                      }
                    >
                      <option value="text">text</option>
                      <option value="select">select</option>
                      <option value="number">number</option>
                      <option value="date">date</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={field.required}
                        onChange={(event) => crm.updateWorkflowField(field.id, { required: event.target.checked })}
                      />
                      Obrigatório
                    </label>
                    <Button type="button" variant="destructive" size="sm" onClick={() => crm.removeWorkflowField(field.id)}>
                      Remover
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Permissões por papel</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={crm.addPermissionProfile}>
              Novo perfil
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {crm.permissions.map((profile) => (
                <li key={profile.id} className="space-y-3 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                      value={profile.role}
                      onChange={(event) =>
                        crm.updatePermissionProfile(profile.id, {
                          role: event.target.value as 'admin' | 'gestor' | 'sdr',
                        })
                      }
                    >
                      <option value="admin">admin</option>
                      <option value="gestor">gestor</option>
                      <option value="sdr">sdr</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={profile.canEditBoards}
                        onChange={(event) =>
                          crm.updatePermissionProfile(profile.id, { canEditBoards: event.target.checked })
                        }
                      />
                      boards
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={profile.canRouteLeads}
                        onChange={(event) =>
                          crm.updatePermissionProfile(profile.id, { canRouteLeads: event.target.checked })
                        }
                      />
                      roteamento
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={profile.canViewTvPanel}
                        onChange={(event) =>
                          crm.updatePermissionProfile(profile.id, { canViewTvPanel: event.target.checked })
                        }
                      />
                      painel TV
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={profile.canManageUsers}
                        onChange={(event) =>
                          crm.updatePermissionProfile(profile.id, { canManageUsers: event.target.checked })
                        }
                      />
                      Gerenciar usuários
                    </label>
                    <Button type="button" variant="destructive" size="sm" onClick={() => crm.removePermissionProfile(profile.id)}>
                      Remover
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Notificações</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={crm.addNotificationRule}>
              Nova regra
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {crm.notifications.map((rule) => (
                <li key={rule.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <Input
                      value={rule.name}
                      onChange={(event) => crm.updateNotificationRule(rule.id, { name: event.target.value })}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                        value={rule.channel}
                        onChange={(event) =>
                          crm.updateNotificationRule(rule.id, {
                            channel: event.target.value as 'email' | 'whatsapp' | 'in_app',
                          })
                        }
                      >
                        <option value="in_app">in_app</option>
                        <option value="email">email</option>
                        <option value="whatsapp">whatsapp</option>
                      </select>
                      <Input
                        value={rule.trigger}
                        onChange={(event) => crm.updateNotificationRule(rule.id, { trigger: event.target.value })}
                        placeholder="Gatilho"
                        className="max-w-[12rem]"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={rule.enabled}
                        onChange={(event) => crm.updateNotificationRule(rule.id, { enabled: event.target.checked })}
                      />
                      Ativo
                    </label>
                    <Button type="button" variant="destructive" size="sm" onClick={() => crm.removeNotificationRule(rule.id)}>
                      Remover
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
