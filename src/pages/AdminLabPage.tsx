import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'

function jobStatusClass(status: string) {
  return cn(
    'capitalize',
    status === 'queued' && 'border-amber-200 bg-amber-50 text-amber-900',
    status === 'processing' && 'border-sky-200 bg-sky-50 text-sky-900',
    status === 'retry' && 'border-red-200 bg-red-50 text-red-900',
    status === 'done' && 'border-emerald-200 bg-emerald-50 text-emerald-900'
  )
}

const WEBHOOK_SOURCES = [
  { value: 'meta_facebook' as const, label: 'Meta (Facebook)' },
  { value: 'meta_instagram' as const, label: 'Meta (Instagram)' },
  { value: 'whatsapp' as const, label: 'WhatsApp' },
  { value: 'manychat' as const, label: 'ManyChat / Instagram (IA)' },
  { value: 'manual' as const, label: 'Manual' },
] as const

export function AdminLabPage() {
  const crm = useCrm()
  const [webhookName, setWebhookName] = useState('Contato de teste')
  const [webhookPhone, setWebhookPhone] = useState('11999999999')
  const [webhookSource, setWebhookSource] = useState<(typeof WEBHOOK_SOURCES)[number]['value']>('whatsapp')
  const [webhookSending, setWebhookSending] = useState(false)

  const handleTestWebhook = () => {
    if (!isSupabaseConfigured || !supabase) {
      toast.error('Sistema não configurado. Contate o suporte técnico.')
      return
    }
    const secret =
      webhookSource === 'whatsapp'
        ? (import.meta.env.VITE_EVOLUTION_WEBHOOK_SECRET ?? '')
        : webhookSource === 'manychat'
          ? (import.meta.env.VITE_MANYCHAT_CRM_SECRET ?? '')
          : (import.meta.env.VITE_CRM_WEBHOOK_SECRET ?? '')
    const requiresSecret = webhookSource !== 'whatsapp'
    if (requiresSecret && !secret.trim()) {
      toast.error('Configuração de segurança ausente. Contate o suporte técnico.')
      return
    }
    setWebhookSending(true)
    void (async () => {
      try {
        const targetFn =
          webhookSource === 'whatsapp'
            ? 'crm-whatsapp-webhook'
            : webhookSource === 'manychat'
              ? 'crm-manychat-webhook'
              : 'crm-ingest-webhook'
        const body =
          webhookSource === 'whatsapp'
            ? {
                event: 'messages.upsert',
                data: {
                  key: { id: `test-${Date.now()}`, fromMe: false, remoteJid: `${webhookPhone}@s.whatsapp.net` },
                  pushName: webhookName,
                  message: { conversation: 'Mensagem de teste via AdminLab' },
                  messageTimestamp: Math.floor(Date.now() / 1000),
                },
              }
            : webhookSource === 'manychat'
              ? {
                  subscriber_id: webhookPhone.replace(/\D/g, '') || `sub-${Date.now()}`,
                  user_name: webhookName,
                  text: 'Mensagem de teste via AdminLab (ManyChat)',
                  external_message_id: `lab-${Date.now()}`,
                  manychat_sync: true,
                }
              : {
                  patient_name: webhookName,
                  phone: webhookPhone,
                  source: webhookSource,
                  summary: 'Carga de teste (demonstração)',
                }

        const headers: Record<string, string> = {}
        if (secret.trim()) {
          if (webhookSource === 'manychat') {
            headers['x-manychat-crm-secret'] = secret.trim()
          } else {
            headers['x-webhook-secret'] = secret.trim()
          }
        }
        const invokeHeaders = Object.keys(headers).length > 0 ? headers : undefined
        const { data, error } = await supabase.functions.invoke(targetFn, {
          body,
          headers: invokeHeaders,
        })
        if (error) {
          toast.error(error.message)
          return
        }
        const d = data as {
          leadId?: string
          status?: string
          error?: string
          reply?: string
          routing?: string
          accepted?: boolean
        }
        if (d.error) {
          toast.error(d.error)
          return
        }
        if (webhookSource === 'manychat') {
          if (d.accepted && d.routing === 'queued') {
            toast.success('Pedido aceite — IA em segundo plano (modo ManyChat). Sincroniza o CRM daqui a pouco para ver a resposta.')
          } else {
            toast.success(
              d.reply ? `Resposta IA (${(d.routing ?? '').trim() || 'ok'}).` : 'Pedido ManyChat processado (sem texto de IA).',
            )
          }
        } else {
          toast.success(d.status === 'updated' ? 'Lead atualizado com sucesso.' : 'Lead criado com sucesso.')
        }
        await crm.syncFromSupabase()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Falha na comunicação. Tente novamente.')
      } finally {
        setWebhookSending(false)
      }
    })()
  }

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="Ferramentas">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Apenas administradores podem acessar esta área.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Ferramentas">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Dados de exemplo</CardTitle>
          </CardHeader>
          <CardFooter>
            <Button type="button" onClick={() => void crm.seedSupabase()} disabled={crm.isLoading}>
              Carregar dados de exemplo
            </Button>
          </CardFooter>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Usuários de teste</CardTitle>
          </CardHeader>
          <CardFooter>
            <Button type="button" variant="outline" onClick={() => void crm.createTestAuthUsers()} disabled={crm.isLoading}>
              Criar usuário de teste
            </Button>
          </CardFooter>
        </Card>

        <Card className="shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Reprocessar mensagens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button type="button" variant="outline" onClick={() => void crm.runWebhookReplay()} disabled={crm.isLoading}>
              Reprocessar mensagens
            </Button>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {crm.queueJobs.slice(0, 10).map((job) => (
                <li key={job.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="m-0 font-medium">{job.source}</p>
                    <p className="m-0 text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString('pt-BR')}</p>
                    <p className="m-0 text-sm text-muted-foreground">{job.note}</p>
                  </div>
                  <Badge className={cn('shrink-0 border', jobStatusClass(job.status))}>{job.status === 'queued' ? 'Aguardando' : job.status === 'processing' ? 'Processando' : job.status === 'retry' ? 'Tentando novamente' : job.status === 'done' ? 'Concluído' : job.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Sincronização</CardTitle>
          </CardHeader>
          <CardFooter>
            <Button type="button" variant="outline" onClick={() => void crm.syncFromSupabase()} disabled={crm.isLoading}>
              Sincronizar agora
            </Button>
          </CardFooter>
        </Card>

        <Card className="shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Simular novo contato</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="wh-name">Nome do lead</Label>
              <Input id="wh-name" value={webhookName} onChange={(e) => setWebhookName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wh-phone">
                {webhookSource === 'manychat' ? 'Subscriber ID ManyChat (só dígitos ou texto)' : 'Telefone (mín. 10 dígitos)'}
              </Label>
              <Input id="wh-phone" value={webhookPhone} onChange={(e) => setWebhookPhone(e.target.value)} inputMode="tel" />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label>Origem</Label>
              <Select
                value={webhookSource}
                onValueChange={(v) => setWebhookSource(v as (typeof WEBHOOK_SOURCES)[number]['value'])}
              >
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEBHOOK_SOURCES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={handleTestWebhook}
              disabled={webhookSending || crm.isLoading}
            >
              {webhookSending ? 'Enviando…' : 'Simular envio'}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppLayout>
  )
}
