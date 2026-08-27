import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Clock, MessageSquareOff, TrendingUp, UsersIcon, Wallet } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { FiltroPeriodo } from '@/components/page/FiltroPeriodo'
import { mesAtual, periodoDoMes, periodoEmInstantes, type Periodo } from '@/lib/periodo'
import { SubTabs } from '@/components/page/SubTabs'
import { resultadosTabs } from '@/config/subTabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTenant } from '@/context/TenantContext'
import { AppLayout } from '@/layouts/AppLayout'
import { cn } from '@/lib/utils'
import {
  fetchConversaoComercial,
  fetchFunilComercial,
  fetchLeadsPorPorta,
  type ConversaoComercial,
  type FunilComercial,
  type LeadsPorPorta,
} from '@/services/analytics'

/** R$ inteiro — centavo em KPI de mês só polui a leitura. */
const reais = (cents: number | null | undefined) =>
  cents == null
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

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

/**
 * Como cada porta se chama na tela e em que ordem aparece.
 *
 * Aquisição primeiro. `importacao` e `presencial` vêm por último e com aviso: são
 * planilhas de gente que JÁ comprou, carregadas depois, então aparecem com taxa de
 * compra altíssima por viés de seleção. Lidas na mesma coluna que as outras, fariam
 * qualquer um concluir que "planilha converte 68%", que é o contrário da verdade.
 */
const PORTAS: Record<string, { rotulo: string; ordem: number; aquisicao: boolean }> = {
  landing: { rotulo: 'Landing /consulta', ordem: 1, aquisicao: true },
  formulario: { rotulo: 'Formulário do anúncio', ordem: 2, aquisicao: true },
  whatsapp: { rotulo: 'Direto no WhatsApp', ordem: 3, aquisicao: true },
  outro: { rotulo: 'Outro', ordem: 4, aquisicao: false },
  presencial: { rotulo: 'Cadastro na recepção', ordem: 5, aquisicao: false },
  importacao: { rotulo: 'Importação de planilha', ordem: 6, aquisicao: false },
}

