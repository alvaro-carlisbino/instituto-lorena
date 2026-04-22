import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KanbanSquare, LayoutListIcon, MoreHorizontal, RefreshCw, SlidersHorizontal, UsersIcon } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, LabelList } from 'recharts'

import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
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

const CHART_COLORS = [
  'oklch(0.638 0.065 44)',
  'oklch(0.58 0.08 240)',
  'oklch(0.58 0.11 152)',
  'oklch(0.72 0.09 48)',
  'oklch(0.82 0.14 82)',
  'oklch(0.52 0.19 25)',
]

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

  const funnelData = useMemo(() =>
    crm.selectedPipeline.stages.map((stage) => ({
      name: stage.name,
      leads: crm.filteredLeads.filter((lead) => lead.stageId === stage.id).length,
    })),
    [crm.selectedPipeline.stages, crm.filteredLeads],
  )

  const workloadData = useMemo(() =>
    crm.workloadBySdr.map((sdr) => ({
      name: sdr.name,
      leads: sdr.total,
    })),
    [crm.workloadBySdr],
  )

  if (crm.isLoading) {
    return (
      <AppLayout title="Dashboard comercial" subtitle="Carregando dados...">
        <SkeletonBlocks rows={8} />
      </AppLayout>
    )
  }

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
                <RefreshCw className={cn('size-4', crm.isLoading && 'animate-spin')} />
                {crm.isLoading ? 'Sincronizando…' : 'Sincronizar dados'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      {dashboardCards.length === 0 ? (
        <EmptyState
          icon={LayoutListIcon}
          title="Nenhum widget ativo"
          description="Configure os indicadores do dashboard em 'Ajustar widgets'."
          className="border border-border rounded-none"
        />
      ) : (
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
      )}

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
          <CardContent className="p-6">
            {crm.selectedPipeline.stages.length === 0 ? (
              <EmptyState
                icon={LayoutListIcon}
                title="Nenhuma etapa configurada"
                description="Adicione etapas ao pipeline em 'Boards e pipelines'."
                className="py-4"
              />
            ) : (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelData} layout="vertical" margin={{ left: 0, right: 24, top: 8, bottom: 8 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <Bar dataKey="leads" radius={[0, 4, 4, 0]} maxBarSize={36}>
                      {funnelData.map((_entry, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                      <LabelList dataKey="leads" position="right" style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-none border-border rounded-none lg:col-span-4 bg-primary text-primary-foreground border-transparent">
          <CardHeader className="border-b border-primary-foreground/10 pb-4">
            <CardTitle className="text-sm uppercase tracking-widest text-primary-foreground/90">Workload da Equipe</CardTitle>
            <CardDescription className="text-xs text-primary-foreground/70">Distribuição direta de responsabilidade</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {crm.workloadBySdr.length === 0 ? (
              <EmptyState
                icon={UsersIcon}
                title="Nenhum SDR ativo"
                description="Adicione membros à equipe e atribua leads."
                className="py-8 text-primary-foreground [&_p]:text-primary-foreground/70 [&_*]:text-primary-foreground/70"
              />
            ) : (
              <div className="px-4 py-4">
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={workloadData} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.85)' }} axisLine={false} tickLine={false} />
                      <Bar dataKey="leads" radius={[0, 4, 4, 0]} maxBarSize={28} fill="rgba(255,255,255,0.25)">
                        <LabelList dataKey="leads" position="right" style={{ fontSize: 12, fontWeight: 700, fill: 'rgba(255,255,255,0.9)', fontFamily: 'monospace' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </AppLayout>
  )
}
