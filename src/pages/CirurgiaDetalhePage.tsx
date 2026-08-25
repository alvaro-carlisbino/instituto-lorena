import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Clock, Sparkles, Target, Timer } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AppLayout } from '@/layouts/AppLayout'
import { cn } from '@/lib/utils'
import { ETAPA_LABEL } from '@/services/cirurgiaAnalytics'
import {
  LADO_LABEL,
  duracao,
  fetchCirurgiaDetalhe,
  relogio,
  type CirurgiaDetalhe,
} from '@/services/cirurgiaHoras'

/**
 * Uma cirurgia, hora a hora.
 *
 * A pergunta que originou a tela: "como eu sei que foi realmente uma hora, ou se
 * foi 40 minutos? Leonardo fez uma hora?". A produção mostra a cirurgia inteira;
 * quem responde por pessoa é o bloco — hora, lado, implantador, início, fim.
 *
 * Duração do bloco só aparece quando as duas pontas existem. Quando o início foi
 * deduzido do fim do bloco anterior, a linha diz "encadeado": número deduzido que
 * se apresenta como medido é pior que número faltando, porque é ele que entra na
 * conversa de pagamento sem ninguém desconfiar.
 */

const numero = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('pt-BR'))

/** Etapa fora de ordem (fim antes do início) marca 0 ou negativo — não é duração. */
const duracaoEtapa = (min: number | null) => (min == null || min <= 0 ? '—' : duracao(min))

const diaLongo = (dia: string | null | undefined) =>
  dia
    ? new Date(`${dia}T12:00:00`).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '—'