/** "285 · 36%" — o número absoluto sem a proporção esconde o tamanho da amostra. */
function contagem(n: number, total: number): string {
  if (!total) return '0'
  return `${n} · ${Math.round((n / total) * 100)}%`
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
  // Abre no mês corrente, não em "últimos 30 dias": a pergunta de quem abre esta
  // tela é sobre o mês, e mês é o que fecha com o financeiro.
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoMes(mesAtual()))
  const [data, setData] = useState<FunilComercial | null>(null)
  const [conv, setConv] = useState<ConversaoComercial | null>(null)
  const [portas, setPortas] = useState<LeadsPorPorta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const { start, end } = periodoEmInstantes(periodo)
    Promise.all([
      fetchFunilComercial({ start, end, tenant: tenant.id }),
      fetchConversaoComercial({ start, end, tenant: tenant.id }),
      fetchLeadsPorPorta({ start, end, tenant: tenant.id }),
    ])
      .then(([funil, conversao, porPorta]) => {
        if (cancelled) return
        setData(funil)
        setConv(conversao)
        setPortas(porPorta)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Falha ao carregar os resultados.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [periodo, tenant.id])

  const r = data?.resumo
  const q = data?.qualidade_dado
  const cv = conv?.resumo

  const diasNoPeriodo = r?.dias_no_periodo ?? 30

  // Conversão por origem/campanha/atendente vem de outra RPC. Casar aqui pela
  // chave evita duas tabelas contando a mesma coisa em cantos diferentes da tela.
  const convPorOrigem = useMemo(
    () => new Map((conv?.por_origem ?? []).map((o) => [o.origem, o])),
    [conv],
  )
  const convPorCampanha = useMemo(
    () => new Map((conv?.por_campanha ?? []).map((c) => [c.campanha, c])),
    [conv],
  )
  const convPorAtendente = useMemo(
    () => new Map((conv?.por_atendente ?? []).map((a) => [a.atendente, a])),
    [conv],
  )

  const variacaoConversao = useMemo(() => {
    if (!cv || !cv.leads_anterior) return null
    const atual = cv.leads ? (100 * cv.convertidos) / cv.leads : 0
    const antes = (100 * cv.convertidos_anterior) / cv.leads_anterior
    if (!antes) return null
    return ((atual - antes) / antes) * 100
  }, [cv])

  const porDia = useMemo(
    () =>
      (data?.por_dia ?? []).map((d) => ({
        name: d.dia.slice(5).split('-').reverse().join('/'),
        leads: d.leads,
      })),
    [data],
  )

  const portasOrdenadas = useMemo(
    () =>
      [...(portas?.portas ?? [])].sort(
        (a, b) => (PORTAS[a.porta]?.ordem ?? 99) - (PORTAS[b.porta]?.ordem ?? 99),
      ),
    [portas],
  )

  const faixas = useMemo(() => data?.sla.faixas_humano ?? [], [data])
  const totalFaixas = useMemo(() => faixas.reduce((s, f) => s + f.leads, 0), [faixas])

  // Origens em que quase ninguém foi respondido — é o alerta que faz a tela
  // valer a pena. Sem resposta = dinheiro de anúncio jogado fora.
  const semResposta = r?.sem_resposta ?? 0
  const semRespostaPct = r && r.leads_novos > 0 ? Math.round((semResposta / r.leads_novos) * 100) : 0

  return (
    <AppLayout title="Resultados">
      <SubTabs tabs={resultadosTabs} />

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Resultados comerciais · {periodo.rotulo}</h1>
            <p className="text-xs text-muted-foreground">
              Quantos leads entraram, de onde vieram, quantos viraram venda e por quanto. Números do CRM, do histórico de
              conversas e das vendas registradas.
            </p>
          </div>
          <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
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
            sub={`${r?.leads_novos_anterior ?? 0} nos ${diasNoPeriodo} dias anteriores`}
            variacao={r?.variacao_pct ?? null}
            icon={UsersIcon}
            loading={loading}
          />
          <KpiCard
            label="Taxa de conversão"
            value={`${cv?.taxa_conversao_pct ?? 0}%`}
            sub={`${cv?.convertidos ?? 0} dos ${cv?.leads ?? 0} leads do período compraram`}
            variacao={variacaoConversao}
            icon={TrendingUp}
            loading={loading}
            accent="text-emerald-600"
          />
          <KpiCard
            label="Receita desses leads"
            value={reais(cv?.receita_cents)}
            sub={
              cv?.ticket_medio_cents
                ? `ticket médio ${reais(cv.ticket_medio_cents)}`
                : 'nenhuma venda registrada para esta safra'
            }
            icon={Wallet}
            loading={loading}
          />
          <KpiCard
            label="Vendas no período"
            value={cv?.vendas_no_periodo ?? 0}
            sub={`${reais(cv?.receita_no_periodo_cents)} · inclui lead que entrou antes`}
            icon={Wallet}
            loading={loading}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            label="Tempo até comprar"
            value={cv?.dias_ate_venda_mediana == null ? '—' : `${cv.dias_ate_venda_mediana} d`}
            sub="mediana entre a entrada do lead e a primeira compra"
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

        {/* A conversão de mesmo dia é quase toda cadastro criado pela própria venda
            (importação de planilha, venda lançada na mão). Sem este aviso a taxa
            acima parece desempenho de atendimento e não é. */}
        {!loading && cv && cv.convertidos > 0 && cv.convertidos_mesmo_dia / cv.convertidos >= 0.3 ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-semibold text-amber-700 dark:text-amber-500">
                {cv.convertidos_mesmo_dia} das {cv.convertidos} conversões aconteceram no mesmo dia em que o lead entrou
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Isso costuma ser cadastro criado pela própria venda (planilha importada, venda lançada na mão), não lead
                que a equipe trabalhou. Tirando esses, a conversão da entrada de lead é{' '}
                <span className="font-semibold text-foreground">
                  {cv.leads - cv.convertidos_mesmo_dia > 0
                    ? `${((100 * (cv.convertidos - cv.convertidos_mesmo_dia)) / (cv.leads - cv.convertidos_mesmo_dia)).toFixed(1)}%`
                    : '—'}
                </span>
                .
              </p>
            </div>
          </div>
        ) : null}

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

        {/* Porta de entrada: a comparação que o `por_origem` abaixo não consegue
            fazer, porque lá o agrupamento é por `leads.source` e 810 dos 881
            `meta_instagram` da clínica são, na verdade, formulário do Meta. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Por onde a pessoa entrou, e até onde ela chegou</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : portasOrdenadas.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Sem leads no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Porta</TableHead>
                      <TableHead className="pb-2 text-right">Leads</TableHead>
                      <TableHead className="pb-2 text-right">Falamos</TableHead>
                      <TableHead className="pb-2 text-right">Responderam</TableHead>
                      <TableHead className="pb-2 text-right">Agendaram</TableHead>
                      <TableHead className="pb-2 text-right">Compraram</TableHead>
                      <TableHead className="pb-2 text-right">Receita</TableHead>
                      <TableHead className="pb-2 text-right">1ª fala</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {portasOrdenadas.map((p) => {
                      const meta = PORTAS[p.porta] ?? { rotulo: p.porta, ordem: 99, aquisicao: false }
                      return (
                        <TableRow
                          key={p.porta}
                          className={cn('border-t border-border/20', meta.aquisicao ? '' : 'text-muted-foreground')}
                        >
                          <TableCell className="py-1.5 font-medium">
                            {meta.rotulo}
                            {p.score_medio != null ? (
                              <span className="ml-2 font-normal text-muted-foreground">
                                score {p.score_medio}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{p.leads}</TableCell>
                          <TableCell
                            className={cn(
                              'py-1.5 text-right tabular-nums',
                              // Lead que ninguém chamou é dinheiro de anúncio no lixo,
                              // e é a diferença mais cara entre as portas hoje.
                              meta.aquisicao && p.leads >= 20 && p.falamos / p.leads < 0.7
                                ? 'font-semibold text-destructive'
                                : '',
                            )}
                          >
                            {contagem(p.falamos, p.leads)}
                          </TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">
                            {contagem(p.responderam, p.leads)}
                          </TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">
                            {contagem(p.agendaram, p.leads)}
                          </TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">
                            {contagem(p.compraram, p.leads)}
                          </TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">
                            {p.valor_cents ? reais(p.valor_cents) : '—'}
                          </TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">
                            {duracao(p.mediana_resposta_min)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Os quatro degraus só descem: falamos com a pessoa, ela respondeu, agendou, comprou. "Falamos" ignora
                  interação de sistema (sync, automação de etapa), senão lead abandonado aparece como atendido.
                  <span className="mt-1 block">
                    As duas últimas linhas não são canal de aquisição: importação de planilha e cadastro na recepção
                    são listas de quem já é paciente, carregadas depois. A taxa de compra alta ali é viés de seleção,
                    não desempenho de canal.
                  </span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Origem */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">De onde vieram — e o que vendeu</CardTitle>
            </CardHeader>
            <CardContent>
              {(data?.por_origem ?? []).length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Sem dados no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="w-full text-xs">
                    <TableHeader>
                      <TableRow className="text-left text-muted-foreground">
                        <TableHead className="pb-2">Origem</TableHead>
                        <TableHead className="pb-2 text-right">Leads</TableHead>
                        <TableHead className="pb-2 text-right">Vendas</TableHead>
                        <TableHead className="pb-2 text-right">Conversão</TableHead>
                        <TableHead className="pb-2 text-right">Receita</TableHead>
                        <TableHead className="pb-2 text-right">Perdidos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.por_origem ?? []).map((o) => {
                        const c = convPorOrigem.get(o.origem)
                        return (
                          <TableRow key={o.origem} className="border-t border-border/20">
                            <TableCell className="py-1.5">{o.origem}</TableCell>
                            <TableCell className="py-1.5 text-right tabular-nums">{o.leads}</TableCell>
                            <TableCell className="py-1.5 text-right tabular-nums">{c?.convertidos ?? 0}</TableCell>
                            <TableCell
                              className={cn(
                                'py-1.5 text-right tabular-nums',
                                // Origem que traz volume e não vende é o dinheiro
                                // de anúncio indo embora — é o que a tela existe
                                // para mostrar.
                                o.leads >= 20 && (c?.convertidos ?? 0) === 0
                                  ? 'font-semibold text-destructive'
                                  : '',
                              )}
                            >
                              {c?.conversao_pct == null ? '—' : `${c.conversao_pct}%`}
                            </TableCell>
                            <TableCell className="py-1.5 text-right tabular-nums">
                              {c?.receita_cents ? reais(c.receita_cents) : '—'}
                            </TableCell>
                            <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                              {o.perdidos}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Conversão é da safra: leads que entraram no período e compraram alguma vez, mesmo que a compra tenha
                    saído depois. Participação de cada origem no total:{' '}
                    {(data?.por_origem ?? [])
                      .slice(0, 3)
                      .map((o) => `${o.origem} ${pct(o.leads, r?.leads_novos ?? 0)}`)
                      .join(' · ')}
                    .
                  </p>
                </div>
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
                      <TableHead className="pb-2 text-right">Vendas</TableHead>
                      <TableHead className="pb-2 text-right">Receita</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.por_campanha ?? []).map((c) => {
                      const v = convPorCampanha.get(c.campanha)
                      return (
                        <TableRow key={c.campanha} className="border-t border-border/20">
                          <TableCell className="py-1.5 max-w-[240px] truncate" title={c.campanha}>
                            {c.campanha}
                          </TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{c.leads}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{v?.convertidos ?? 0}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">
                            {v?.receita_cents ? reais(v.receita_cents) : '—'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
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
                      <TableHead className="pb-2 text-right">Vendas</TableHead>
                      <TableHead className="pb-2 text-right">Conversão</TableHead>
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
                        <TableCell className="py-1.5 text-right tabular-nums">
                          {convPorAtendente.get(a.atendente)?.convertidos ?? 0}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">
                          {convPorAtendente.get(a.atendente)?.conversao_pct == null
                            ? '—'
                            : `${convPorAtendente.get(a.atendente)?.conversao_pct}%`}
                        </TableCell>
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
                // table-fixed para "Leads" respeitar w-20 e o motivo ficar com a sobra.
                // Em layout automático a largura é só sugestão e, com truncate, a coluna
                // de texto cede a folga inteira para a vizinha.
                <Table className="w-full table-fixed text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Motivo</TableHead>
                      <TableHead className="w-20 pb-2 text-right">Leads</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.perdas ?? []).map((p) => (
                      <TableRow key={p.motivo} className="border-t border-border/20">
                        {/* Motivo de perda é digitado à mão: mediana de 19 mas chega a 81
                            caracteres nos dados reais, e aí quebrava em três linhas. */}
                        <TableCell className="truncate py-1.5" title={p.motivo}>{p.motivo}</TableCell>
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
            <p>
              <span className="font-semibold text-foreground">{conv?.qualidade.vendas_sem_lead ?? 0}</span> vendas do
              período foram registradas sem lead vinculado, e{' '}
              <span className="font-semibold text-foreground">{conv?.qualidade.pagamentos_sem_lead ?? 0}</span>{' '}
              pagamentos idem. Enquanto esse número não for zero, toda taxa de conversão aqui é PISO: a venda aconteceu e
              não dá para creditar a origem nenhuma.
            </p>
            <p className="sm:col-span-2">
              Receita conta venda da clínica (Central de Vendas) e pagamento confirmado no gateway. Venda lançada só na
              planilha, sem passar pelo sistema, não entra em lugar nenhum destes números.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
