import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnalyticsV2Panel } from '@/components/analytics/AnalyticsV2Panel'
import { ShospAgendaMetricsPanel } from '@/components/analytics/ShospAgendaMetricsPanel'
import { AppLayout } from '@/layouts/AppLayout'
import {
  fetchTenantAnalytics,
  type AnalyticsPayload,
} from '@/services/analytics'

const PERIODS = [
  { label: '7 dias', value: 7 },
  { label: '30 dias', value: 30 },
  { label: '90 dias', value: 90 },
  { label: '12 meses', value: 365 },
]

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="pt-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

function PercentBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-12 text-right text-xs tabular-nums">{value}</span>
    </div>
  )
}

export function AnalyticsPage() {
  const [period, setPeriod] = useState<number>(30)
  const [loading, setLoading] = useState<boolean>(false)
  const [data, setData] = useState<AnalyticsPayload | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchTenantAnalytics(period)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao carregar analytics.'))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period])

  const funnelByPipeline = useMemo(() => {
    const map: Record<string, { name: string; stages: AnalyticsPayload['funnel'] }> = {}
    if (!data) return map
    for (const row of data.funnel) {
      if (!map[row.pipeline_id]) {
        map[row.pipeline_id] = { name: row.pipeline_name, stages: [] }
      }
      map[row.pipeline_id].stages.push(row)
    }
    return map
  }, [data])

  const maxFunnelCount = useMemo(() => {
    if (!data) return 0
    return Math.max(1, ...data.funnel.map((s) => s.count))
  }, [data])

  const maxLostCount = useMemo(() => {
    if (!data) return 0
    return Math.max(1, ...data.lost_reasons.map((r) => r.count))
  }, [data])

  return (
    <AppLayout title="Analytics">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Analytics</h1>
            <p className="text-xs text-muted-foreground">
              Conversão, perdas e gargalos do funil — filtrado pela clínica atual, excluindo leads marcados como
              "fora das métricas".
            </p>
          </div>
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                size="sm"
                variant={period === p.value ? 'default' : 'outline'}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <AnalyticsV2Panel />

        <div className="border-t border-border/30 pt-2" />
        <ShospAgendaMetricsPanel />

        <div className="border-t border-border/30 pt-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Resumo clássico</h2>
        </div>

        {loading && !data ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">Carregando…</CardContent>
          </Card>
        ) : null}

        {data ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Total no período" value={data.summary.total_leads} />
              <StatCard
                label="Ativos"
                value={data.summary.total_active}
                hint={`${data.summary.total_leads > 0 ? Math.round((data.summary.total_active / data.summary.total_leads) * 100) : 0}% do total`}
              />
              <StatCard
                label="Perdidos"
                value={data.summary.total_lost}
                hint={`${data.summary.total_leads > 0 ? Math.round((data.summary.total_lost / data.summary.total_leads) * 100) : 0}% do total`}
              />
              <StatCard label="Excluídos das métricas" value={data.summary.total_excluded} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Funil por pipeline */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Funil de conversão</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {Object.entries(funnelByPipeline).length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum funil configurado.</p>
                  ) : (
                    Object.entries(funnelByPipeline).map(([pid, group]) => (
                      <div key={pid} className="grid gap-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {group.name}
                        </p>
                        {group.stages.map((s) => (
                          <div key={s.stage_id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                            <p className="truncate text-xs">{s.stage_name}</p>
                            <PercentBar value={s.count} max={maxFunnelCount} color="#0ea5e9" />
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Motivos de perda */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Por que perdemos leads</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {data.lost_reasons.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum lead perdido com motivo registrado no período.</p>
                  ) : (
                    data.lost_reasons.map((r) => (
                      <div key={r.reason} className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <p className="truncate text-xs">{r.reason}</p>
                        <PercentBar value={r.count} max={maxLostCount} color="#ef4444" />
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Leads parados */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Parados há mais de 3 dias</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.stuck_leads.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum lead parado — bom sinal.</p>
                  ) : (
                    <ul className="divide-y divide-border/40">
                      {data.stuck_leads.map((l) => (
                        <li key={l.lead_id} className="flex items-center justify-between py-2 text-xs">
                          <span className="truncate">{l.patient_name || '(sem nome)'}</span>
                          <span className="text-muted-foreground tabular-nums">{l.days_in_stage}d</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Por SDR */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Por SDR</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.by_sdr.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum dado.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="pb-1 font-semibold">SDR</th>
                          <th className="pb-1 text-right font-semibold">Leads</th>
                          <th className="pb-1 text-right font-semibold">Perdidos</th>
                          <th className="pb-1 text-right font-semibold">Conv.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {data.by_sdr.map((s) => (
                          <tr key={s.sdr_id}>
                            <td className="py-1 truncate">{s.sdr_name}</td>
                            <td className="py-1 text-right tabular-nums">{s.total_leads}</td>
                            <td className="py-1 text-right tabular-nums">{s.lost_leads}</td>
                            <td className="py-1 text-right tabular-nums">{s.conversion_pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </AppLayout>
  )
}
