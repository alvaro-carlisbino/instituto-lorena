import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fetchAnalyticsV2, type AnalyticsV2 } from '@/services/analytics'

const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Todas as origens' },
  { value: 'meta_whatsapp', label: 'WhatsApp (ManyChat)' },
  { value: 'whatsapp', label: 'WhatsApp (W-API)' },
  { value: 'meta_instagram', label: 'Instagram' },
  { value: 'meta_facebook', label: 'Facebook' },
  { value: 'manual', label: 'Manual' },
]

const QUICK_RANGES = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
  { label: '12 meses', days: 365 },
]

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/30 bg-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  )
}

export function AnalyticsV2Panel() {
  const [end, setEnd] = useState<string>(isoDate(new Date()))
  const [start, setStart] = useState<string>(isoDate(new Date(Date.now() - 30 * 86400000)))
  const [source, setSource] = useState<string>('')
  const [data, setData] = useState<AnalyticsV2 | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchAnalyticsV2({
      start: new Date(`${start}T00:00:00`),
      end: new Date(`${end}T23:59:59`),
      source: source || null,
    })
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar métricas.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [start, end, source])

  const applyQuick = (days: number) => {
    setEnd(isoDate(new Date()))
    setStart(isoDate(new Date(Date.now() - days * 86400000)))
  }

  const sourceBars = useMemo(
    () =>
      (data?.by_source ?? []).map((s) => ({
        name: SOURCE_OPTIONS.find((o) => o.value === s.source)?.label ?? s.source,
        total: s.total,
        agendados: s.agendados,
        conversao: s.conversao_pct ?? 0,
      })),
    [data],
  )

  const gargalos = useMemo(
    () =>
      (data?.time_in_stage ?? [])
        .filter((t) => t.leads > 0)
        .slice(0, 8)
        .map((t) => ({ name: t.stage_name ?? t.stage_id, dias: t.avg_days, leads: t.leads })),
    [data],
  )

  const sf = data?.shosp_funnel

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Painel de Performance — Funil Real</h2>
        <p className="text-xs text-muted-foreground">
          Conversão, perdas e gargalos cruzando o CRM com a agenda da Shosp (agendado → comparecido → no-show).
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/30 bg-muted/10 p-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">De</span>
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="rounded-md border border-border/40 bg-background px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Até</span>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="rounded-md border border-border/40 bg-background px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Origem</span>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded-md border border-border/40 bg-background px-2 py-1 text-sm">
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-1">
          {QUICK_RANGES.map((q) => (
            <button key={q.days} type="button" onClick={() => applyQuick(q.days)} className="rounded-md border border-border/40 px-2 py-1 text-xs hover:bg-muted/40">
              {q.label}
            </button>
          ))}
        </div>
        {loading && <span className="text-xs text-muted-foreground">Carregando…</span>}
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Leads" value={data?.summary.total_leads ?? 0} />
        <StatCard label="Ativos" value={data?.summary.ativos ?? 0} />
        <StatCard label="Perdidos" value={data?.summary.perdidos ?? 0} tone="text-destructive" />
        <StatCard label="Agendados" value={sf?.leads_agendados ?? 0} tone="text-amber-600" />
        <StatCard label="Compareceram" value={sf?.leads_comparecidos ?? 0} tone="text-emerald-600" />
        <StatCard label="No-show" value={sf?.leads_no_show ?? 0} tone="text-destructive" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Conversão por origem */}
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Conversão por origem</h3>
          {sourceBars.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Sem dados no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full text-xs">
                <TableHeader>
                  <TableRow className="text-left text-muted-foreground">
                    <TableHead className="pb-2">Origem</TableHead>
                    <TableHead className="pb-2 text-right">Leads</TableHead>
                    <TableHead className="pb-2 text-right">Agendados</TableHead>
                    <TableHead className="pb-2 text-right">Conv. %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sourceBars.map((s) => (
                    <TableRow key={s.name} className="border-t border-border/20">
                      <TableCell className="py-1.5">{s.name}</TableCell>
                      <TableCell className="py-1.5 text-right">{s.total}</TableCell>
                      <TableCell className="py-1.5 text-right">{s.agendados}</TableCell>
                      <TableCell className="py-1.5 text-right font-semibold">{s.conversao.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Gargalos: tempo médio por etapa */}
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Gargalos — dias médios na etapa</h3>
          {gargalos.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Sem dados no período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, gargalos.length * 34)}>
              <BarChart data={gargalos} layout="vertical" margin={{ left: 8, right: 32 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                <Bar dataKey="dias" radius={[0, 6, 6, 0]}>
                  {gargalos.map((g, i) => (
                    <Cell key={i} fill={g.dias > 10 ? 'oklch(0.62 0.18 25)' : 'oklch(0.638 0.12 250)'} />
                  ))}
                  <LabelList dataKey="dias" position="right" formatter={(v) => `${v}d`} style={{ fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Performance por atendente */}
      <div className="rounded-xl border border-border/30 bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Performance por atendente</h3>
        {(data?.by_sdr ?? []).length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Sem dados no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full text-xs">
              <TableHeader>
                <TableRow className="text-left text-muted-foreground">
                  <TableHead className="pb-2">Atendente</TableHead>
                  <TableHead className="pb-2 text-right">Leads</TableHead>
                  <TableHead className="pb-2 text-right">Agendados</TableHead>
                  <TableHead className="pb-2 text-right">Perdidos</TableHead>
                  <TableHead className="pb-2 text-right">Conv. %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.by_sdr ?? []).map((s) => (
                  <TableRow key={s.owner_id ?? s.owner_name} className="border-t border-border/20">
                    <TableCell className="py-1.5">{s.owner_name}</TableCell>
                    <TableCell className="py-1.5 text-right">{s.total}</TableCell>
                    <TableCell className="py-1.5 text-right">{s.agendados}</TableCell>
                    <TableCell className="py-1.5 text-right text-destructive">{s.perdidos}</TableCell>
                    <TableCell className="py-1.5 text-right font-semibold">{(s.conversao_pct ?? 0).toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  )
}
