import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, BotIcon, CalendarCheck2, TrendingUp, UsersIcon } from 'lucide-react'

import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { sourceLabel } from '@/mocks/crmMock'
import {
  fetchLeadIdsWithAppointment,
  fetchShospAppointmentsBetween,
  type ShospApptRow,
} from '@/services/analytics'
import { cn } from '@/lib/utils'

type RangeKey = 'today' | '7d' | '30d'

const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: 'today', label: 'Hoje', days: 1 },
  { key: '7d', label: '7 dias', days: 7 },
  { key: '30d', label: '30 dias', days: 30 },
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
/** YYYY-MM-DD em horário local (não UTC, pra não deslocar o dia). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

/** Janela atual + janela anterior de mesmo tamanho (para a tendência). */
function windowFor(key: RangeKey): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  const now = new Date()
  if (key === 'today') {
    const start = startOfDay(now)
    const prevStart = startOfDay(new Date(start.getTime() - 1))
    const prevEnd = new Date(start.getTime() - 1)
    return { start, end: now, prevStart, prevEnd }
  }
  const days = key === '7d' ? 7 : 30
  const span = days * 86_400_000
  const start = startOfDay(new Date(now.getTime() - span))
  const prevEnd = new Date(start.getTime() - 1)
  const prevStart = startOfDay(new Date(prevEnd.getTime() - span))
  return { start, end: now, prevStart, prevEnd }
}

type ApptBucket = { agendadas: number; faltas: number; desmarcadas: number }

function bucketAppts(rows: ShospApptRow[], startYmd: string, endYmd: string): ApptBucket {
  const b: ApptBucket = { agendadas: 0, faltas: 0, desmarcadas: 0 }
  for (const r of rows) {
    if (r.data < startYmd || r.data > endYmd) continue
    const s = (r.status ?? '').toLowerCase()
    if (s.startsWith('agendad') || s.startsWith('confirmad')) b.agendadas += 1
    else if (s.startsWith('falt')) b.faltas += 1
    else if (s.startsWith('cancelad') || s.startsWith('desmarc')) b.desmarcadas += 1
  }
  return b
}

type Trend = { dir: 'up' | 'down' | 'flat'; text: string; good: boolean }

function trendCount(curr: number, prev: number): Trend {
  const delta = curr - prev
  if (delta === 0) return { dir: 'flat', text: 'estável', good: true }
  const pct = prev > 0 ? Math.round((delta / prev) * 100) : null
  const text = pct === null ? `${delta > 0 ? '+' : ''}${delta}` : `${delta > 0 ? '+' : ''}${pct}%`
  return { dir: delta > 0 ? 'up' : 'down', text, good: delta > 0 }
}

function trendPP(curr: number, prev: number): Trend {
  const delta = Math.round((curr - prev) * 10) / 10
  if (delta === 0) return { dir: 'flat', text: 'estável', good: true }
  return { dir: delta > 0 ? 'up' : 'down', text: `${delta > 0 ? '+' : ''}${delta}pp`, good: delta > 0 }
}

function TrendChip({ trend }: { trend: Trend | null }) {
  if (!trend) return null
  const Icon = trend.dir === 'down' ? ArrowDownRight : ArrowUpRight
  const tone = trend.dir === 'flat' ? 'text-muted-foreground/60' : trend.good ? 'text-emerald-600' : 'text-rose-500'
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums', tone)}>
      {trend.dir !== 'flat' ? <Icon className="size-3" /> : null}
      {trend.text}
    </span>
  )
}

function KpiCard({
  label,
  value,
  sub,
  trend,
  icon: Icon,
  loading,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  trend?: Trend | null
  icon: typeof UsersIcon
  loading?: boolean
  accent?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/40 bg-card/60 p-6 backdrop-blur-sm transition-all duration-300 hover:bg-card hover:shadow-xl hover:-translate-y-0.5">
      <div className="absolute top-0 right-0 p-5 opacity-[0.04]">
        <Icon className="size-16" />
      </div>
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground/60">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn('text-4xl font-black tracking-tighter tabular-nums', accent ?? 'text-foreground')}>
          {loading ? '—' : value}
        </span>
        {!loading ? <TrendChip trend={trend ?? null} /> : null}
      </div>
      {sub ? <p className="mt-1.5 text-[12px] font-medium text-muted-foreground/70">{loading ? ' ' : sub}</p> : null}
    </div>
  )
}

