import { diaLocal } from '@/lib/diaLocal'
import { useEffect, useId, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTenant } from '@/context/TenantContext'
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
  return diaLocal(d)
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
  const { tenant } = useTenant()
  const fid = useId()
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
      tenant: tenant.id,
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
  }, [start, end, source, tenant.id])

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

  // Espelho da agenda congelado (cota da Shosp estourada, p.ex.) = número de
  // consulta desatualizado. Melhor avisar do que exibir foto velha como se fosse
  // o dado de hoje.
  const agendaAtrasada = (data?.agenda_sync?.dias_atras ?? 0) >= 1
  const ultimoSyncLabel = data?.agenda_sync?.ultimo_sync
    ? new Date(data.agenda_sync.ultimo_sync).toLocaleDateString('pt-BR')
    : '—'

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Painel de Performance · Funil Real</h2>
        <p className="text-xs text-muted-foreground">
          Conversão, perdas e gargalos cruzando o CRM com a agenda da Shosp (agendado → comparecido → no-show).
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/30 bg-muted/10 p-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fid}-start`} className="text-xs text-muted-foreground">De</Label>
          <Input id={`${fid}-start`} type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fid}-end`} className="text-xs text-muted-foreground">Até</Label>
          <Input id={`${fid}-end`} type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fid}-source`} className="text-xs text-muted-foreground">Origem</Label>
          <Select
            value={source || 'all'}
            onValueChange={(v) => v && setSource(v === 'all' ? '' : v)}
            items={SOURCE_OPTIONS.map((o) => ({ value: o.value || 'all', label: o.label }))}
          >
            <SelectTrigger id={`${fid}-source`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o.value || 'all'} value={o.value || 'all'}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-1">
          {QUICK_RANGES.map((q) => (
            <Button key={q.days} type="button" variant="outline" size="xs" onClick={() => applyQuick(q.days)}>
              {q.label}
            </Button>
          ))}
        </div>
        {loading && <span role="status" className="text-xs text-muted-foreground">Carregando…</span>}
      </div>

      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {agendaAtrasada && (
        <p role="alert" className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">
          Agenda da Shosp sem sincronizar há {data?.agenda_sync?.dias_atras} dia
          {(data?.agenda_sync?.dias_atras ?? 0) > 1 ? 's' : ''} (última atualização em {ultimoSyncLabel}). Os números de
          consulta abaixo são a foto daquela data, marcações e cancelamentos feitos depois ainda não entraram.
        </p>
      )}

      {/* Resumo, dois blocos com contas DIFERENTES, explicitados pra não se lerem
          como a mesma coisa: leads criados no período × consultas do período. */}
      <div className="flex flex-col gap-3">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Leads que entraram no período</p>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Leads" value={data?.summary.total_leads ?? 0} />
            <StatCard label="Ativos" value={data?.summary.ativos ?? 0} />
            <StatCard label="Perdidos" value={data?.summary.perdidos ?? 0} tone="text-destructive" />
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Consultas com data no período
            <span className="font-normal">
              , conta pelo dia em que a consulta acontece, não pelo dia em que foi marcada (a Shosp não informa quando o
              agendamento foi feito). São leads do CRM já vinculados a um paciente da Shosp.
            </span>
          </p>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Leads com consulta" value={sf?.leads_agendados ?? 0} tone="text-amber-600" />
            <StatCard label="Compareceram (estimado)" value={sf?.leads_comparecidos ?? 0} tone="text-emerald-600" />
            <StatCard label="No-show" value={sf?.leads_no_show ?? 0} tone="text-destructive" />
          </div>
          {/* A Shosp NÃO registra comparecimento: em toda a base só existem os status
              Agendado, Confirmado, Desmarcado e Faltou. "Compareceu" é sempre dedução, e
              como a dedução compara a hora de AGORA com um status que pode estar congelado,
              o número cresce sozinho: foi de 11 para 25 entre 09/07 e 28/07 sem nenhuma
              informação nova entrar. Isso é limite da fonte, não defeito do CRM, e a tela
              precisa dizer. */}
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            "Compareceram" é estimativa, não registro: a Shosp grava agendamento e cancelamento,
            nunca presença. O número deduz que a consulta aconteceu quando a data passou e ninguém
            cancelou, então ele sobe sozinho com o tempo, mesmo sem dado novo.
          </p>
        </div>
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
          <h3 className="mb-3 text-sm font-semibold">Gargalos · dias médios na etapa</h3>
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