export function CirurgiaDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const surgeryId = Number(id)
  const [data, setData] = useState<CirurgiaDetalhe | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!Number.isFinite(surgeryId)) {
      setErro('Cirurgia inválida.')
      setLoading(false)
      return
    }
    let cancelado = false
    setLoading(true)
    setErro(null)
    fetchCirurgiaDetalhe(surgeryId)
      .then((r) => !cancelado && setData(r))
      .catch((e) => !cancelado && setErro(e instanceof Error ? e.message : 'Falha ao carregar a cirurgia.'))
      .finally(() => !cancelado && setLoading(false))
    return () => {
      cancelado = true
    }
  }, [surgeryId])

  const c = data?.cirurgia
  const blocos = data?.blocos ?? []
  const etapas = data?.etapas ?? []
  const pessoas = data?.por_pessoa ?? []
  const qa = data?.qualidade

  const implante = etapas.find((e) => e.etapa === 'IMPLANTE')
  const extracao = etapas.find((e) => e.etapa === 'EXTRACAO')

  return (
    <AppLayout title={c?.paciente ?? 'Cirurgia'}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link
              to="/cirurgias/equipe"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            >
              <ArrowLeft className="size-3.5" />
              Equipe da sala
            </Link>
            <h1 className="mt-1 text-xl font-bold">
              {/* Com erro na mão, "não encontrada" mente: a cirurgia pode existir e
                  o que faltou foi permissão. O erro fica logo abaixo, sozinho. */}
              {loading ? (
                <Skeleton className="h-6 w-56" />
              ) : (
                (c?.paciente ?? (erro ? 'Cirurgia' : 'Cirurgia não encontrada'))
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              {diaLongo(c?.dia)}
              {c?.sala ? ` · sala ${c.sala}` : ''}
              {c?.medico ? ` · ${c.medico}` : ''}
              {c?.anestesista ? ` · anestesia com ${c.anestesista}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {c?.status ? (
              <Badge variant={c.status === 'FINALIZADA' ? 'secondary' : 'outline'}>
                {c.status === 'FINALIZADA' ? 'Finalizada' : c.status === 'EM_PROCESSO' ? 'Em processo' : c.status}
              </Badge>
            ) : null}
            {c?.prontuario ? <Badge variant="outline">Prontuário {c.prontuario}</Badge> : null}
          </div>
        </div>

        {erro ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {erro}
          </p>
        ) : null}

        {!loading && !erro && !c ? (
          <p className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
            Cirurgia não encontrada no espelho do sistema da enfermagem.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Tempo de implante"
            value={duracaoEtapa(implante?.duracao_min ?? null)}
            sub={
              implante?.inicio
                ? `${relogio(implante.inicio)} às ${relogio(implante.fim)}`
                : 'etapa não cronometrada'
            }
            icon={Timer}
            loading={loading}
          />
          <Kpi
            label="Tempo de extração"
            value={duracaoEtapa(extracao?.duracao_min ?? null)}
            sub={
              extracao?.inicio ? `${relogio(extracao.inicio)} às ${relogio(extracao.fim)}` : 'etapa não cronometrada'
            }
            icon={Clock}
            loading={loading}
          />
          <Kpi
            label="Folículos implantados"
            value={numero(c?.total_implantados)}
            sub={`${numero(c?.total_extraidos)} extraídos`}
            icon={Sparkles}
            loading={loading}
          />
          <Kpi
            label="Meta da cirurgia"
            value={c?.meta == null ? '—' : numero(c.meta)}
            sub={
              c?.meta && c.total_implantados
                ? `${Math.round((c.total_implantados / c.meta) * 100)}% implantado`
                : 'sem meta digitada'
            }
            icon={Target}
            loading={loading}
            accent={
              c?.meta && c.total_implantados && c.total_implantados >= c.meta ? 'text-emerald-600' : undefined
            }
          />
        </div>

        {/* O bloco de hora: é aqui que "foi uma hora ou foram 40 minutos?" tem resposta. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Hora a hora do implante</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : blocos.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Nenhum bloco de implante registrado nesta cirurgia.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Hora</TableHead>
                      <TableHead className="pb-2">Lado</TableHead>
                      <TableHead className="pb-2">Implantador</TableHead>
                      <TableHead className="pb-2">Auxiliares</TableHead>
                      <TableHead className="pb-2 text-right">Início</TableHead>
                      <TableHead className="pb-2 text-right">Fim</TableHead>
                      <TableHead className="pb-2 text-right">Duração</TableHead>
                      <TableHead className="pb-2 text-right">Folículos</TableHead>
                      <TableHead className="pb-2 text-right">Por hora</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blocos.map((b) => (
                      <TableRow key={b.id} className="border-t border-border/20">
                        <TableCell className="py-1.5 tabular-nums">{b.hora}</TableCell>
                        <TableCell className="py-1.5">
                          {b.lado ? (LADO_LABEL[b.lado] ?? b.lado) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="py-1.5 font-medium">
                          {b.implantador ?? <span className="text-amber-600">Sem implantador</span>}
                        </TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">
                          {b.auxiliares.length > 0 ? b.auxiliares.join(', ') : '—'}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">
                          {relogio(b.inicio)}
                          {/* Início deduzido do fim do bloco anterior — pista, não medida. */}
                          {b.fonte_inicio === 'encadeado' ? (
                            <span
                              title="Início deduzido do fim do bloco anterior do mesmo lado; a sala não gravou esta ponta."
                              className="ml-1 text-[10px] text-amber-600"
                            >
                              ~
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{relogio(b.fim)}</TableCell>
                        <TableCell
                          className={cn(
                            'py-1.5 text-right font-medium tabular-nums',
                            b.duracao_min != null && b.duracao_min < 50 ? 'text-amber-600' : undefined,
                          )}
                        >
                          {b.duracao_suspeita_min != null ? (
                            <span
                              title={`O relógio registrou ${b.duracao_suspeita_min} min — impossível para um bloco. É data digitada errada na tela da sala.`}
                              className="text-destructive"
                            >
                              impossível
                            </span>
                          ) : (
                            duracao(b.duracao_min)
                          )}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{numero(b.foliculos)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                          {numero(b.foliculos_hora)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              A duração vem das duas pontas que a sala grava no bloco. Bloco marcado com{' '}
              <span className="font-medium text-amber-600">~</span> teve o início deduzido do fim do bloco anterior do
              mesmo lado — serve de pista, não de medida.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Quem fez o quê nesta cirurgia</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-24 w-full" />
              ) : pessoas.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Sem implantador registrado.</p>
              ) : (
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Implantador</TableHead>
                      <TableHead className="pb-2">Lado</TableHead>
                      <TableHead className="pb-2 text-right">Blocos</TableHead>
                      <TableHead className="pb-2 text-right">Tempo</TableHead>
                      <TableHead className="pb-2 text-right">Folículos</TableHead>
                      <TableHead className="pb-2 text-right">Por hora</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pessoas.map((p) => (
                      <TableRow key={p.implantador} className="border-t border-border/20">
                        <TableCell className="py-1.5 font-medium">{p.implantador}</TableCell>
                        <TableCell className="py-1.5 text-muted-foreground">
                          {(p.lados ?? '—')
                            .split('/')
                            .map((l) => LADO_LABEL[l] ?? l)
                            .join(' · ')}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">
                          {p.blocos_com_duracao < p.blocos ? `${p.blocos_com_duracao}/${p.blocos}` : p.blocos}
                        </TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{duracao(p.minutos)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{numero(p.foliculos)}</TableCell>
                        <TableCell className="py-1.5 text-right font-medium tabular-nums">
                          {numero(p.foliculos_hora)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Etapas cronometradas</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-24 w-full" />
              ) : etapas.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma etapa cronometrada.</p>
              ) : (
                <Table className="w-full text-xs">
                  <TableHeader>
                    <TableRow className="text-left text-muted-foreground">
                      <TableHead className="pb-2">Etapa</TableHead>
                      <TableHead className="pb-2 text-right">Início</TableHead>
                      <TableHead className="pb-2 text-right">Fim</TableHead>
                      <TableHead className="pb-2 text-right">Duração</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {etapas.map((e) => (
                      <TableRow key={e.etapa} className="border-t border-border/20">
                        <TableCell className="py-1.5">{ETAPA_LABEL[e.etapa] ?? e.etapa}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{relogio(e.inicio)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{relogio(e.fim)}</TableCell>
                        <TableCell className="py-1.5 text-right font-medium tabular-nums">
                          {duracaoEtapa(e.duracao_min)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Etapa com fim antes do início é marcação fora de ordem e aparece sem duração.
              </p>
            </CardContent>
          </Card>
        </div>

        {qa && (qa.sem_fim > 0 || qa.sem_inicio > 0 || qa.duracao_suspeita > 0 || qa.sem_implantador > 0) ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-semibold text-amber-700 dark:text-amber-500">Blocos com registro incompleto</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[
                  qa.sem_inicio > 0 ? `${qa.sem_inicio} sem início` : null,
                  qa.sem_fim > 0 ? `${qa.sem_fim} sem fim` : null,
                  qa.duracao_suspeita > 0 ? `${qa.duracao_suspeita} com duração impossível` : null,
                  qa.sem_implantador > 0 ? `${qa.sem_implantador} sem implantador` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                de {qa.blocos} blocos. A correção é na tela da sala — aqui é espelho de leitura, e o que for ajustado lá
                aparece aqui na próxima sincronização.
              </p>
            </div>
          </div>
        ) : null}

        <p className="text-[11px] text-muted-foreground">
          Espelho do sistema da enfermagem, sincronizado de 2 em 2 horas. Última leitura desta cirurgia:{' '}
          {c?.synced_at
            ? new Date(c.synced_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
            : '—'}
          .
        </p>
      </div>
    </AppLayout>
  )
}

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
