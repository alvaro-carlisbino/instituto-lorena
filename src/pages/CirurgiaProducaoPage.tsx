import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, Clock, DoorOpen, Sparkles, Target, Timer, TrendingUp, Wallet } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { FiltroPeriodo } from '@/components/page/FiltroPeriodo'
import { periodoUltimosDias, rotuloDoMes, type Periodo } from '@/lib/periodo'
import { SubTabs } from '@/components/page/SubTabs'
import { resultadosTabs } from '@/config/subTabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AppLayout } from '@/layouts/AppLayout'
import { cn } from '@/lib/utils'
import { ETAPA_LABEL, fetchCirurgiaAnalytics, type CirurgiaAnalytics } from '@/services/cirurgiaAnalytics'

/**
 * Produção do centro cirúrgico — o que o sistema da enfermagem cronometrou.
 *
 * O sistema PHP da sala registra etapa por etapa desde nov/2025 e nada disso
 * chegava a uma tela: quanto tempo a cirurgia ocupa a sala, onde o tempo é gasto,
 * quantos folículos saem por hora e quanto a hora de sala rende.
 *
 * A tela mostra a base de cada conta junto do número. Duração fora de 1h..20h é
 * registro esquecido aberto e fica de fora; cirurgia sem venda vinculada não entra
 * no R$/hora. Esconder isso daria média bonita sobre metade dos dados.
 */

const reais = (cents: number | null | undefined) =>
  cents == null
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** 9.59 → "9 h 35". Decimal de hora ninguém lê na parede. */
function horas(h: number | null | undefined): string {
  if (h == null) return '—'
  const inteiras = Math.floor(h)
  const min = Math.round((h - inteiras) * 60)
  if (inteiras === 0) return `${min} min`
  return min > 0 ? `${inteiras} h ${String(min).padStart(2, '0')}` : `${inteiras} h`
}

/** 181 → "3 h 01"; 5 → "5 min". */
function minutos(m: number | null | undefined): string {
  if (m == null) return '—'
  if (m < 60) return `${Math.round(m)} min`
  return horas(m / 60)
}

const numero = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR'))

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  loading,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  icon: typeof Clock
  loading?: boolean
  accent?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/40 bg-card/60 p-6">
      <div className="absolute top-0 right-0 p-5 opacity-[0.04]" aria-hidden>
        <Icon className="size-16" />
      </div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2">
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <span className={cn('text-3xl font-semibold tracking-tighter tabular-nums', accent ?? 'text-foreground')}>
            {value}
          </span>
        )}
      </div>
      {sub ? <p className="mt-1.5 text-[12px] font-medium text-muted-foreground/70">{loading ? ' ' : sub}</p> : null}
    </div>
  )
}

