import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
    <AppLayout title="Usuários e permissões" subtitle="Gerencie usuários da operação e papéis de acesso.">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={crm.addUser}>
          Novo usuário
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="pt-6">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {crm.users.map((user) => (
              <li key={user.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <Input value={user.name} onChange={(event) => crm.updateUser(user.id, { name: event.target.value })} />
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
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
                </div>
                <Button type="button" variant="destructive" size="sm" className="shrink-0" onClick={() => crm.removeUser(user.id)}>
                  Remover
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
