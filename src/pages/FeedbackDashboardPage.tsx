import { useEffect, useState } from 'react'
import { RefreshCw, Star, MessageSquare, ThumbsUp, ThumbsDown, Smile } from 'lucide-react'

import { toast } from 'sonner'

import { AppLayout } from '@/layouts/AppLayout'
import { StatCard } from '@/components/page/StatCard'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { useTenant } from '@/context/TenantContext'
import { useCrm } from '@/context/CrmContext'
import { fetchFeedbackAnalytics, type FeedbackAnalytics } from '@/services/feedbackAnalytics'
import { cn } from '@/lib/utils'
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

const RANGES = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
]

function npsTone(nps: number | null): string {
  if (nps == null) return 'text-foreground'
  if (nps >= 50) return 'text-emerald-600'
  if (nps >= 0) return 'text-amber-600'
  return 'text-red-600'
}

function scoreBadge(score: number | null) {
  if (score == null) return <Badge variant="outline">sem nota</Badge>
  if (score >= 9) return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{score} · promotor</Badge>
  if (score >= 7) return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{score} · neutro</Badge>
  return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">{score} · detrator</Badge>
}

export function FeedbackDashboardPage() {
  const { tenant } = useTenant()
  const crm = useCrm()
  const canWrite = crm.currentPermission?.canRouteLeads ?? false
  const [days, setDays] = useState(30)
  const [data, setData] = useState<FeedbackAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Registro manual de resposta de pesquisa (migrado da antiga tela "Tarefas e NPS":
  // Feedback e NPS agora é a fonte única de NPS).
  const [npsScore, setNpsScore] = useState('9')
  const [npsComment, setNpsComment] = useState('')
  const [npsDispatchId, setNpsDispatchId] = useState('')

  const recordNps = () => {
    const id = npsDispatchId.trim()
    if (!id) {
      toast.error('Informe o código da pesquisa enviada.')
      return
    }
    const score = Math.min(10, Math.max(0, Math.round(Number(npsScore))))
    crm.recordSurveyResponse(id, score, npsComment.trim() || null)
    toast.success('Resposta NPS registrada.')
    setNpsComment('')
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchFeedbackAnalytics(tenant.id, days)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tenant.id, days])

  const refresh = () => {
    setLoading(true)
    fetchFeedbackAnalytics(tenant.id, days)
      .then((d) => setData(d)).catch((e) => setError(e instanceof Error ? e.message : 'Falha')).finally(() => setLoading(false))
  }

  return (
    <AppLayout
      title="Feedback e NPS"
      subtitle={`Avaliações dos clientes · ${tenant.name ?? tenant.id}`}
      actions={
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg border border-border p-0.5">
            {RANGES.map((r) => (
              <Button
                key={r.days}
                type="button"
                size="xs"
                variant={days === r.days ? 'default' : 'ghost'}
                aria-pressed={days === r.days}
                onClick={() => setDays(r.days)}
                className={cn(
                  'rounded-md px-2.5 font-semibold',
                  days !== r.days && 'text-muted-foreground hover:text-foreground',
                )}
              >
                {r.label}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Atualizar</Button>
        </div>
      }
    >
      {error ? (
        <EmptyState title="Não foi possível carregar" description={error} />
      ) : loading && !data ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando avaliações…</p>
      ) : !data || data.total === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Ainda sem avaliações no período"
          description="Quando os clientes responderem a pesquisa (nota + comentário), os números aparecem aqui."
        />
      ) : (
        <div className="space-y-8 mb-8">
          {/* KPIs */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Respostas" value={data.total} icon={<Star className="h-3.5 w-3.5" aria-hidden />} hint={`${data.comComentario} com comentário`} />
            <StatCard label="NPS" value={data.nps ?? '—'} valueClassName={npsTone(data.nps)} hint="promotores − detratores" />
            <StatCard label="Nota média" value={data.media ?? '—'} hint="de 0 a 10" />
            <StatCard label="Promotores" value={data.promotores} valueClassName="text-emerald-600" icon={<ThumbsUp className="h-3.5 w-3.5" aria-hidden />} hint="nota 9-10" />
            <StatCard label="Neutros" value={data.neutros} valueClassName="text-amber-600" icon={<Smile className="h-3.5 w-3.5" aria-hidden />} hint="nota 7-8" />
            <StatCard label="Detratores" value={data.detratores} valueClassName="text-red-600" icon={<ThumbsDown className="h-3.5 w-3.5" aria-hidden />} hint="nota 0-6" />
          </section>

          <section className="grid gap-4 lg:grid-cols-12">
            {/* Tendência */}
            <div className="rounded-xl border border-border bg-card p-5 lg:col-span-8">
              <p className="mb-4 text-sm font-semibold text-foreground">Respostas e NPS por dia</p>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={data.serie}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" domain={[-100, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar yAxisId="left" dataKey="respostas" name="Respostas" fill="oklch(0.638 0.065 44)" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="nps" name="NPS" stroke="#059669" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Por canal */}
            <div className="rounded-xl border border-border bg-card p-5 lg:col-span-4">
              <p className="mb-3 text-sm font-semibold text-foreground">Por canal</p>
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Canal</TableHead>
                    <TableHead className="text-right">Nº</TableHead>
                    <TableHead className="text-right">Média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.porCanal.map((c) => (
                    <TableRow key={c.chave}>
                      <TableCell className="font-medium">{c.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.n}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.media || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {/* Comentários */}
          <section className="rounded-xl border border-border bg-card p-5">
            <p className="mb-3 text-sm font-semibold text-foreground">Comentários recentes</p>
            {data.comentarios.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum comentário no período.</p>
            ) : (
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Nota</TableHead>
                    <TableHead className="w-40">Cliente</TableHead>
                    <TableHead>Comentário</TableHead>
                    <TableHead className="w-28 text-right">Quando</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.comentarios.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell>{scoreBadge(c.score)}</TableCell>
                      <TableCell className="font-medium">{c.nome}</TableCell>
                      <TableCell className="text-muted-foreground">"{c.comment}"</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {new Date(c.quando).toLocaleDateString('pt-BR')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      )}

      {/* Registro manual de resposta de pesquisa (migrado de Tarefas) */}
      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrar resposta manualmente</CardTitle>
          </CardHeader>
          <CardContent className="grid max-w-md gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="dispatch-id">Código da pesquisa</Label>
              <Input id="dispatch-id" value={npsDispatchId} onChange={(e) => setNpsDispatchId(e.target.value)} placeholder="disp-…" />
            </div>
            <div className="grid gap-1.5">
              <Label>Nota</Label>
              <Select value={npsScore} onValueChange={(v) => v && setNpsScore(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 11 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {i}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nps-comment">Comentário (opcional)</Label>
              <Input id="nps-comment" value={npsComment} onChange={(e) => setNpsComment(e.target.value)} />
            </div>
            <Button type="button" onClick={recordNps}>
              Salvar resposta
            </Button>
            {crm.surveyDispatches.length > 0 ? (
              <div className="mt-4 border-t border-border pt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Pesquisas recentes (copie o código)</p>
                <ul className="m-0 max-h-40 list-none space-y-1 overflow-y-auto p-0 font-mono text-[11px]">
                  {crm.surveyDispatches.slice(0, 12).map((d) => {
                    const tpl = crm.surveyTemplates.find((t) => t.id === d.templateId)
                    return (
                      <li key={d.id} className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                        <div className="min-w-0">
                          <Button
                            type="button"
                            variant="link"
                            size="xs"
                            onClick={() => setNpsDispatchId(d.id)}
                            aria-label={`Usar o código ${d.id}`}
                            className="h-auto w-full min-w-0 justify-start p-0 font-mono text-[10px] font-normal underline"
                          >
                            <span className="truncate">{d.id}</span>
                          </Button>
                          {tpl ? <span className="text-[10px] text-muted-foreground">{tpl.name}</span> : null}
                        </div>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{d.leadId}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </AppLayout>
  )
}