export function CirurgiaProducaoPage() {
  // 90 dias por padrão: a clínica opera ~24 cirurgias/mês, e no dia 3 do mês uma
  // janela mensal mostraria duas cirurgias e uma mediana sem sentido.
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoUltimosDias(90))
  const [data, setData] = useState<CirurgiaAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setLoading(true)
    setErro(null)
    fetchCirurgiaAnalytics(periodo.de, periodo.ate)
      .then((r) => !cancelado && setData(r))
      .catch((e) => !cancelado && setErro(e instanceof Error ? e.message : 'Falha ao carregar a produção da sala.'))
      .finally(() => !cancelado && setLoading(false))
    return () => {
      cancelado = true
    }
  }, [periodo])

  const r = data?.resumo
  const qa = data?.qualidade

  const porMes = useMemo(
    () =>
      (data?.por_mes ?? []).map((m) => ({
        name: rotuloDoMes(m.mes).replace('/', '/').slice(0, 3) + '/' + m.mes.slice(2, 4),
        cirurgias: m.cirurgias,
        horas: Number(m.horas),
        mediana: m.mediana_horas ?? 0,
      })),
    [data],
  )

  const etapas = useMemo(
    () =>
      (data?.por_etapa ?? []).map((e) => ({
        ...e,
        label: ETAPA_LABEL[e.etapa] ?? e.etapa,
      })),
    [data],
  )
  const maiorEtapa = etapas[0]?.mediana_min ?? 1

  const totalCirurgias = r?.cirurgias ?? 0

  return (
    <AppLayout title="Centro cirúrgico">
      <SubTabs tabs={resultadosTabs} />

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Produção do centro cirúrgico · {periodo.rotulo}</h1>
            <p className="text-xs text-muted-foreground">
              O que o sistema da sala cronometrou: tempo de ocupação, onde o tempo é gasto, folículos por hora e quanto
              rende a hora de sala. Fonte é o espelho do sistema da enfermagem, sincronizado de 2 em 2 horas.
            </p>
          </div>
          <FiltroPeriodo valor={periodo} onChange={setPeriodo} atalhos={['dias:30', 'dias:90', 'mes-atual', 'mes-passado']} />
        </div>

        {erro ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {erro}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Cirurgias"
            value={numero(r?.cirurgias)}
            sub={`${r?.finalizadas ?? 0} finalizadas${r?.em_processo ? ` · ${r.em_processo} em processo` : ''}`}
            icon={Activity}
            loading={loading}
          />
          <Kpi
            label="Horas de sala"
            value={horas(r?.horas_sala)}
            sub={`${horas(r?.mediana_horas)} por cirurgia (mediana)`}
            icon={DoorOpen}
            loading={loading}
          />
          <Kpi
            label="Cirurgia mais longa"
            value={horas(r?.p90_horas)}
            sub="10% das cirurgias passam disso"
            icon={Clock}
            loading={loading}
          />
          <Kpi
            label="R$ por hora de sala"
            value={reais(r?.valor_hora_sala_cents)}
            // A base é parte do número, não rodapé: sem ela alguém multiplica por
            // 1.400 horas e monta orçamento em cima de uma conta de 60 cirurgias.
            sub={`sobre ${r?.base_valor_hora ?? 0} de ${totalCirurgias} cirurgias · ${horas(r?.horas_valor_hora)}`}
            icon={Wallet}
            loading={loading}
            accent="text-emerald-600"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Folículos implantados"
            value={numero(r?.foliculos_implantados)}
            sub={`${numero(r?.foliculos_extraidos)} extraídos`}
            icon={Sparkles}
            loading={loading}
          />
          <Kpi
            label="Folículos por hora de sala"
            value={numero(r?.foliculos_por_hora)}
            sub="inclui preparo, anestesia e recuperação"
            icon={TrendingUp}
            loading={loading}
          />
          <Kpi
            label="Meta cumprida"
            value={r?.aproveitamento_meta_pct == null ? '—' : `${r.aproveitamento_meta_pct}%`}
            sub={`meta somada de ${numero(r?.meta_total)} folículos`}
            icon={Target}
            loading={loading}
            accent={(r?.aproveitamento_meta_pct ?? 0) >= 100 ? 'text-emerald-600' : undefined}
          />
          <Kpi
            label="Ticket médio da cirurgia"
            value={reais(r?.ticket_medio_cents)}
            sub={`${reais(r?.receita_cents)} no período`}
            icon={Wallet}
            loading={loading}
          />
        </div>

        {/* Onde o tempo da sala é gasto. É a pergunta que decide escala de equipe. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Onde o tempo da sala é gasto</CardTitle>
          </CardHeader>
          <CardContent>
            {etapas.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Nenhuma etapa cronometrada no período.
              </p>
            ) : (
              <Table className="w-full text-xs">
                <TableHeader>
                  <TableRow className="text-left text-muted-foreground">
                    <TableHead className="pb-2">Etapa</TableHead>
                    <TableHead className="pb-2">Duração típica</TableHead>
                    <TableHead className="pb-2 text-right">Mediana</TableHead>
                    <TableHead className="pb-2 text-right">10% mais longas</TableHead>
                    <TableHead className="pb-2 text-right">Cirurgias</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {etapas.map((e) => (
                    <TableRow key={e.etapa} className="border-t border-border/20">
                      <TableCell className="py-1.5 font-medium">{e.label}</TableCell>
                      <TableCell className="w-[45%] py-1.5">
                        <div className="h-2 w-full rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-[oklch(0.638_0.12_250)]"
                            style={{ width: `${Math.max(2, (e.mediana_min / maiorEtapa) * 100)}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{minutos(e.mediana_min)}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {minutos(e.p90_min)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {e.cirurgias}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Volume e ocupação mês a mês */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cirurgias e horas de sala por mês</CardTitle>
          </CardHeader>
          <CardContent>
            {porMes.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Sem cirurgias no período.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={porMes} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip
                    cursor={{ opacity: 0.1 }}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v, n) => [n === 'horas' ? horas(Number(v)) : String(v), n === 'horas' ? 'Horas de sala' : 'Cirurgias']}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="cirurgias" name="Cirurgias" fill="oklch(0.638 0.12 250)" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="horas" name="Horas de sala" stroke="oklch(0.72 0.15 60)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Por médico</CardTitle>
            </CardHeader>
            <CardContent>
              {(data?.por_medico ?? []).length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Sem dados no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="w-full text-xs">
                    <TableHeader>
                      <TableRow className="text-left text-muted-foreground">
                        <TableHead className="pb-2">Médico</TableHead>
                        <TableHead className="pb-2 text-right">Cirurgias</TableHead>
                        <TableHead className="pb-2 text-right">Mediana</TableHead>
                        <TableHead className="pb-2 text-right">Folículos</TableHead>
                        <TableHead className="pb-2 text-right">Por hora</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.por_medico ?? []).map((m) => (
                        <TableRow key={m.medico} className="border-t border-border/20">
                          <TableCell className="py-1.5">{m.medico}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{m.cirurgias}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{horas(m.mediana_horas)}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{numero(m.foliculos)}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                            {numero(m.foliculos_por_hora)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Por sala</CardTitle>
            </CardHeader>
            <CardContent>
              {(data?.por_sala ?? []).length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Sem dados no período.</p>
              ) : (
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Sala</TableHead>
                      <TableHead className="pb-2 text-right">Cirurgias</TableHead>
                      <TableHead className="pb-2 text-right">Horas ocupadas</TableHead>
                      <TableHead className="pb-2 text-right">Mediana</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.por_sala ?? []).map((s) => (
                      <TableRow key={s.sala} className="border-t border-border/20">
                        <TableCell className="py-1.5">{s.sala}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{s.cirurgias}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{horas(s.horas)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {horas(s.mediana_horas)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                O sistema da sala grava "1" e "01" para a mesma sala; aqui as duas grafias contam junto.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* O tempo de sala é a cirurgia inteira. Quem responde "e a hora do
            implantador?" é o bloco de hora, que mora na tela da equipe. */}
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Timer className="size-4 text-muted-foreground" />
              Dentro da cirurgia, hora a hora
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <p className="max-w-2xl leading-relaxed">
              Esta tela mede a cirurgia inteira. Para saber se a hora do implantador foi de 60 ou de 35 minutos, e
              quantos folículos cada pessoa fez em cada lado, abra o relatório da equipe e clique na cirurgia.
            </p>
            <Link
              to="/cirurgias/equipe"
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              Equipe da sala
            </Link>
          </CardContent>
        </Card>

        {/* O que ficou de fora das contas, e por quê. */}
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-sm">O quanto dá para confiar nestes números</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <p>
              <span className="font-semibold text-foreground">{qa?.sem_venda_vinculada ?? 0}</span> de {totalCirurgias}{' '}
              cirurgias não têm venda vinculada no CRM. Elas contam no tempo de sala, mas ficam fora de receita, ticket e
              R$/hora.
            </p>
            <p>
              <span className="font-semibold text-foreground">{qa?.duracao_suspeita ?? 0}</span> cirurgias têm duração
              fora de 1 h a 20 h (registro aberto e esquecido, ou fechado no mesmo minuto) e foram descartadas do tempo.
              Outras <span className="font-semibold text-foreground">{qa?.sem_duracao ?? 0}</span> não têm hora nenhuma
              registrada.
            </p>
            <p className="sm:col-span-2">
              Última sincronização com o sistema da sala:{' '}
              <span className="font-semibold text-foreground">
                {qa?.ultimo_sync
                  ? new Date(qa.ultimo_sync).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                  : '—'}
              </span>
              . A escrita continua sendo no sistema da enfermagem; aqui é só leitura.
            </p>
          </CardContent>
        </Card>

        {(qa?.sem_venda_vinculada ?? 0) > totalCirurgias / 2 && totalCirurgias > 0 ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-semibold text-amber-700 dark:text-amber-500">
                Mais da metade das cirurgias não está ligada a uma venda
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Enquanto isso não fechar, todo número em reais desta tela é piso. O vínculo se faz em Cirurgias sem
                prontuário e na Conferência da Central de Vendas.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </AppLayout>
  )
}
