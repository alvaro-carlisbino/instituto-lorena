import { useCallback, useState } from 'react'
import { EyeIcon, EyeOffIcon, Trash2Icon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { NoticeBanner } from '@/components/NoticeBanner'
import { noticeVariantFromMessage } from '@/lib/noticeVariant'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

type PwDraft = { password: string; confirm: string; visible: boolean }

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Administrador' },
  { value: 'gestor', label: 'Gestor comercial' },
  { value: 'sdr', label: 'Atendente' },
] as const

export function UsersPage() {
  const crm = useCrm()
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, PwDraft>>({})
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const setDraft = useCallback((userId: string, patch: Partial<PwDraft>) => {
    setPasswordDrafts((prev) => ({
      ...prev,
      [userId]: {
        password: patch.password ?? prev[userId]?.password ?? '',
        confirm: patch.confirm ?? prev[userId]?.confirm ?? '',
        visible: patch.visible ?? prev[userId]?.visible ?? false,
      },
    }))
  }, [])

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    crm.removeUser(deleteTarget.id)
    toast.success('Usuário removido com sucesso.')
    setDeleteTarget(null)
  }

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="Equipe">
        <Card className="border-border shadow-none bg-muted/10 rounded-none">
          <CardContent className="pt-6 text-sm text-destructive font-bold uppercase tracking-widest">
            <p className="m-0">Seu perfil não pode gerenciar usuários.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Equipe">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <Button type="button" onClick={() => { crm.addUser(); toast.success('Usuário adicionado à lista.') }} className="rounded-md">
          Novo usuário
        </Button>
      </div>

      <NoticeBanner
        message={crm.authNotice}
        variant={noticeVariantFromMessage(crm.authNotice)}
        className="mt-4 rounded-none"
      />

      <Card className="mt-8 border border-border/40 shadow-none bg-card">
        <CardHeader className="space-y-1 pb-6 border-b border-border/20">
          <CardTitle className="text-lg font-medium">Equipe</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0 pt-0 px-0">
          {crm.users.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="Nenhum usuário cadastrado"
              description="Adicione membros à equipe para começar a distribuir leads."
            />
          ) : (
            <ul className="m-0 list-none space-y-0 p-0 divide-y divide-border">
              {crm.users.map((user) => {
                const draft = passwordDrafts[user.id] ?? { password: '', confirm: '', visible: false }
                return (
                  <li
                    key={user.id}
                    className="bg-card hover:bg-muted/5 transition-colors p-6"
                  >
                    <div className="grid gap-6 lg:grid-cols-[2fr_2fr_minmax(0,14rem)_auto] lg:items-end">
                      <div className="grid gap-2">
                        <Label htmlFor={`name-${user.id}`} className="text-xs font-medium text-muted-foreground">
                          Nome
                        </Label>
                        <Input
                          id={`name-${user.id}`}
                          value={user.name}
                          onChange={(e) => crm.updateUser(user.id, { name: e.target.value })}
                          className="h-9 rounded-md border-border/40"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`email-${user.id}`} className="text-xs font-medium text-muted-foreground">
                          E-mail
                        </Label>
                        <Input
                          id={`email-${user.id}`}
                          type="email"
                          value={user.email}
                          onChange={(e) => crm.updateUser(user.id, { email: e.target.value })}
                          placeholder="nome@empresa.com"
                          className="h-9 rounded-md border-border/40"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`role-${user.id}`} className="text-xs font-medium text-muted-foreground">
                          Papel / Função
                        </Label>
                        <Select
                          value={user.role}
                          onValueChange={(value) =>
                            crm.updateUser(user.id, { role: value as 'admin' | 'gestor' | 'sdr' })
                          }
                        >
                          <SelectTrigger id={`role-${user.id}`} className="h-9 rounded-md border-border/40 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2 mb-2 lg:justify-end">
                        <Switch
                          checked={user.active}
                          onCheckedChange={(checked) => crm.updateUser(user.id, { active: checked })}
                        />
                        <Label className="text-xs font-medium cursor-pointer">
                          Ativo
                        </Label>
                      </div>
                    </div>

                    <Separator className="my-6 border-border/50" />

                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="grid gap-2">
                        <Label htmlFor={`pw-${user.id}`} className="text-xs font-medium text-muted-foreground">
                          Senha inicial
                        </Label>
                        <div className="relative">
                          <Input
                            id={`pw-${user.id}`}
                            type={draft.visible ? 'text' : 'password'}
                            autoComplete="new-password"
                            value={draft.password}
                            onChange={(e) => setDraft(user.id, { password: e.target.value })}
                            placeholder="Mín. 8 caracteres"
                            className="h-9 rounded-md border-border/40 font-mono pr-10"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                            onClick={() => setDraft(user.id, { visible: !draft.visible })}
                          >
                            {draft.visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor={`pwc-${user.id}`} className="text-xs font-medium text-muted-foreground">
                          Confirmar senha
                        </Label>
                        <Input
                          id={`pwc-${user.id}`}
                          type={draft.visible ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={draft.confirm}
                          onChange={(e) => setDraft(user.id, { confirm: e.target.value })}
                          className="h-9 rounded-md border-border/40 font-mono"
                        />
                      </div>
                      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1 lg:justify-end">
                        <Button
                          type="button"
                          className="h-9 w-full lg:w-auto rounded-md font-medium"
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
                                toast.success(`Acesso criado para ${user.name}.`)
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
                        onClick={() => {
                          void crm.runInviteTeamMember(user.email, user.name, user.role)
                          toast.success(`Convite enviado para ${user.email}.`)
                        }}
                      >
                        Enviar convite por e-mail
                      </Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteTarget({ id: user.id, name: user.name })}>
                        <Trash2Icon className="size-4 mr-1" />
                        Remover da lista
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Remover usuário"
        description={`Tem certeza que deseja remover "${deleteTarget?.name ?? ''}" da equipe? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        onConfirm={handleConfirmDelete}
      />
    </AppLayout>
  )
}
