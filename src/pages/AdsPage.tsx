import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Eye, MessageSquare, MousePointerClick, Target, Wallet } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FiltroPeriodo } from '@/components/page/FiltroPeriodo'
import { mesAtual, periodoDoMes, type Periodo } from '@/lib/periodo'
import { AppLayout } from '@/layouts/AppLayout'
import { cn } from '@/lib/utils'
import {
  fetchAdsAteVenda,
  fetchAdsPeriodo,
  fetchAdsUltimaCarga,
  type AdsAteVenda,
  type AdsCampanha,
  type AdsDia,
  type AdsResumo,
} from '@/services/ads'

/**
 * Meta de verba combinada com o Álvaro em 25/08/2026: R$ 10 mil por mês.
 * Fica aqui, visível, porque o número existe para ser comparado, não para ser
 * lembrado.
 */
const META_MES_CENTS = 1_000_000

const reais = (cents: number | null | undefined, casas = 0) =>
  cents == null
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL', maximumFractionDigits: casas,
      })

const inteiro = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pt-BR')

/** Custo por resultado. Sem resultado não existe custo por resultado, e mostrar
 *  o gasto inteiro ali seria mentira aritmética. */
function custoPor(gastoCents: number, qtd: number): string {
  if (!qtd) return '—'
  return reais(gastoCents / qtd, 2)
}

