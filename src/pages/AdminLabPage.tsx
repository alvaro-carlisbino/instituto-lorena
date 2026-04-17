import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
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

export function AdminLabPage() {
  const crm = useCrm()

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
      </div>
    </AppLayout>
  )
}
