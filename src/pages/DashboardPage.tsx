import { Link, useNavigate } from 'react-router-dom'
import { KanbanSquare, MoreHorizontal, RefreshCw, SlidersHorizontal } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
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
            <DropdownMenuTrigger
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
            >
              <MoreHorizontal className="size-4" />
              Mais ações
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
      <section className="grid gap-px bg-border/50 sm:grid-cols-2 xl:grid-cols-4 border border-border">
        {dashboardCards.map((card, index) => (
          <Card key={card.id} className={cn("border-0 rounded-none shadow-none bg-card transition-all duration-300 hover:bg-muted/30", index === 0 ? "xl:col-span-1 border-b-2 border-b-primary" : "")}>
            <CardHeader className="pb-4 pt-6 px-6">
              <CardTitle className="text-4xl font-light tabular-nums tracking-tighter text-foreground mb-1">{getDashboardValue(card.metricKey)}</CardTitle>
              <CardDescription className="text-xs uppercase tracking-widest font-semibold text-muted-foreground">{card.title}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      {crm.captureNotice ? (
        <p className="rounded-lg border border-success/35 bg-success/10 px-4 py-3 text-sm text-success-foreground">
          {crm.captureNotice}
        </p>
      ) : null}

      <section className="grid gap-8 lg:grid-cols-12 mt-8">
        <Card className="shadow-none border-border rounded-none lg:col-span-8">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 border-b border-border/50 pb-4 bg-muted/20">
            <div className="space-y-1">
              <CardTitle className="text-sm uppercase tracking-widest">Pipeline de Triagem</CardTitle>
              <CardDescription className="text-xs">Visualização do fluxo clínico no estágio atual</CardDescription>
            </div>
            <Select
              value={crm.selectedPipelineId}
              onValueChange={(value) => {
                if (value) crm.setSelectedPipelineId(value)
              }}
            >
              <SelectTrigger className="w-[min(100%,16rem)] rounded-none border-foreground/20 font-medium" size="sm">
                <SelectValue placeholder="Pipeline" />
              </SelectTrigger>
              <SelectContent className="rounded-none font-medium">
                {crm.pipelineCatalog.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {crm.selectedPipeline.stages.map((stage) => (
                <li key={stage.id} className="flex items-center justify-between gap-3 px-6 py-4 text-sm transition-colors hover:bg-muted/10 group">
                  <span className="font-semibold text-foreground/80 group-hover:text-primary transition-colors">{stage.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] tracking-widest uppercase text-muted-foreground font-semibold">Leads</span>
                    <span className="tabular-nums font-mono text-base bg-secondary px-3 py-1 text-secondary-foreground border border-border/50">
                      {crm.filteredLeads.filter((lead) => lead.stageId === stage.id).length}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="shadow-none border-border rounded-none lg:col-span-4 bg-primary text-primary-foreground border-transparent">
          <CardHeader className="border-b border-primary-foreground/10 pb-4">
            <CardTitle className="text-sm uppercase tracking-widest text-primary-foreground/90">Workload da Equipe</CardTitle>
            <CardDescription className="text-xs text-primary-foreground/70">Distribuição direta de responsabilidade</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-primary-foreground/10">
              {crm.workloadBySdr.map((sdr) => (
                <li key={sdr.id} className="flex items-center justify-between gap-3 px-6 py-4 text-sm">
                  <span className="font-semibold tracking-wide">{sdr.name}</span>
                  <span className="text-primary-foreground/80 font-mono text-xs">{sdr.total} ativos</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </AppLayout>
  )
}
