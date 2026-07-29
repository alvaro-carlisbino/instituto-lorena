import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Clock, MessageSquareOff, UsersIcon } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SubTabs } from '@/components/page/SubTabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTenant } from '@/context/TenantContext'
import { AppLayout } from '@/layouts/AppLayout'
import { cn } from '@/lib/utils'
import { fetchFunilComercial, type FunilComercial } from '@/services/analytics'

const RANGES = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
]

/** Minutos em texto curto ("42 min", "3 h 10", "2 d"). A mediana de resposta
 *  passa fácil de 24 h — mostrar "1440 min" não comunica nada. */
function duracao(min: number | null | undefined): string {
  if (min == null) return '—'
  if (min < 1) return 'imediato'
  if (min < 60) return `${Math.round(min)} min`
  if (min < 1440) {
    const h = Math.floor(min / 60)
    const m = Math.round(min % 60)
    return m > 0 ? `${h} h ${m}` : `${h} h`
  }
  const d = min / 1440
  return `${d.toFixed(d < 10 ? 1 : 0)} d`
}

function pct(n: number, total: number): string {
  if (!total) return '0%'
  return `${Math.round((n / total) * 100)}%`
}

function KpiCard({
  label,
  value,
  sub,
  variacao,
  icon: Icon,
  loading,
  accent,
  variacaoBoaSubindo = true,
}: {
  label: string
  value: string | number
  sub?: string
  variacao?: number | null
  icon: typeof UsersIcon
  loading?: boolean
  accent?: string
  variacaoBoaSubindo?: boolean
}) {
  const boa = variacao == null ? null : variacaoBoaSubindo ? variacao >= 0 : variacao <= 0
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/40 bg-card/60 p-6 ">
      <div className="absolute top-0 right-0 p-5 opacity-[0.04]" aria-hidden>
        <Icon className="size-16" />
      </div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        {loading ? (
          <Skeleton className="h-9 w-20" />
        ) : (
          <span className={cn('text-4xl font-semibold tracking-tighter tabular-nums', accent ?? 'text-foreground')}>
            {value}
          </span>
        )}
        {!loading && variacao != null ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
              boa ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive',
            )}
          >
            {variacao >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(variacao).toFixed(0)}%
          </span>
        ) : null}
      </div>
      {sub ? <p className="mt-1.5 text-[12px] font-medium text-muted-foreground/70">{loading ? ' ' : sub}</p> : null}
    </div>
  )
}

