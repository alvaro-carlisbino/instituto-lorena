import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
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
  { value: 'manual' as const, label: 'Manual' },
]

export function AdminLabPage() {
  const crm = useCrm()
  const [webhookName, setWebhookName] = useState('Teste Webhook')
  const [webhookPhone, setWebhookPhone] = useState('11999999999')
  const [webhookSource, setWebhookSource] = useState<(typeof WEBHOOK_SOURCES)[number]['value']>('whatsapp')
  const [webhookSending, setWebhookSending] = useState(false)

  const handleTestWebhook = () => {
    if (!isSupabaseConfigured || !supabase) {
      toast.error('Configure VITE_SUPABASE_URL e a chave anon no .env')
      return
    }
    const secret = import.meta.env.VITE_CRM_WEBHOOK_SECRET?.trim()
    if (!secret) {
      toast.error('Defina VITE_CRM_WEBHOOK_SECRET (mesmo valor que CRM_WEBHOOK_SECRET no Supabase)')
      return
    }
    setWebhookSending(true)
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('crm-ingest-webhook', {
          body: {
            patient_name: webhookName,
            phone: webhookPhone,
            source: webhookSource,
            summary: 'Carga de teste via Admin Lab',
          },
          headers: { 'x-webhook-secret': secret },
        })
        if (error) {
          toast.error(error.message)
          return
        }
        const d = data as { leadId?: string; status?: string; error?: string }
        if (d.error) {
          toast.error(d.error)
          return
        }
        toast.success(`Lead ${d.status === 'updated' ? 'atualizado' : 'criado'}: ${d.leadId ?? '—'}`)
        await crm.syncFromSupabase()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Falha na chamada')
      } finally {
        setWebhookSending(false)
      }
    })()
  }

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="Admin Lab" subtitle="Sem permissão para rotas administrativas.">
        <Card className="shadow-sm">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            <p className="m-0">Apenas administradores podem acessar esta área.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Admin Lab" subtitle="Ferramentas de suporte para homologação e manutenção.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Seed de dados</CardTitle>
            <CardDescription>Popula usuários, pipelines e configurações iniciais para homologação.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button type="button" onClick={() => void crm.seedSupabase()} disabled={crm.isLoading}>
              Seed dados
            </Button>
          </CardFooter>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Usuários auth de teste</CardTitle>
            <CardDescription>Cria usuários padrão de SDR para demos controladas.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button type="button" variant="outline" onClick={() => void crm.createTestAuthUsers()} disabled={crm.isLoading}>
              Criar auth teste
            </Button>
          </CardFooter>
        </Card>

        <Card className="shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Replay webhook</CardTitle>
            <CardDescription>Dispara replay manual para a fila de webhooks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button type="button" variant="outline" onClick={() => void crm.runWebhookReplay()} disabled={crm.isLoading}>
              Reprocessar webhook
            </Button>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {crm.queueJobs.slice(0, 10).map((job) => (
                <li key={job.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="m-0 font-medium">{job.source}</p>
                    <p className="m-0 text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString('pt-BR')}</p>
                    <p className="m-0 text-sm text-muted-foreground">{job.note}</p>
                  </div>
                  <Badge className={cn('shrink-0 border', jobStatusClass(job.status))}>{job.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Sincronização</CardTitle>
            <CardDescription>Força leitura completa do estado atual do Supabase.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button type="button" variant="outline" onClick={() => void crm.syncFromSupabase()} disabled={crm.isLoading}>
              Sincronizar agora
            </Button>
          </CardFooter>
        </Card>

        <Card className="shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Testar webhook de ingestão</CardTitle>
            <CardDescription>
              Envia POST para a Edge Function <code className="text-xs">crm-ingest-webhook</code> com o segredo em{' '}
              <code className="text-xs">VITE_CRM_WEBHOOK_SECRET</code> (não comitar em repositórios públicos).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="wh-name">Nome do lead</Label>
              <Input id="wh-name" value={webhookName} onChange={(e) => setWebhookName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wh-phone">Telefone (mín. 10 dígitos)</Label>
              <Input id="wh-phone" value={webhookPhone} onChange={(e) => setWebhookPhone(e.target.value)} inputMode="tel" />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label>Origem</Label>
              <Select
                value={webhookSource}
                onValueChange={(v) => setWebhookSource(v as (typeof WEBHOOK_SOURCES)[number]['value'])}
              >
                <SelectTrigger>
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
              onClick={handleTestWebhook}
              disabled={webhookSending || crm.isLoading}
            >
              {webhookSending ? 'Enviando…' : 'Enviar payload de teste'}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </AppLayout>
  )
}
