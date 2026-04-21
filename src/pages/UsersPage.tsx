import { useCallback, useState } from 'react'

import { NoticeBanner, noticeVariantFromMessage } from '@/components/NoticeBanner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

type PwDraft = { password: string; confirm: string }

export function UsersPage() {
  const crm = useCrm()
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, PwDraft>>({})

  const setDraft = useCallback((userId: string, patch: Partial<PwDraft>) => {
    setPasswordDrafts((prev) => ({
      ...prev,
      [userId]: {
        password: patch.password ?? prev[userId]?.password ?? '',
        confirm: patch.confirm ?? prev[userId]?.confirm ?? '',
      },
    }))
  }, [])

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="Usuários e permissões" subtitle="Sem permissão para gerenciamento de usuários.">
        <Card className="border-border shadow-none bg-muted/10 rounded-none">
          <CardContent className="pt-6 text-sm text-destructive font-bold uppercase tracking-widest">
            <p className="m-0">Seu perfil não pode gerenciar usuários.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Usuários e permissões"
      subtitle="Defina e-mail e papel na operação. Crie acesso com senha (login imediato) ou envie convite por e-mail."
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <Button type="button" onClick={crm.addUser} className="rounded-none uppercase tracking-widest font-bold">
          Novo usuário
        </Button>
      </div>

      <NoticeBanner
        message={crm.authNotice}
        variant={noticeVariantFromMessage(crm.authNotice)}
        className="mt-4 rounded-none"
      />

      <Card className="mt-8 border-border shadow-none rounded-none bg-card">
        <CardHeader className="space-y-1 pb-6 border-b border-border/50 bg-muted/10">
          <CardTitle className="text-lg uppercase tracking-widest font-bold">Equipe</CardTitle>
          <CardDescription className="text-xs">
            <strong className="text-foreground">Criar acesso:</strong> preencha senha e confirmação, depois clique em &quot;Criar acesso no sistema&quot;.
            <span className="mx-2 text-muted-foreground">·</span>
            <strong className="text-foreground">Convite:</strong> apenas e-mail (o utilizador define a senha ao aceitar).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-0 pt-0 px-0">
          <ul className="m-0 list-none space-y-0 p-0 divide-y divide-border">
            {crm.users.map((user) => {
              const draft = passwordDrafts[user.id] ?? { password: '', confirm: '' }
              return (
                <li
                  key={user.id}
                  className="bg-card hover:bg-muted/5 transition-colors p-6"
                >
                  <div className="grid gap-6 lg:grid-cols-[2fr_2fr_minmax(0,14rem)_auto] lg:items-end">
                    <div className="grid gap-2">
                      <Label htmlFor={`name-${user.id}`} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Nome
                      </Label>
                      <Input
                        id={`name-${user.id}`}
                        value={user.name}
                        onChange={(e) => crm.updateUser(user.id, { name: e.target.value })}
                        className="h-10 rounded-none border-foreground/20 font-bold"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`email-${user.id}`} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        E-mail
                      </Label>
                      <Input
                        id={`email-${user.id}`}
                        type="email"
                        value={user.email}
                        onChange={(e) => crm.updateUser(user.id, { email: e.target.value })}
                        placeholder="nome@empresa.com"
                        className="h-10 rounded-none border-foreground/20"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`role-${user.id}`} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Papel / Função
                      </Label>
                      <select
                        id={`role-${user.id}`}
                        className="h-10 rounded-none border border-input bg-background px-3 text-sm font-semibold uppercase tracking-wide"
                        value={user.role}
                        onChange={(e) =>
                          crm.updateUser(user.id, { role: e.target.value as 'admin' | 'gestor' | 'sdr' })
                        }
                      >
                        <option value="admin">ADMIN</option>
                        <option value="gestor">GESTOR</option>
                        <option value="sdr">SDR</option>
                      </select>
                    </div>
                    <label className="flex cursor-pointer items-center mb-2 gap-2 text-[10px] font-bold uppercase tracking-widest lg:justify-end">
                      <input
                        type="checkbox"
                        className="size-4 rounded-none border-input"
                        checked={user.active}
                        onChange={(e) => crm.updateUser(user.id, { active: e.target.checked })}
                      />
                      Ativo
                    </label>
                  </div>

                  <Separator className="my-6 border-border/50" />

                  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="grid gap-2">
                      <Label htmlFor={`pw-${user.id}`} className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                        Senha inicial
                      </Label>
                      <Input
                        id={`pw-${user.id}`}
                        type="password"
                        autoComplete="new-password"
                        value={draft.password}
                        onChange={(e) => setDraft(user.id, { password: e.target.value })}
                        placeholder="Mín. 8 caracteres"
                        className="h-10 rounded-none font-mono"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`pwc-${user.id}`} className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                        Confirmar senha
                      </Label>
                      <Input
                        id={`pwc-${user.id}`}
                        type="password"
                        autoComplete="new-password"
                        value={draft.confirm}
                        onChange={(e) => setDraft(user.id, { confirm: e.target.value })}
                        className="h-10 rounded-none font-mono"
                      />
                    </div>
                    <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1 lg:justify-end">
                      <Button
                        type="button"
                        className="h-10 w-full lg:w-auto rounded-none uppercase tracking-widest font-bold text-[10px]"
                        disabled={crm.isLoading || !user.email?.includes('@') || !draft.password}
                        onClick={() => {
                          void (async () => {
                            const ok = await crm.runProvisionUser({
                              appUserId: user.id,
                              email: user.email,
                              displayName: user.name,
                              role: user.role,
                              password: draft.password,
                              passwordConfirm: draft.confirm,
                            })
                            if (ok) {
                              setPasswordDrafts((prev) => {
                                const next = { ...prev }
                                delete next[user.id]
                                return next
                              })
                            }
                          })()
                        }}
                      >
                        Criar acesso no sistema
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={crm.isLoading || !user.email?.includes('@')}
                      onClick={() => void crm.runInviteTeamMember(user.email, user.name, user.role)}
                    >
                      Enviar convite por e-mail
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => crm.removeUser(user.id)}>
                      Remover da lista
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </AppLayout>
  )
}
