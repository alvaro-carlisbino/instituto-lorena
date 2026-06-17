import { useEffect, useMemo } from 'react'
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
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { useCrm } from '@/context/CrmContext'
import { AppLayout } from '@/layouts/AppLayout'
import { labelForIdName } from '@/lib/selectDisplay'
import { PendingHumanHandoffPanel } from '@/components/dashboard/PendingHumanHandoffPanel'
import { DashboardKpiSection } from '@/components/dashboard/DashboardKpiSection'
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

  const pipelineSelectLabel = useMemo(
    () =>
      labelForIdName(
        crm.selectedPipelineId,
        crm.pipelineCatalog.map((p) => ({ id: p.id, name: p.name })),
        undefined,
        'Funil',
      ),
    [crm.selectedPipelineId, crm.pipelineCatalog],
  )

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

  useEffect(() => {
    const list = crm.pipelineCatalog
    if (list.length === 0) return
    if (!list.some((p) => p.id === crm.selectedPipelineId)) {
      void crm.setSelectedPipelineId(list[0]!.id)
    }
  }, [crm.pipelineCatalog, crm.selectedPipelineId, crm.setSelectedPipelineId])

  if (crm.isLoading) {
    return (
      <AppLayout title="Painel comercial">
        <SkeletonBlocks rows={8} />
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Painel de Performance"
      actions={
        <div className="flex items-center gap-2">
          {crm.currentPermission.canRouteLeads ? (
            <Link to="/kanban" className={cn(buttonVariants({ size: 'sm' }), 'bg-primary/90 hover:bg-primary shadow-lg shadow-primary/20 transition-all active:scale-95 rounded-xl px-4')}>
              <KanbanSquare className="size-4 mr-2" />
              Ver Quadro
            </Link>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'rounded-xl border-border/40 bg-background/50 backdrop-blur-sm')}
            >
              <MoreHorizontal className="size-4 mr-2" />
              Ações
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56 rounded-xl p-2">
              {crm.currentPermission.canRouteLeads ? (
                <DropdownMenuItem onClick={() => navigate('/dashboard-config')} className="rounded-lg py-2">
                  <SlidersHorizontal className="size-4 mr-2" />
                  Customizar Widgets
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => navigate('/configuracoes')} className="rounded-lg py-2">
                Configurações do Sistema
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={crm.isLoading || !canSync}
                onClick={() => void crm.syncFromSupabase()}
                className="rounded-lg py-2 text-primary font-medium"
              >
                <RefreshCw className={cn('size-4 mr-2', crm.isLoading && 'animate-spin')} />
                {crm.isLoading ? 'Sincronizando…' : 'Sincronizar Agora'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <section className="mb-6">
        <PendingHumanHandoffPanel />
      </section>

      <DashboardKpiSection />

      <section className="grid gap-8 lg:grid-cols-12">
        <Card className="rounded-[2rem] border-border/30 bg-card/40 shadow-sm lg:col-span-8 overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-4 p-8 border-b border-border/10">
            <div className="min-w-0">
              <CardTitle className="text-xl font-black tracking-tight text-foreground/90">Funil de Vendas</CardTitle>
              <CardDescription className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/50 mt-1">Volume de leads por estágio</CardDescription>
            </div>
            <Select
              value={crm.selectedPipelineId}
              onValueChange={(value) => {
                if (value) crm.setSelectedPipelineId(value)
              }}
            >
              <LabeledSelectTrigger className="w-[180px] rounded-xl border-border/40 bg-muted/40 text-[10px] font-black uppercase tracking-widest" size="sm">
                {pipelineSelectLabel}
              </LabeledSelectTrigger>
              <SelectContent className="rounded-xl p-2">
                {crm.pipelineCatalog.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id} className="rounded-lg text-[10px] font-bold uppercase">
                    {pipeline.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-8">
            {crm.selectedPipeline.stages.length === 0 ? (
              <EmptyState
                icon={LayoutListIcon}
                title="Funil não configurado"
                description="Configure as etapas do seu processo comercial para começar a medir a conversão."
                className="py-12"
              />
            ) : (
              <div className="h-[300px] w-full min-h-[240px] min-w-0">
                <ResponsiveContainer width="100%" height="100%" minHeight={240} minWidth={0}>
                  <BarChart data={funnelData} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      tick={{ fontSize: 10, fontWeight: 800, fill: 'currentColor' }}
                      axisLine={false}
                      tickLine={false}
                      className="text-muted-foreground/60 uppercase tracking-tighter"
                    />
                    <Bar dataKey="leads" radius={[0, 10, 10, 0]} maxBarSize={40}>
                      {funnelData.map((_entry, index) => (
                        <Cell 
                          key={index} 
                          fill={CHART_COLORS[index % CHART_COLORS.length]} 
                          className="transition-all duration-500 hover:opacity-80"
                        />
                      ))}
                      <LabelList 
                        dataKey="leads" 
                        position="right" 
                        className="fill-foreground/80 text-[14px] font-black tabular-nums"
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border-border/30 bg-card/40 shadow-sm lg:col-span-4 overflow-hidden flex flex-col">
          <CardHeader className="p-8 border-b border-border/10">
            <CardTitle className="text-xl font-black tracking-tight text-foreground/90">Top SDRs</CardTitle>
            <CardDescription className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/50 mt-1">Produtividade individual</CardDescription>
          </CardHeader>
          <CardContent className="p-8 flex-1 flex flex-col">
            {crm.workloadBySdr.length === 0 ? (
              <EmptyState
                icon={UsersIcon}
                title="Sem dados de equipe"
                description="A produtividade por SDR aparece quando houver leads atribuídos."
                className="flex-1 py-16"
              />
            ) : (
              <div className="h-[300px] w-full min-h-[240px] min-w-0">
                <ResponsiveContainer width="100%" height="100%" minHeight={240} minWidth={0}>
                  <BarChart data={workloadData} layout="vertical" margin={{ left: 0, right: 30, top: 0, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={80}
                      tick={{ fontSize: 10, fontWeight: 700, fill: 'currentColor' }}
                      axisLine={false}
                      tickLine={false}
                      className="text-muted-foreground/60 uppercase tracking-tighter"
                    />
                    <Bar dataKey="leads" radius={[0, 8, 8, 0]} maxBarSize={30} className="fill-primary/20">
                      <LabelList dataKey="leads" position="right" className="fill-primary font-black tabular-nums text-[12px]" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </AppLayout>
  )
}
