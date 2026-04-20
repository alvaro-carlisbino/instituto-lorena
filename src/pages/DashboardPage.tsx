import { Link, useNavigate } from 'react-router-dom'
import { KanbanSquare, MoreHorizontal, RefreshCw, SlidersHorizontal } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { cn } from '@/lib/utils'

export function DashboardPage() {
  const crm = useCrm()
  const navigate = useNavigate()
  const canSync = crm.currentPermission.canRouteLeads || crm.currentPermission.canManageUsers

  const getDashboardValue = (metricKey: string) => {
    if (metricKey === 'leads-active') return crm.leads.length
    if (metricKey === 'leads-hot') return crm.totalHotLeads
    if (metricKey === 'qualified-ai') return crm.totalQualified
    if (metricKey === 'channels-active') return crm.channels.filter((channel) => channel.enabled).length
    const metric = crm.metrics.find((item) => item.id === metricKey)
    return metric?.value ?? 0
  }

  const dashboardCards = crm.dashboardWidgets.filter((widget) => widget.enabled).sort((a, b) => a.position - b.position)

  return (
    <AppLayout
      title="Dashboard comercial"
      subtitle="Visão geral com indicadores ajustáveis e operação do dia."
      actions={
        <>
          {crm.currentPermission.canRouteLeads ? (
            <Link to="/kanban" className={cn(buttonVariants({ size: 'sm' }), 'inline-flex gap-1.5')}>
              <KanbanSquare className="size-4" />
              Abrir Kanban
            </Link>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="outline" size="sm" className="gap-1.5">
                <MoreHorizontal className="size-4" />
                Mais ações
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {crm.currentPermission.canRouteLeads ? (
                <DropdownMenuItem onClick={() => navigate('/dashboard-config')}>
                  <SlidersHorizontal className="size-4" />
                  Ajustar widgets do dashboard
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => navigate('/configuracoes')}>Configurações gerais</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={crm.isLoading || !canSync}
                onClick={() => void crm.syncFromSupabase()}
              >
                <RefreshCw className={`size-4 ${crm.isLoading ? 'animate-spin' : ''}`} />
                {crm.isLoading ? 'Sincronizando…' : 'Sincronizar dados'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardCards.map((card) => (
          <Card key={card.id} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription>{card.title}</CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums">{getDashboardValue(card.metricKey)}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      {crm.captureNotice ? (
        <p className="rounded-lg border border-success/35 bg-success/10 px-4 py-3 text-sm text-success-foreground">
          {crm.captureNotice}
        </p>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Pipeline atual</CardTitle>
            <Select
              value={crm.selectedPipelineId}
              onValueChange={(value) => {
                if (value) crm.setSelectedPipelineId(value)
              }}
            >
              <SelectTrigger className="w-[min(100%,14rem)]" size="sm">
                <SelectValue placeholder="Pipeline" />
              </SelectTrigger>
              <SelectContent>
                {crm.pipelineCatalog.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-md border border-border">
              {crm.selectedPipeline.stages.map((stage) => (
                <li key={stage.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <span className="font-medium">{stage.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {crm.filteredLeads.filter((lead) => lead.stageId === stage.id).length}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Equipe SDR</CardTitle>
            <CardDescription>Distribuição de leads por responsável</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border rounded-md border border-border">
              {crm.workloadBySdr.map((sdr) => (
                <li key={sdr.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <span className="font-medium">{sdr.name}</span>
                  <span className="text-muted-foreground">{sdr.total} leads</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </AppLayout>
  )
}