function diaCurto(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function Kpi({
  label, valor, sub, icon: Icon, loading, alerta,
}: {
  label: string
  valor: string
  sub?: string
  icon: typeof Wallet
  loading?: boolean
  alerta?: boolean
}) {
  return (
    <Card className={cn(alerta && 'border-destructive/40')}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={cn('h-4 w-4', alerta ? 'text-destructive' : 'text-muted-foreground')} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div className={cn('text-2xl font-semibold tabular-nums', alerta && 'text-destructive')}>{valor}</div>
        )}
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export function AdsPage() {
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoMes(mesAtual()))
  const [resumo, setResumo] = useState<AdsResumo | null>(null)
  const [porCampanha, setPorCampanha] = useState<AdsCampanha[]>([])
  const [porDia, setPorDia] = useState<AdsDia[]>([])
  const [ateVenda, setAteVenda] = useState<AdsAteVenda[]>([])
  const [ultimaCarga, setUltimaCarga] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    Promise.all([
      fetchAdsPeriodo(periodo.de, periodo.ate),
      fetchAdsAteVenda(),
      fetchAdsUltimaCarga(),
    ])
      .then(([p, v, u]) => {
        if (!vivo) return
        setResumo(p.resumo)
        setPorCampanha(p.porCampanha)
        setPorDia(p.porDia)
        setAteVenda(v)
        setUltimaCarga(u)
      })
      .catch((e: unknown) => vivo && setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => vivo && setCarregando(false))
    return () => { vivo = false }
  }, [periodo])

  /** Projeção do mês pelo ritmo dos dias que já rodaram. É o número que diz se
   *  a verba vai estourar ANTES de estourar. */
  const projecao = useMemo(() => {
    if (!resumo || !resumo.dias) return null
    const noMes = new Date(`${periodo.ate}T12:00:00`).getDate()
    return Math.round((resumo.gasto_cents / resumo.dias) * noMes)
  }, [resumo, periodo.ate])

  const estourou = projecao != null && projecao > META_MES_CENTS * 1.05

  const dadoVelho = useMemo(() => {
    if (!ultimaCarga) return false
    return Date.now() - new Date(ultimaCarga).getTime() > 36 * 3600_000
  }, [ultimaCarga])

  return (
    <AppLayout
      title="Anúncios"
      subtitle="Gasto da Meta encostado no que o CRM viu acontecer"
      actions={<FiltroPeriodo valor={periodo} onChange={setPeriodo} />}
    >
      <div className="space-y-6">
        {erro && (
          <Card className="border-destructive/40">
            <CardContent className="flex items-start gap-3 py-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>Não consegui ler os dados de anúncio: {erro}</span>
            </CardContent>
          </Card>
        )}

        {dadoVelho && (
          <Card className="border-amber-500/40">
            <CardContent className="flex items-start gap-3 py-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                A última carga da Meta foi em{' '}
                {new Date(ultimaCarga!).toLocaleString('pt-BR')}. O número abaixo pode estar velho.
              </span>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi
            label="Gasto no período" icon={Wallet} loading={carregando}
            valor={reais(resumo?.gasto_cents)}
            sub={projecao != null ? `projeção do mês ${reais(projecao)} · meta ${reais(META_MES_CENTS)}` : undefined}
            alerta={estourou}
          />
          <Kpi
            label="Leads de formulário" icon={Target} loading={carregando}
            valor={inteiro(resumo?.leads)}
            sub={resumo ? `${custoPor(resumo.gasto_cents, resumo.leads)} cada` : undefined}
          />
          <Kpi
            label="Conversas iniciadas" icon={MessageSquare} loading={carregando}
            valor={inteiro(resumo?.conversas)}
            sub={resumo ? `${custoPor(resumo.gasto_cents, resumo.conversas)} cada` : undefined}
          />
          <Kpi
            label="Cliques" icon={MousePointerClick} loading={carregando}
            valor={inteiro(resumo?.cliques)}
            sub={resumo ? `${custoPor(resumo.gasto_cents, resumo.cliques)} cada` : undefined}
          />
          <Kpi
            label="Impressões" icon={Eye} loading={carregando}
            valor={inteiro(resumo?.impressoes)}
            sub={resumo && resumo.impressoes
              ? `CPM ${reais((resumo.gasto_cents / resumo.impressoes) * 1000, 2)}`
              : undefined}
          />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Gasto por dia</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {carregando ? (
              <Skeleton className="h-full w-full" />
            ) : porDia.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Nenhum gasto registrado neste período.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={porDia} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                  <XAxis dataKey="dia" tickFormatter={diaCurto} fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis
                    fontSize={11} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => (v / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  />
                  <Tooltip
                    labelFormatter={(v) => diaCurto(String(v))}
                    formatter={(v) => [reais(Number(v), 2), 'gasto'] as [string, string]}
                  />
                  <Area
                    type="monotone" dataKey="gasto_cents"
                    className="fill-primary/20 stroke-primary" strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Por campanha, no período</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campanha</TableHead>
                    <TableHead className="text-right">Gasto</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Por lead</TableHead>
                    <TableHead className="text-right">Conversas</TableHead>
                    <TableHead className="text-right">Por conversa</TableHead>
                    <TableHead className="text-right">CPM</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {carregando && (
                    <TableRow><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                  )}
                  {!carregando && porCampanha.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                        Nenhuma campanha com entrega neste período.
                      </TableCell>
                    </TableRow>
                  )}
                  {porCampanha.map((c) => (
                    <TableRow key={c.campaign_id}>
                      <TableCell className="max-w-[280px] truncate font-medium">{c.campaign_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{reais(c.gasto_cents, 2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inteiro(c.leads)}</TableCell>
                      <TableCell className="text-right tabular-nums">{custoPor(c.gasto_cents, c.leads)}</TableCell>
                      <TableCell className="text-right tabular-nums">{inteiro(c.conversas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{custoPor(c.gasto_cents, c.conversas)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.impressoes ? reais((c.gasto_cents / c.impressoes) * 1000, 2) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Do gasto até a venda</CardTitle>
            <p className="text-xs text-muted-foreground">
              Histórico completo da campanha, com o que o CRM registrou depois do clique. O lado
              direito é piso, não total: parte dos leads chega sem campanha e a conversa só tem
              carimbo quando a pessoa não apaga a frase de abertura do anúncio.
            </p>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campanha</TableHead>
                    <TableHead className="text-right">Gasto</TableHead>
                    <TableHead className="text-right">Leads no CRM</TableHead>
                    <TableHead className="text-right">Responderam</TableHead>
                    <TableHead className="text-right">Agendaram</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Faturado</TableHead>
                    <TableHead className="text-right">Retorno</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {carregando && (
                    <TableRow><TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                  )}
                  {!carregando && ateVenda.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                        Nada sincronizado ainda.
                      </TableCell>
                    </TableRow>
                  )}
                  {ateVenda.map((c) => {
                    const retorno = c.spend_cents ? c.faturado_cents / c.spend_cents : 0
                    return (
                      <TableRow key={c.campaign_id}>
                        <TableCell className="max-w-[260px] truncate font-medium">
                          {c.campaign_name ?? c.campaign_id}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{reais(c.spend_cents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inteiro(c.leads_crm)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inteiro(c.responderam)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inteiro(c.agendaram)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{inteiro(c.vendas)}</TableCell>
                        <TableCell className="text-right tabular-nums">{reais(c.faturado_cents)}</TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums font-medium',
                            retorno >= 1 ? 'text-emerald-600' : c.faturado_cents > 0 ? 'text-amber-600' : 'text-muted-foreground',
                          )}
                        >
                          {c.spend_cents && c.faturado_cents ? `${retorno.toFixed(1)}x` : '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {ultimaCarga && (
          <p className="text-xs text-muted-foreground">
            Última carga da Meta: {new Date(ultimaCarga).toLocaleString('pt-BR')}. O gasto entra
            todo dia às 5h10, com janela de 7 dias, porque a Meta ainda reprocessa número de ontem
            e de anteontem.
          </p>
        )}
      </div>
    </AppLayout>
  )
}
