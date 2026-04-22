import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'

export function ChannelsPage() {
  const crm = useCrm()

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
    <AppLayout title="Canais configuráveis" subtitle="Ative canais, prioridade, SLA e resposta automática.">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={crm.addChannel}>
          Novo canal
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {crm.channels.map((channel) => (
          <Card key={channel.id} className="shadow-sm">
            <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
              <Input
                value={channel.name}
                onChange={(event) => crm.updateChannel(channel.id, { name: event.target.value })}
                className="max-w-xs font-medium"
              />
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={channel.enabled}
                  onChange={(event) => crm.updateChannel(channel.id, { enabled: event.target.checked })}
                />
                Ativo
              </label>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`sla-${channel.id}`}>SLA (min)</Label>
                <Input
                  id={`sla-${channel.id}`}
                  type="number"
                  min={1}
                  value={channel.slaMinutes}
                  onChange={(event) => crm.updateChannel(channel.id, { slaMinutes: Number(event.target.value) })}
                  className="max-w-[10rem]"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Prioridade</span>
                <Button type="button" variant="outline" size="sm" onClick={() => crm.moveChannelPriority(channel.id, 'up')}>
                  Subir
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => crm.moveChannelPriority(channel.id, 'down')}>
                  Descer
                </Button>
                <Badge variant="secondary">{channel.priority}</Badge>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input"
                  checked={channel.autoReply}
                  onChange={(event) => crm.updateChannel(channel.id, { autoReply: event.target.checked })}
                />
                Resposta automática
              </label>
              <div className="grid gap-2">
                <Label>Driver de integração</Label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={channel.driver}
                  onChange={(event) =>
                    crm.updateChannel(channel.id, {
                      driver: event.target.value as (typeof channel)['driver'],
                    })
                  }
                >
                  <option value="manual">manual</option>
                  <option value="meta">meta</option>
                  <option value="whatsapp">whatsapp</option>
                  <option value="webhook">webhook</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label>Regras de Integração (Configuração Avançada)</Label>
                <Textarea
                  key={`${channel.id}-fm`}
                  rows={3}
                  className="font-mono text-xs"
                  defaultValue={JSON.stringify(channel.fieldMapping, null, 0)}
                  onBlur={(event) => {
                    try {
                      const parsed = JSON.parse(event.target.value || '{}') as Record<string, string>
                      crm.updateChannel(channel.id, { fieldMapping: parsed })
                    } catch {
                      /* mantém anterior */
                    }
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label>Chave de Acesso / Token de Segurança</Label>
                <Input
                  value={channel.credentialsRef}
                  onChange={(event) => crm.updateChannel(channel.id, { credentialsRef: event.target.value })}
                  placeholder="ex.: Chave do WhatsApp ou Meta"
                />
              </div>
              <Button type="button" variant="destructive" size="sm" className="w-fit" onClick={() => crm.removeChannel(channel.id)}>
                Remover canal
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppLayout>
  )
}
