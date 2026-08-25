import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronRight, Clock, Sparkles, Target, Users } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FiltroPeriodo } from '@/components/page/FiltroPeriodo'
import { SubTabs } from '@/components/page/SubTabs'
import { resultadosTabs } from '@/config/subTabs'
import { AppLayout } from '@/layouts/AppLayout'
import { periodoDoMes, mesAtual, type Periodo } from '@/lib/periodo'
import { cn } from '@/lib/utils'
import {
  META_FOLICULOS_HORA_PADRAO,
  duracao,
  fetchEquipeSala,
  type EquipeSala,
} from '@/services/cirurgiaHoras'

/**
 * Horas e folículos por implantador — o relatório que só existia no painel do PHP.
 *
 * A conta que importa é folículo por HORA, não por bloco: um bloco de 35 minutos
 * com 352 folículos é 603 por hora, acima da meta, e contado como "uma hora"
 * apareceria como 352, muito abaixo. Por isso a coluna de horas vem antes da de
 * folículos, e `base` (quantos blocos têm as duas pontas do relógio) fica na
 * mesma linha: é ela que diz o quanto do fol/h daquela pessoa foi medido.
 */

const numero = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('pt-BR'))

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  loading,
  accent,
}: {
  label: string
  value: string
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

export function CirurgiaEquipePage() {
  // Mês fechado é a unidade de pagamento da equipe da sala; 90 dias misturaria
  // três folhas no mesmo número.
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoMes(mesAtual()))
  const [meta, setMeta] = useState(META_FOLICULOS_HORA_PADRAO)
  const [data, setData] = useState<EquipeSala | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setLoading(true)
    setErro(null)
    fetchEquipeSala(periodo.de, periodo.ate, meta)
      .then((r) => !cancelado && setData(r))
      .catch((e) => !cancelado && setErro(e instanceof Error ? e.message : 'Falha ao carregar o relatório da equipe.'))
      .finally(() => !cancelado && setLoading(false))
    return () => {
      cancelado = true
    }
  }, [periodo, meta])

  const r = data?.resumo
  const qa = data?.qualidade
  const pessoas = data?.por_pessoa ?? []
  const cirurgias = data?.por_cirurgia ?? []

  const abaixoDaMeta = useMemo(
    () => (data?.por_pessoa ?? []).filter((p) => p.pct_meta != null && p.pct_meta < 100),
    [data],
  )

  return (
    <AppLayout title="Equipe da sala">
      <SubTabs tabs={resultadosTabs} />

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Horas e folículos por implantador · {periodo.rotulo}</h1>
            <p className="text-xs text-muted-foreground">
              Cada bloco de hora da sala tem lado, implantador e folículos. Aqui eles somam por pessoa, com a duração
              real do bloco — não com "uma hora" arredondada.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="meta-folh" className="text-[11px] text-muted-foreground">
                Meta (fol/h)
              </Label>
              <Input
                id="meta-folh"
                type="number"
                min={1}
                step={10}
                value={meta}
                onChange={(e) => setMeta(Math.max(1, Number(e.target.value) || META_FOLICULOS_HORA_PADRAO))}
                className="h-9 w-24 tabular-nums"
              />
            </div>
            <FiltroPeriodo
              valor={periodo}
              onChange={setPeriodo}
              atalhos={['mes-atual', 'mes-passado', 'dias:30', 'dias:90']}
            />
          </div>
        </div>

        {erro ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {erro}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Implantadores"
            value={numero(r?.pessoas)}
            sub={`${numero(r?.cirurgias)} cirurgias no período`}
            icon={Users}
            loading={loading}
          />
          <Kpi
            label="Horas de implante"
            // Sem resposta ainda é "—", não "0 min": zero é um fato, ausência não é.
            value={r ? duracao(r.horas * 60) : '—'}
            sub={`${numero(r?.blocos_com_duracao)} de ${numero(r?.blocos)} blocos cronometrados`}
            icon={Clock}
            loading={loading}
          />
          <Kpi
            label="Folículos implantados"
            value={numero(r?.foliculos)}
            sub="somados bloco a bloco"
            icon={Sparkles}
            loading={loading}
          />
          <Kpi
            label="Folículos por hora"
            value={numero(r?.foliculos_hora)}
            sub={`meta de ${numero(meta)} por hora`}
            icon={Target}
            loading={loading}
            accent={(r?.foliculos_hora ?? 0) >= meta ? 'text-emerald-600' : 'text-amber-600'}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Por implantador</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : pessoas.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Nenhum bloco de implante registrado no período.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Implantador</TableHead>
                      <TableHead className="pb-2">Lados</TableHead>
                      <TableHead className="pb-2 text-right">Cirurgias</TableHead>
                      <TableHead className="pb-2 text-right">Blocos</TableHead>
                      <TableHead className="pb-2 text-right">Horas</TableHead>
                      <TableHead className="pb-2 text-right">Folículos</TableHead>
                      <TableHead className="pb-2 text-right">Por hora</TableHead>
                      <TableHead className="pb-2 text-right">% da meta</TableHead>
                      <TableHead className="pb-2 text-right">Base</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pessoas.map((p) => {
                      const bateu = (p.pct_meta ?? 0) >= 100
                      return (
                        <TableRow key={p.implantador_id ?? p.implantador} className="border-t border-border/20">
                          <TableCell className="py-1.5 font-medium">{p.implantador}</TableCell>
                          <TableCell className="py-1.5 text-muted-foreground">
                            {(p.lados ?? '—')
                              .split('/')
                              .map((l) => l.charAt(0) + l.slice(1).toLowerCase())
                              .join(' · ')}
                          </TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{p.cirurgias}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{p.blocos}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{duracao(p.horas * 60)}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{numero(p.foliculos)}</TableCell>
                          <TableCell className="py-1.5 text-right font-medium tabular-nums">
                            {numero(p.foliculos_hora)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'py-1.5 text-right font-semibold tabular-nums',
                              p.pct_meta == null
                                ? 'text-muted-foreground'
                                : bateu
                                  ? 'text-emerald-600'
                                  : 'text-amber-600',
                            )}
                          >
                            {p.pct_meta == null ? '—' : `${p.pct_meta}%`}
                          </TableCell>
                          {/* Quantos blocos da pessoa têm as duas pontas do relógio.
                              Base pequena não é produtividade, é amostra. */}
                          <TableCell
                            className={cn(
                              'py-1.5 text-right tabular-nums',
                              p.base_horas < p.blocos ? 'text-amber-600' : 'text-muted-foreground',
                            )}
                          >
                            {p.base_horas}/{p.blocos}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Por hora</span> divide os folículos pelo tempo real dos
              blocos cronometrados — um bloco de 35 min com 352 folículos conta como 603/h, não como 352.{' '}
              <span className="font-medium text-foreground">Base</span> é quantos blocos daquela pessoa têm início e
              fim; o resto entra em folículos, mas não na conta por hora.
            </p>
          </CardContent>
        </Card>

        {abaixoDaMeta.length > 0 && !loading ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-semibold text-amber-700 dark:text-amber-500">
                {abaixoDaMeta.length === 1
                  ? '1 implantador abaixo da meta no período'
                  : `${abaixoDaMeta.length} implantadores abaixo da meta no período`}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {abaixoDaMeta
                  .map((p) => `${p.implantador} (${p.foliculos_hora}/h, ${p.pct_meta}%)`)
                  .join(' · ')}
                . Antes de tratar como desempenho, abra a cirurgia e confira os blocos: implantador trocado ou folículo
                lançado no lado errado derruba a conta da pessoa certa.
              </p>
            </div>
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cirurgias do período</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : cirurgias.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Sem cirurgias com implante no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Dia</TableHead>
                      <TableHead className="pb-2">Paciente</TableHead>
                      <TableHead className="pb-2">Implantadores</TableHead>
                      <TableHead className="pb-2 text-right">Blocos</TableHead>
                      <TableHead className="pb-2 text-right">Horas</TableHead>
                      <TableHead className="pb-2 text-right">Folículos</TableHead>
                      <TableHead className="pb-2 text-right">Meta</TableHead>
                      <TableHead className="pb-2" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cirurgias.map((c) => (
                      <TableRow key={c.surgery_id} className="border-t border-border/20">
                        <TableCell className="py-1.5 tabular-nums whitespace-nowrap">
                          {new Date(`${c.dia}T12:00:00`).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                          })}
                        </TableCell>
                        <TableCell className="py-1.5 font-medium">
                          <Link
                            to={`/cirurgias/${c.surgery_id}`}
                            className="hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                          >
                            {c.paciente}
                          </Link>
                        </TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">{c.implantadores ?? '—'}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{c.blocos}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{duracao(c.horas * 60)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{numero(c.foliculos)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {c.meta == null ? '—' : numero(c.meta)}
                        </TableCell>
                        <TableCell className="py-1.5 text-right">
                          <Link
                            to={`/cirurgias/${c.surgery_id}`}
                            aria-label={`Abrir hora a hora de ${c.paciente}`}
                            className="inline-flex text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                          >
                            <ChevronRight className="size-4" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-sm">O quanto dá para confiar nestes números</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <p>
              <span className="font-semibold text-foreground">{qa?.sem_fim ?? 0}</span> de {qa?.blocos ?? 0} blocos não
              têm hora de fim e <span className="font-semibold text-foreground">{qa?.sem_inicio ?? 0}</span> não têm
              início. Eles contam em folículos, mas ficam de fora de tudo que é por hora.
            </p>
            <p>
              <span className="font-semibold text-foreground">{qa?.duracao_suspeita ?? 0}</span> blocos têm duração
              impossível (negativa ou acima de 12 h) — é dia digitado errado na tela da sala, e foram descartados do
              tempo.{' '}
              <span className="font-semibold text-foreground">{qa?.inicio_encadeado ?? 0}</span> tiveram o início
              deduzido do fim do bloco anterior.
            </p>
            <p>
              <span className="font-semibold text-foreground">{qa?.sem_implantador ?? 0}</span> blocos estão sem
              implantador registrado. Os folículos deles aparecem em "Sem implantador" e não entram na conta de
              ninguém.
            </p>
            <p>
              Última sincronização com o sistema da enfermagem:{' '}
              <span className="font-semibold text-foreground">
                {qa?.ultimo_sync
                  ? new Date(qa.ultimo_sync).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                  : '—'}
              </span>
              . A correção de bloco continua sendo lá; aqui é só leitura.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
