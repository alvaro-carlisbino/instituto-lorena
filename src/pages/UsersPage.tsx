import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

export function UsersPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="Usuários e permissões" subtitle="Sem permissão para gerenciamento de usuários.">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Seu perfil não pode gerenciar usuários.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Usuários e permissões" subtitle="Equipe operacional, e-mail e convite Supabase Auth (admin).">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={crm.addUser}>
          Novo usuário
        </Button>
      </div>

      {crm.authNotice ? (
        <p className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">{crm.authNotice}</p>
      ) : null}

      <Card className="mt-4 shadow-sm">
        <CardContent className="pt-6">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {crm.users.map((user) => (
              <li key={user.id} className="flex flex-col gap-4 p-4">
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="grid gap-1">
                    <Label className="text-xs text-muted-foreground">Nome</Label>
                    <Input value={user.name} onChange={(event) => crm.updateUser(user.id, { name: event.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs text-muted-foreground">E-mail</Label>
                    <Input
                      type="email"
                      value={user.email}
                      onChange={(event) => crm.updateUser(user.id, { email: event.target.value })}
                      placeholder="nome@empresa.com"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={user.role}
                      onChange={(event) =>
                        crm.updateUser(user.id, { role: event.target.value as 'admin' | 'gestor' | 'sdr' })
                      }
                    >
                      <option value="admin">admin</option>
                      <option value="gestor">gestor</option>
                      <option value="sdr">sdr</option>
                    </select>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={user.active}
                        onChange={(event) => crm.updateUser(user.id, { active: event.target.checked })}
                      />
                      Ativo
                    </label>
                  </div>
                  <div className="flex flex-col justify-end gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={crm.isLoading || !user.email?.includes('@')}
                      onClick={() => void crm.runInviteTeamMember(user.email, user.name, user.role)}
                    >
                      Enviar convite
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => crm.removeUser(user.id)}>
                      Remover
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
