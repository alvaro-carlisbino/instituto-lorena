import { useState } from 'react'
import { Radio, Trash } from 'phosphor-react'
import { toast } from 'sonner'

import { ChannelFieldMappingEditor } from '@/components/config/ChannelFieldMappingEditor'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

const DRIVER_OPTIONS = [
  { value: 'manual', label: 'Manual (sem sistema externo)' },
  { value: 'meta', label: 'Meta (Facebook / Instagram)' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'webhook', label: 'Link externo (URL)' },
] as const

export function ChannelsPage() {
  const crm = useCrm()
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    crm.removeChannel(deleteTarget.id)
    toast.success('Canal removido com sucesso.')
    setDeleteTarget(null)
  }

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Canais configuráveis" subtitle="Sem permissão para editar canais no perfil atual.">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Você pode visualizar canais, mas não alterar configurações.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Canais configuráveis"
      subtitle="Ative canais, prioridade, prazo e conexão dos campos do lead."
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={() => {
            crm.addChannel()
            toast.success('Canal criado.')
          }}
        >
          Novo canal
        </Button>
      </div>

      <Card className="mb-4 border-border/60 bg-muted/10 shadow-sm">
        <CardContent className="pt-4 sm:pt-5">
          <CardDescription className="text-sm leading-relaxed text-muted-foreground">
            Define qual informação do contato será preenchida automaticamente quando o canal receber uma mensagem.
            Preencha o caminho como texto simples; a equipe técnica pode indicar o formato exato.
          </CardDescription>
        </CardContent>
      </Card>

      {crm.channels.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="Nenhum canal configurado"
          description="Crie um canal para receber leads de fontes externas como WhatsApp, Meta Ads ou link externo (URL)."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {crm.channels.map((channel) => (
            <Card key={channel.id} className="border-border/50 shadow-sm transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <Input
                  value={channel.name}
                  onChange={(event) => crm.updateChannel(channel.id, { name: event.target.value })}
                  className="min-w-0 w-full font-medium sm:max-w-md"
                />
                <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
                  <Switch
                    checked={channel.enabled}
                    onCheckedChange={(checked) => crm.updateChannel(channel.id, { enabled: checked })}
                  />
                  <Label className="text-sm cursor-pointer">Ativo</Label>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid w-full min-w-0 gap-2 sm:max-w-xs">
                  <Label htmlFor={`sla-${channel.id}`}>Prazo (min)</Label>
                  <Input
                    id={`sla-${channel.id}`}
                    type="number"
                    min={1}
                    value={channel.slaMinutes}
                    onChange={(event) => crm.updateChannel(channel.id, { slaMinutes: Number(event.target.value) })}
                    className="w-full max-w-full min-[380px]:max-w-[10rem]"
                  />
                </div>
                <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Prioridade</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => crm.moveChannelPriority(channel.id, 'up')}>
                    Subir
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => crm.moveChannelPriority(channel.id, 'down')}>
                    Descer
                  </Button>
                  <Badge variant="secondary">{channel.priority}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={channel.autoReply}
                    onCheckedChange={(checked) => crm.updateChannel(channel.id, { autoReply: checked })}
                  />
                  <Label className="text-sm cursor-pointer">Resposta automática</Label>
                </div>
                <div className="grid gap-2">
                  <Label>Tipo de integração</Label>
                  <Select
                    value={channel.driver}
                    onValueChange={(value) =>
                      crm.updateChannel(channel.id, {
                        driver: value as (typeof channel)['driver'],
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DRIVER_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Conexão dos campos</Label>
                  <ChannelFieldMappingEditor
                    key={`${channel.id}-${JSON.stringify(channel.fieldMapping ?? {})}`}
                    channelId={channel.id}
                    fieldMapping={channel.fieldMapping}
                    workflowFields={crm.workflowFields}
                    onApply={(next) => { crm.updateChannel(channel.id, { fieldMapping: next }); toast.success('Mapeamento atualizado.') }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Nome da configuração de acesso</Label>
                  <Input
                    value={channel.credentialsRef}
                    onChange={(event) => crm.updateChannel(channel.id, { credentialsRef: event.target.value })}
                    placeholder="Preencha apenas se a equipe técnica orientar"
                  />
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="w-full min-[380px]:w-fit"
                  onClick={() => setDeleteTarget({ id: channel.id, name: channel.name })}
                >
                  <Trash className="mr-1 size-4" weight="duotone" />
                  Remover canal
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Remover canal"
        description={`Tem certeza que deseja remover o canal "${deleteTarget?.name ?? ''}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        onConfirm={handleConfirmDelete}
      />
    </AppLayout>
  )
}