export function DashboardKpiSection() {
  const crm = useCrm()
  const { tenant } = useTenant()
  const [range, setRange] = useState<RangeKey>('7d')
  const [appts, setAppts] = useState<ShospApptRow[]>([])
  const [linkedLeadIds, setLinkedLeadIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const win = useMemo(() => windowFor(range), [range])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      fetchShospAppointmentsBetween(ymd(win.prevStart), ymd(win.end)),
      fetchLeadIdsWithAppointment(),
    ])
      .then(([rows, linked]) => {
        if (cancelled) return
        setAppts(rows)
        setLinkedLeadIds(linked)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar a agenda.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [win])

  // Consultas (agenda real da clínica) — atual vs período anterior.
  const apptCurr = useMemo(() => bucketAppts(appts, ymd(win.start), ymd(win.end)), [appts, win])

  // Leads (já escopados por polo via RLS) criados na janela.
  const startMs = win.start.getTime()
  const endMs = win.end.getTime()
  const prevStartMs = win.prevStart.getTime()
  const prevEndMs = win.prevEnd.getTime()

  const novosCurr = useMemo(
    () => crm.leads.filter((l) => {
      const t = new Date(l.createdAt).getTime()
      return t >= startMs && t <= endMs
    }),
    [crm.leads, startMs, endMs],
  )
  const novosPrev = useMemo(
    () => crm.leads.filter((l) => {
      const t = new Date(l.createdAt).getTime()
      return t >= prevStartMs && t <= prevEndMs
    }),
    [crm.leads, prevStartMs, prevEndMs],
  )
  const novosPrevCount = novosPrev.length

  // Conversão lead → consulta (atribuída): novos leads que vincularam uma consulta.
  const pct = (linked: number, total: number) => (total > 0 ? Math.round((linked / total) * 1000) / 10 : 0)
  const vinculados = useMemo(
    () => novosCurr.filter((l) => linkedLeadIds.has(l.id)).length,
    [novosCurr, linkedLeadIds],
  )
  const vinculadosPrev = useMemo(
    () => novosPrev.filter((l) => linkedLeadIds.has(l.id)).length,
    [novosPrev, linkedLeadIds],
  )
  const conversao = pct(vinculados, novosCurr.length)
  const conversaoPrev = pct(vinculadosPrev, novosPrevCount)

  // Aguardando consultor: derivado das interactions via RPC (mesma fonte do card de
  // Atendimento Pendente). conversation_status='waiting_human' nunca acende p/ a clínica,
  // então contar por ele dava 0 falso. Em modo mock cai no filtro de crm.leads.
  const [pendingHandoff, setPendingHandoff] = useState<number | null>(null)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return
    const sb = supabase
    let cancelled = false
    const fetchCount = async () => {
      const { data, error } = await sb.rpc('crm_pending_human_handoff', { p_window_hours: 48 })
      if (cancelled || error) return
      setPendingHandoff(Array.isArray(data) ? data.length : 0)
    }
    void fetchCount()
    const id = window.setInterval(fetchCount, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
    // tenant.id: re-conta ao trocar de workspace.
  }, [tenant.id])

  // Saúde da IA — snapshot ao vivo, ISOLADO ao polo ativo. crm.leads traz os dois
  // polos por RLS (p/ quem é multi-polo), então filtramos por tenant pra não somar
  // a triagem do Tricopill na visão da Clínica (era o "52 em triagem" cruzado).
  const aiHealth = useMemo(() => {
    const ofPolo = crm.leads.filter((l) => !l.tenantId || l.tenantId === tenant.id)
    const fallbackWaiting = ofPolo.filter((l) => l.conversation_status === 'waiting_human').length
    const waiting = isSupabaseConfigured && pendingHandoff !== null ? pendingHandoff : fallbackWaiting
    const inAi = ofPolo.filter((l) => l.conversation_status === 'ai_triaging').length
    return { waiting, inAi }
  }, [crm.leads, pendingHandoff, tenant.id])

  // Novos leads por origem.
  const origemRows = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of novosCurr) counts.set(l.source, (counts.get(l.source) ?? 0) + 1)
    return [...counts.entries()]
      .map(([source, total]) => ({ label: sourceLabel[source as keyof typeof sourceLabel] ?? source, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  }, [novosCurr])
  const maxOrigem = Math.max(1, ...origemRows.map((r) => r.total))
  const topSource = origemRows[0] ?? null

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/50">
          Indicadores do período
        </h3>
        <div className="inline-flex rounded-xl border border-border/40 bg-muted/30 p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={cn(
                'rounded-lg px-3 py-1 text-[11px] font-black uppercase tracking-wider transition-all',
                range === r.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground/60 hover:text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Consultas agendadas"
          value={apptCurr.agendadas}
          sub={
            apptCurr.faltas + apptCurr.desmarcadas > 0
              ? `${apptCurr.faltas} faltas • ${apptCurr.desmarcadas} desmarcadas`
              : 'agenda da clínica (Shosp)'
          }
          icon={CalendarCheck2}
          loading={loading}
        />
        <KpiCard
          label="Conversão lead → consulta"
          value={`${conversao}%`}
          sub={`${vinculados} de ${novosCurr.length} novos leads vincularam consulta`}
          trend={trendPP(conversao, conversaoPrev)}
          icon={TrendingUp}
          loading={loading}
        />
        <KpiCard
          label="Novos leads"
          value={novosCurr.length}
          sub={topSource ? `Top: ${topSource.label} (${topSource.total})` : 'Sem entradas no período'}
          trend={trendCount(novosCurr.length, novosPrevCount)}
          icon={UsersIcon}
          loading={loading}
        />
        <KpiCard
          label="Saúde da IA"
          value={aiHealth.waiting}
          sub={
            aiHealth.waiting === 0
              ? `IA em dia • ${aiHealth.inAi} em triagem`
              : `aguardando consultor • ${aiHealth.inAi} em triagem`
          }
          icon={BotIcon}
          accent={aiHealth.waiting === 0 ? 'text-emerald-600' : 'text-amber-600'}
        />
      </div>

      <div className="mt-4 rounded-3xl border border-border/40 bg-card/40 p-6">
        <p className="mb-4 text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground/50">
          Novos leads por origem
        </p>
        {origemRows.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground/60">Sem entradas no período selecionado.</p>
        ) : (
          <div className="grid gap-3">
            {origemRows.map((r) => (
              <div key={r.label} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3">
                <span className="truncate text-xs font-semibold text-foreground/80">{r.label}</span>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70 transition-all duration-500"
                    style={{ width: `${(r.total / maxOrigem) * 100}%` }}
                  />
                </div>
                <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground/70">
                  <span className="font-bold text-foreground/80">{r.total}</span> leads
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
