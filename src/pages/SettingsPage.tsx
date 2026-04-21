import { NoticeBanner, noticeVariantFromMessage } from '@/components/NoticeBanner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import type { FieldVisibilityContext } from '@/mocks/crmMock'

export function SettingsPage() {
  const crm = useCrm()

  const canAccessSettings = crm.currentPermission.canEditBoards || crm.currentPermission.canManageUsers

  if (!canAccessSettings) {
    return (
      <AppLayout title="Configurações gerais" subtitle="Sem permissão para editar configurações estruturais.">
        <Card className="border-border shadow-none bg-muted/10 rounded-none">
          <CardContent className="pt-6 text-sm text-destructive font-bold uppercase tracking-widest">
            <p className="m-0">Peça acesso a um administrador (workflow, perfis de permissão e notificações).</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Configurações gerais" subtitle="Permissões, campos de workflow e regras de notificação.">
      <NoticeBanner
        message={crm.syncNotice}
        variant={noticeVariantFromMessage(crm.syncNotice)}
        className="mb-2"
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <Card className="border-border shadow-none rounded-none bg-card">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-6 border-b border-border/50 bg-muted/10">
            <div className="space-y-1">
              <CardTitle className="tracking-widest uppercase text-base font-bold">Campos de workflow</CardTitle>
              <CardDescription className="text-xs">Chaves estáveis, rótulos e onde cada campo aparece no CRM.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={crm.addWorkflowField} className="rounded-none uppercase tracking-widest font-bold">
              Novo campo
            </Button>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            <ul className="m-0 list-none space-y-0 p-0 divide-y divide-border">
              {crm.workflowFields.map((field) => {
                const toggleVis = (ctx: FieldVisibilityContext, checked: boolean) => {
                  const next = checked
                    ? Array.from(new Set([...field.visibleIn, ctx]))
                    : field.visibleIn.filter((c) => c !== ctx)
                  crm.updateWorkflowField(field.id, { visibleIn: next as FieldVisibilityContext[] })
                }
                const vis = (ctx: FieldVisibilityContext) => field.visibleIn.includes(ctx)
                return (
                  <li
                    key={field.id}
                    className="flex flex-col gap-6 bg-transparent hover:bg-muted/5 transition-colors p-6"
                  >
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="grid gap-2">
                        <Label className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">Chave (slug)</Label>
                        <Input
                          value={field.fieldKey}
                          onChange={(event) => crm.updateWorkflowField(field.id, { fieldKey: event.target.value })}
                          className="font-mono text-sm rounded-none border-foreground/20 font-bold"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs text-muted-foreground">Rótulo</Label>
                        <Input
                          value={field.label}
                          onChange={(event) => crm.updateWorkflowField(field.id, { label: event.target.value })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs text-muted-foreground">Seção / ordem</Label>
                        <div className="flex gap-2">
                          <Input
                            value={field.section}
                            onChange={(event) => crm.updateWorkflowField(field.id, { section: event.target.value })}
                            placeholder="Seção"
                          />
                          <Input
                            type="number"
                            className="w-20"
                            value={field.sortOrder}
                            onChange={(event) =>
                              crm.updateWorkflowField(field.id, { sortOrder: Number(event.target.value) || 0 })
                            }
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-input"
                          checked={field.required}
                          onChange={(event) => crm.updateWorkflowField(field.id, { required: event.target.checked })}
                        />
                        Obrigatório
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs">
                      <span className="text-muted-foreground">Visível em:</span>
                      {(
                        [
                          ['kanban_card', 'Kanban'],
                          ['lead_detail', 'Detalhe'],
                          ['list', 'Lista'],
                          ['capture_form', 'Captura'],
                        ] as const
                      ).map(([ctx, label]) => (
                        <label key={ctx} className="flex cursor-pointer items-center gap-1">
                          <input
                            type="checkbox"
                            className="size-3.5 rounded border-input"
                            checked={vis(ctx)}
                            onChange={(e) => toggleVis(ctx, e.target.checked)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <Button type="button" variant="destructive" size="sm" onClick={() => crm.removeWorkflowField(field.id)}>
                        Remover
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none rounded-none bg-card">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-6 border-b border-border/50 bg-muted/10">
            <div className="space-y-1">
              <CardTitle className="tracking-widest uppercase text-base font-bold">Permissões por papel</CardTitle>
              <CardDescription className="text-xs">Combinações de permissões por função (admin, gestor, SDR).</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={crm.addPermissionProfile} className="rounded-none uppercase tracking-widest font-bold">
              Novo perfil
            </Button>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            <ul className="m-0 list-none space-y-0 p-0 divide-y divide-border">
              {crm.permissions.map((profile) => (
                <li
                  key={profile.id}
                  className="space-y-6 hover:bg-muted/5 transition-colors p-6"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-10 rounded-none border border-input bg-background px-3 text-sm font-semibold uppercase tracking-wide"
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

        <Card className="border-border shadow-none rounded-none bg-card lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-6 border-b border-border/50 bg-muted/10">
            <div className="space-y-1">
              <CardTitle className="tracking-widest uppercase text-base font-bold">Notificações</CardTitle>
              <CardDescription className="text-xs">Canais e gatilhos para alertas operacionais.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={crm.addNotificationRule} className="rounded-none uppercase tracking-widest font-bold">
              Nova regra
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="m-0 list-none space-y-3 p-0">
              {crm.notifications.map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card/50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                >
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

      {crm.currentPermission.canEditBoards ? (
        <Card className="mt-6 border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Organização (datas e locale)</CardTitle>
            <CardDescription>Fuso e formato usados em relatórios e listagens.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="org-tz">Fuso horário</Label>
              <Input
                id="org-tz"
                value={crm.orgSettings.timezone}
                onChange={(e) => crm.updateOrgSettings({ timezone: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="org-df">Formato de data</Label>
              <Input
                id="org-df"
                value={crm.orgSettings.dateFormat}
                onChange={(e) => crm.updateOrgSettings({ dateFormat: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="org-ws">Semana começa em (0=dom …)</Label>
              <Input
                id="org-ws"
                type="number"
                min={0}
                max={6}
                value={crm.orgSettings.weekStartsOn}
                onChange={(e) => crm.updateOrgSettings({ weekStartsOn: Number(e.target.value) || 0 })}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </AppLayout>
  )
}
