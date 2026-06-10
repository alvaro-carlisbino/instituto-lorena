import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts'

import { fetchShospAgendaMetrics, type ShospAgendaMetrics } from '@/services/analytics'

const RANGES = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '60 dias', days: 60 },
  { label: '90 dias', days: 90 },
]

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/30 bg-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  )
}

export function ShospAgendaMetricsPanel() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<ShospAgendaMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchShospAgendaMetrics(days)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Falha ao carregar métricas da agenda.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [days])

  const porMedico = useMemo(
    () => (data?.por_medico ?? []).map((m) => ({ name: m.prestador, total: m.total, cancelados: m.cancelados })),
    [data],
  )
  const porDia = useMemo(
    () => (data?.por_dia ?? []).map((d) => ({ name: d.dia.slice(5).split('-').reverse().join('/'), total: d.total })),
    [data],
  )

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Agenda Shosp — clínica</h2>
          <p className="text-xs text-muted-foreground">
            Agendamentos reais da Shosp (todos os médicos). Atenção: a Shosp registra agendamento/cancelamento, não comparecimento.
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={`rounded-md border px-2 py-1 text-xs ${days === r.days ? 'border-primary bg-primary/10 text-primary' : 'border-border/40 hover:bg-muted/40'}`}
            >
              {r.label}
            </button>
          ))}
          {loading && <span className="ml-1 text-xs text-muted-foreground">Carregando…</span>}
        </div>
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={`Agendamentos (${days}d)`} value={data?.total ?? 0} tone="text-emerald-600" />
        <Stat label="Cancelados" value={data?.cancelados ?? 0} tone="text-destructive" />
        <Stat label="Taxa cancelamento" value={`${data?.taxa_cancelamento_pct ?? 0}%`} />
        <Stat label="Médicos com agenda" value={(data?.por_medico ?? []).length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Carga por médico</h3>
          {porMedico.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Sem dados.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(180, porMedico.length * 32)}>
              <BarChart data={porMedico} layout="vertical" margin={{ left: 8, right: 32 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                <Bar dataKey="total" radius={[0, 6, 6, 0]} fill="oklch(0.638 0.12 250)">
                  <LabelList dataKey="total" position="right" style={{ fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border border-border/30 bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold">Agendamentos por dia</h3>
          {porDia.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Sem dados.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={porDia} margin={{ left: 0, right: 8, top: 8 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={Math.ceil(porDia.length / 12)} />
                <YAxis tick={{ fontSize: 10 }} width={28} />
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {porDia.map((_, i) => (
                    <Cell key={i} fill="oklch(0.7 0.12 160)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  )
}
