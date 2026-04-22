import { ChannelFieldMappingEditor } from '@/components/config/ChannelFieldMappingEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    <AppLayout
      title="Canais configuráveis"
      subtitle="Ative canais, prioridade, SLA e ligação aos dados do lead — sem JSON, só listas e texto."
    >
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={crm.addChannel}>
          Novo canal
        </Button>
      </div>

      <Card className="mb-4 border-border/80 shadow-sm">
        <CardContent className="pt-4">
          <CardDescription className="text-sm leading-relaxed text-muted-foreground">
            O mapeamento diz ao sistema de onde ler cada informação quando o canal recebe um evento (por exemplo um webhook).
            Preencha o caminho como texto simples; a equipa técnica pode indicar o formato exacto.
          </CardDescription>
        </CardContent>
      </Card>

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
                <Label>Tipo de integração</Label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={channel.driver}
                  onChange={(event) =>
                    crm.updateChannel(channel.id, {
                      driver: event.target.value as (typeof channel)['driver'],
                    })
                  }
                >
                  <option value="manual">Manual (sem sistema externo)</option>
                  <option value="meta">Meta (Facebook / Instagram)</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="webhook">Webhook (URL própria)</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label>Ligação dos dados (mapeamento)</Label>
                <ChannelFieldMappingEditor
                  key={`${channel.id}-${JSON.stringify(channel.fieldMapping ?? {})}`}
                  channelId={channel.id}
                  fieldMapping={channel.fieldMapping}
                  workflowFields={crm.workflowFields}
                  onApply={(next) => crm.updateChannel(channel.id, { fieldMapping: next })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Identificador da credencial no ambiente</Label>
                <Input
                  value={channel.credentialsRef}
                  onChange={(event) => crm.updateChannel(channel.id, { credentialsRef: event.target.value })}
                  placeholder="Só preencha se a equipa técnica indicar (ex.: nome da variável)"
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