export function ResultadosPage() {
  const { tenant } = useTenant()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<FunilComercial | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const end = new Date()
    const start = new Date(end.getTime() - days * 86_400_000)
    fetchFunilComercial({ start, end, tenant: tenant.id })
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Falha ao carregar os resultados.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [days, tenant.id])

  const r = data?.resumo
  const q = data?.qualidade_dado

  const porDia = useMemo(
    () =>
      (data?.por_dia ?? []).map((d) => ({
        name: d.dia.slice(5).split('-').reverse().join('/'),
        leads: d.leads,
      })),
    [data],
  )

  const faixas = useMemo(() => data?.sla.faixas_humano ?? [], [data])
  const totalFaixas = useMemo(() => faixas.reduce((s, f) => s + f.leads, 0), [faixas])

  // Origens em que quase ninguém foi respondido — é o alerta que faz a tela
  // valer a pena. Sem resposta = dinheiro de anúncio jogado fora.
  const semResposta = r?.sem_resposta ?? 0
  const semRespostaPct = r && r.leads_novos > 0 ? Math.round((semResposta / r.leads_novos) * 100) : 0

  return (
    <AppLayout title="Resultados">
      <SubTabs
        tabs={[
          { to: '/resultados', label: 'Resultados' },
          { to: '/analytics', label: 'Análise do funil' },
          { to: '/metricas', label: 'Metas' },
        ]}
      />

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Resultados comerciais</h1>
            <p className="text-xs text-muted-foreground">
              Quantos leads entraram, de onde vieram, quanto tempo levamos para responder e quem atendeu. Números do CRM
              e do histórico de conversas, não dependem da Shosp.
            </p>
          </div>
          <div className="flex gap-1">
            {RANGES.map((p) => (
              <Button
                key={p.days}
                size="sm"
                variant={days === p.days ? 'default' : 'outline'}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {/* Alerta do buraco mais caro: lead que entrou e nunca recebeu mensagem. */}
        {!loading && semResposta > 0 && semRespostaPct >= 10 ? (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="text-sm">
              <p className="font-semibold text-destructive">
                {semResposta} leads ({semRespostaPct}%) não receberam nenhuma mensagem
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Entraram no CRM no período e ninguém, nem a IA nem a equipe, enviou uma única resposta. Veja em qual
                origem eles estão concentrados na tabela abaixo.
              </p>
            </div>
          </div>
        ) : null}

        {/* Resumo */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Leads novos"
            value={r?.leads_novos ?? 0}
            sub={`${r?.leads_novos_anterior ?? 0} nos ${days} dias anteriores`}
            variacao={r?.variacao_pct ?? null}
            icon={UsersIcon}
            loading={loading}
          />
          <KpiCard
            label="Taxa de resposta"
            value={`${r?.taxa_resposta_pct ?? 0}%`}
            sub={`${r?.respondidos ?? 0} de ${r?.leads_novos ?? 0} receberam ao menos uma resposta`}
            icon={MessageSquareOff}
            loading={loading}
            accent={(r?.taxa_resposta_pct ?? 0) < 80 ? 'text-destructive' : 'text-emerald-600'}
          />
          <KpiCard
            label="1ª resposta humana"
            value={duracao(data?.sla.humano.mediana_min)}
            sub={`mediana · 10% esperaram mais de ${duracao(data?.sla.humano.p90_min)}`}
            icon={Clock}
            loading={loading}
          />
          <KpiCard
            label="Perdidos"
            value={r?.perdidos ?? 0}
            sub={`${r?.ativos ?? 0} seguem ativos`}
            icon={AlertTriangle}
            loading={loading}
            accent="text-destructive"
          />
        </div>

        {/* Entrada de leads por dia */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Entrada de leads por dia</CardTitle>
          </CardHeader>
          <CardContent>
            {porDia.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Sem leads no período.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={porDia} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    cursor={{ opacity: 0.1 }}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v) => [`${v} leads`, '']}
                  />
                  <Bar dataKey="leads" fill="oklch(0.638 0.12 250)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Origem */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">De onde vieram os leads</CardTitle>
            </CardHeader>
            <CardContent>
              {(data?.por_origem ?? []).length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Sem dados no período.</p>
              ) : (
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Origem</TableHead>
                      <TableHead className="pb-2 text-right">Leads</TableHead>
                      <TableHead className="pb-2 text-right">Participação</TableHead>
                      <TableHead className="pb-2 text-right">Perdidos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.por_origem ?? []).map((o) => (
                      <TableRow key={o.origem} className="border-t border-border/20">
                        <TableCell className="py-1.5">{o.origem}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{o.leads}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {pct(o.leads, r?.leads_novos ?? 0)}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{o.perdidos}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Campanha */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Campanhas que mais trouxeram lead</CardTitle>
            </CardHeader>
            <CardContent>
              {(data?.por_campanha ?? []).length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Nenhum lead com campanha identificada no período.
                </p>
              ) : (
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Campanha</TableHead>
                      <TableHead className="pb-2 text-right">Leads</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.por_campanha ?? []).map((c) => (
                      <TableRow key={c.campanha} className="border-t border-border/20">
                        <TableCell className="py-1.5 max-w-[240px] truncate" title={c.campanha}>
                          {c.campanha}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{c.leads}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tempo de primeira resposta */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Quanto tempo até a primeira resposta</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[1fr_280px]">
            {faixas.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Sem dados no período.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(180, faixas.length * 34)}>
                <BarChart data={faixas} layout="vertical" margin={{ left: 8, right: 48 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="faixa" width={140} tick={{ fontSize: 11 }} />
                  <Bar dataKey="leads" radius={[0, 6, 6, 0]}>
                    {faixas.map((f, i) => (
                      <Cell
                        key={i}
                        fill={
                          f.faixa.startsWith('Sem resposta')
                            ? 'oklch(0.62 0.18 25)'
                            : f.faixa.startsWith('Mais de')
                              ? 'oklch(0.72 0.15 60)'
                              : 'oklch(0.638 0.12 250)'
                        }
                      />
                    ))}
                    <LabelList
                      dataKey="leads"
                      position="right"
                      style={{ fontSize: 11 }}
                      formatter={(v) => `${v} (${pct(Number(v), totalFaixas)})`}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            <div className="flex flex-col gap-3 text-xs">
              <div className="rounded-lg border border-border/30 p-3">
                <p className="font-semibold">Assistente de IA</p>
                <p className="mt-1 text-muted-foreground">
                  Respondeu {data?.sla.ia.respondidos ?? 0} leads · mediana {duracao(data?.sla.ia.mediana_min)}
                </p>
              </div>
              <div className="rounded-lg border border-border/30 p-3">
                <p className="font-semibold">Equipe</p>
                <p className="mt-1 text-muted-foreground">
                  Respondeu {data?.sla.humano.respondidos ?? 0} leads · mediana {duracao(data?.sla.humano.mediana_min)} ·
                  10% mais lentos acima de {duracao(data?.sla.humano.p90_min)}
                </p>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Conta do momento em que o lead entrou até a primeira mensagem enviada. Sincronizações e automações de
                sistema não contam como resposta.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Por atendente */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Por atendente</CardTitle>
          </CardHeader>
          <CardContent>
            {(data?.por_atendente ?? []).length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Sem dados no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Atendente</TableHead>
                      <TableHead className="pb-2 text-right">Leads</TableHead>
                      <TableHead className="pb-2 text-right">Falou com a equipe</TableHead>
                      <TableHead className="pb-2 text-right">Sem nenhuma resposta</TableHead>
                      <TableHead className="pb-2 text-right">Respondeu em pessoa</TableHead>
                      <TableHead className="pb-2 text-right">1ª resposta (mediana)</TableHead>
                      <TableHead className="pb-2 text-right">Perdidos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.por_atendente ?? []).map((a) => (
                      <TableRow key={a.atendente} className="border-t border-border/20">
                        <TableCell className="py-1.5">{a.atendente}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{a.leads}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{a.atendidos_por_humano}</TableCell>
                        <TableCell
                          className={cn(
                            'py-1.5 text-right tabular-nums',
                            a.sem_resposta > 0 ? 'font-semibold text-destructive' : '',
                          )}
                        >
                          {a.sem_resposta}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{a.respondidos_por_ela}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">
                          {duracao(a.mediana_humano_min)}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{a.perdidos}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  O responsável é rodízio automático, então "Leads" é quem recebeu, não quem
                  trabalhou. "Respondeu em pessoa" e a mediana contam só os leads que aquela
                  pessoa respondeu de fato.
                </p>
                {(data?.por_quem_respondeu ?? []).length > 0 ? (
                  <div className="mt-3 border-t border-border/40 pt-3">
                    <p className="mb-2 text-xs font-medium">Quem deu a primeira resposta</p>
                    <ul className="grid gap-1 text-xs">
                      {(data?.por_quem_respondeu ?? []).map((q) => (
                        <li key={q.pessoa} className="flex items-center justify-between gap-3">
                          <span className="truncate">{q.pessoa}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {q.respondeu} {q.respondeu === 1 ? 'lead' : 'leads'} · mediana {duracao(q.mediana_min)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Gargalos */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Onde os leads estão parados</CardTitle>
            </CardHeader>
            <CardContent>
              {(data?.etapas ?? []).length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Sem dados no período.</p>
              ) : (
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Etapa</TableHead>
                      <TableHead className="pb-2 text-right">Leads</TableHead>
                      <TableHead className="pb-2 text-right">Dias parados</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.etapas ?? []).map((e) => (
                      <TableRow key={e.etapa} className="border-t border-border/20">
                        <TableCell className="py-1.5">{e.etapa}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{e.leads}</TableCell>
                        <TableCell
                          className={cn(
                            'py-1.5 text-right tabular-nums',
                            e.dias_medios > 10 ? 'font-semibold text-destructive' : '',
                          )}
                        >
                          {e.dias_medios}d
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Perdas */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Por que perdemos</CardTitle>
            </CardHeader>
            <CardContent>
              {(data?.perdas ?? []).length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Nenhum lead perdido com motivo registrado no período.
                </p>
              ) : (
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Motivo</TableHead>
                      <TableHead className="pb-2 text-right">Leads</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.perdas ?? []).map((p) => (
                      <TableRow key={p.motivo} className="border-t border-border/20">
                        <TableCell className="py-1.5">{p.motivo}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{p.leads}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Qualidade da base, o antídoto contra número bonito sobre base vazia. */}
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-sm">O quanto dá para confiar nestes números</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <p>
              <span className="font-semibold text-foreground">{q?.com_campanha_pct ?? 0}%</span> dos leads têm campanha
              identificada, o resto entra sem saber de qual anúncio veio.
            </p>
            <p>
              <span className="font-semibold text-foreground">{q?.com_motivo_perda_pct ?? 0}%</span> dos leads encerrados
              têm motivo de perda preenchido. Sem isso, "por que perdemos" é palpite.
            </p>
            <p>
              <span className="font-semibold text-foreground">{q?.com_vinculo_shosp_pct ?? 0}%</span> dos leads estão
              vinculados a um paciente da Shosp, por isso esta tela não mede consulta nem comparecimento.
            </p>
            <p>
              Agenda da Shosp sincronizada pela última vez{' '}
              <span className="font-semibold text-foreground">
                {q?.agenda_dias_atras == null
                  ? '—'
                  : q.agenda_dias_atras === 0
                    ? 'hoje'
                    : `há ${q.agenda_dias_atras} dias`}
              </span>
              .
            </p>
            <p className="sm:col-span-2">
              A clínica ainda não registra faturamento no sistema, então não há receita, ticket médio ou retorno por
              campanha aqui.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
