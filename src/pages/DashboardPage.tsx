import { useEffect, useMemo, useState } from 'react'
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
import { isSameLocalDayInTimezone } from '@/lib/sameLocalDayInTimezone'
import { labelForIdName } from '@/lib/selectDisplay'
import { fetchHandoffEventCountForTodayInTimezone } from '@/services/leadWaLineEvents'
import { fetchWhatsappChannelInstances } from '@/services/whatsappChannelInstances'
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

  const orgTz = crm.orgSettings.timezone || 'America/Sao_Paulo'
  const leadsNewToday = useMemo(
    () => crm.leads.filter((l) => isSameLocalDayInTimezone(l.createdAt, orgTz)),
    [crm.leads, orgTz],
  )
  const newWhatsappToday = useMemo(
    () => leadsNewToday.filter((l) => l.source === 'whatsapp'),
    [leadsNewToday],
  )
  const [lineLabels, setLineLabels] = useState<Record<string, string>>({})
  const [handoffsToday, setHandoffsToday] = useState(0)

  const newWaByLine = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of newWhatsappToday) {
      const k = l.whatsappInstanceId ?? '—'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return Array.from(m.entries())
      .map(([id, c]) => ({
        name: id === '—' ? 'Sem linha' : (lineLabels[id] ?? `Linha ${id.slice(0, 6)}…`),
        leads: c,
      }))
      .sort((a, b) => b.leads - a.leads)
  }, [newWhatsappToday, lineLabels])

  useEffect(() => {
    if (crm.dataMode !== 'supabase') {
      return
    }
    void fetchWhatsappChannelInstances().then((rows) => {
      setLineLabels(Object.fromEntries(rows.map((r) => [r.id, r.label])))
    })
  }, [crm.dataMode])

  useEffect(() => {
    if (crm.isLoading) return
    if (crm.dataMode !== 'supabase') {
      setHandoffsToday(0)
      return
    }
    void fetchHandoffEventCountForTodayInTimezone(orgTz).then(setHandoffsToday)
  }, [crm.isLoading, crm.dataMode, orgTz, crm.leads.length])

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
      title="Painel comercial"
      actions={
        <>
          {crm.currentPermission.canRouteLeads ? (
            <Link to="/kanban" className={cn(buttonVariants({ size: 'sm' }), 'inline-flex gap-1.5')}>
              <KanbanSquare className="size-4" />
              Abrir quadro
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
          title="Visão Geral"
          description="Acompanhe seus indicadores principais aqui."
          className="border-0 shadow-none mb-6"
        />
      ) : (
        <section className="grid gap-1 sm:grid-cols-2 xl:grid-cols-4 mb-6">
          {dashboardCards.map((card, index) => (
            <Card key={card.id} className={cn("border border-border/40 shadow-none bg-card transition-all duration-300 hover:bg-muted/20", index === 0 ? "xl:col-span-1 border-t-2 border-t-primary" : "")}>
              <CardHeader className="pb-4 pt-6 px-6">
                <CardDescription className="text-sm font-medium text-muted-foreground mb-2">{card.title}</CardDescription>
                <CardTitle className="text-5xl font-light tabular-nums tracking-tighter text-foreground">{getDashboardValue(card.metricKey)}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </section>
      )}

      {crm.currentPermission.canRouteLeads || crm.currentPermission.canManageUsers ? (
        <section className="mb-6 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border border-border/40 shadow-none bg-card hover:bg-muted/20 transition-colors">
            <CardHeader className="pb-4 pt-6 text-center">
              <CardTitle className="text-4xl font-light tabular-nums tracking-tight text-foreground">{leadsNewToday.length}</CardTitle>
              <CardDescription className="text-xs uppercase tracking-widest mt-2 font-medium">Novos leads hoje</CardDescription>
            </CardHeader>
          </Card>
          <Card className="border border-border/40 shadow-none bg-card hover:bg-muted/20 transition-colors">
            <CardHeader className="pb-4 pt-6 text-center">
              <CardTitle className="text-4xl font-light tabular-nums tracking-tight text-foreground">{newWhatsappToday.length}</CardTitle>
              <CardDescription className="text-xs uppercase tracking-widest mt-2 font-medium">Entradas via WhatsApp</CardDescription>
            </CardHeader>
          </Card>
          <Card className="border border-border/40 shadow-none bg-card hover:bg-muted/20 transition-colors">
            <CardHeader className="pb-4 pt-6 text-center">
              <CardTitle className="text-4xl font-light tabular-nums tracking-tight text-foreground">{handoffsToday}</CardTitle>
              <CardDescription className="text-xs uppercase tracking-widest mt-2 font-medium">Mudanças de linha</CardDescription>
            </CardHeader>
          </Card>
          <Card className="border border-border/40 shadow-none bg-card hover:bg-muted/20 transition-colors flex flex-col justify-center items-center text-center">
            <CardHeader className="pb-4 pt-6">
              <Link
                to="/admin-whatsapp"
                className="text-base font-medium text-primary underline-offset-4 hover:underline"
              >
                Gerenciar Linhas
              </Link>
              <CardDescription className="mt-2 text-xs uppercase tracking-widest font-medium">Roteamento por telefone</CardDescription>
            </CardHeader>
          </Card>
        </section>
      ) : null}

      {newWhatsappToday.length > 0 && (crm.currentPermission.canRouteLeads || crm.currentPermission.canManageUsers) ? (
        <Card className="mb-8 border-border shadow-none rounded-none">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-widest">WhatsApp: novos hoje (por linha)</CardTitle>
          </CardHeader>
          <CardContent>
            {newWaByLine.length > 0 ? (
              <div className="h-[min(20rem,24rem)] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <BarChart
                    data={newWaByLine}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                  >
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={120}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Bar dataKey="leads" radius={[0, 4, 4, 0]} maxBarSize={28}>
                      {newWaByLine.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {crm.captureNotice ? (
        <p className="rounded-lg border border-success/35 bg-success/10 px-4 py-3 text-sm text-success-foreground">
          {crm.captureNotice}
        </p>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-12 mt-8">
        <Card className="shadow-none border border-border/40 lg:col-span-8">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 pb-6">
            <div className="min-w-0">
              <CardTitle className="text-lg font-medium text-foreground">Funil de Triagem</CardTitle>
              <CardDescription className="mt-1">Visão atual do andamento dos leads</CardDescription>
            </div>
            <Select
              value={crm.selectedPipelineId}
              onValueChange={(value) => {
                if (value) crm.setSelectedPipelineId(value)
              }}
            >
              <LabeledSelectTrigger className="w-[min(100%,16rem)] border-border/40 font-medium bg-muted/20" size="sm">
                {pipelineSelectLabel}
              </LabeledSelectTrigger>
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
                description="Adicione etapas ao funil em 'Funis e etapas'."
                className="py-4"
              />
            ) : (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
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

        <Card className="shadow-none border border-border/40 lg:col-span-4 bg-card">
          <CardHeader className="pb-6">
            <CardTitle className="text-lg font-medium text-foreground">Carga da Equipe</CardTitle>
            <CardDescription className="mt-1">Distribuição de leads por atendente</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {crm.workloadBySdr.length === 0 ? (
              <EmptyState
                icon={UsersIcon}
                title="Nenhum atendente ativo"
                description="Adicione membros à equipe e atribua leads."
                className="py-8 text-primary-foreground [&_p]:text-primary-foreground/70 [&_*]:text-primary-foreground/70"
              />
            ) : (
              <div className="px-4 py-4">
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <BarChart data={workloadData} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 13, fill: 'currentColor', fontWeight: 500 }} axisLine={false} tickLine={false} />
                      <Bar dataKey="leads" radius={[0, 4, 4, 0]} maxBarSize={28} fill="currentColor" className="fill-primary/20">
                        <LabelList dataKey="leads" position="right" style={{ fontSize: 13, fontWeight: 600, fill: 'currentColor' }} />
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
