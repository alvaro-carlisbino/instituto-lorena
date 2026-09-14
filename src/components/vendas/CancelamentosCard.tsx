import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarX2, ChevronDown, Scissors } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  fetchCancelamentosDoMes,
  linhasDeCancelamento,
  resumoCancelamentos,
  type CancelamentosDoMes,
  type LinhaCancelamento,
} from '@/services/cancelamentos'

/**
 * Consulta desmarcada e cirurgia cancelada no mês.
 *
 * A Central mede TC (14/09/2026): protocolo cancelado sai do card. A consulta segue
 * contando toda consulta da clínica, porque a agenda da Shosp não diz o tipo da
 * maioria delas.
 */

const brl = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const dia = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—')

const TIPO: Record<LinhaCancelamento['tipo'], { rotulo: string; classe: string }> = {
  consulta: { rotulo: 'Consulta', classe: 'border-sky-500/40 text-sky-700 dark:text-sky-400' },
  protocolo: { rotulo: 'Protocolo', classe: 'border-violet-500/40 text-violet-700 dark:text-violet-400' },
  cirurgia: { rotulo: 'Cirurgia', classe: 'border-rose-500/40 text-rose-700 dark:text-rose-400' },
}

function Numero({
  rotulo,
  qtd,
  detalhe,
  icone: Icone,
}: {
  rotulo: string
  qtd: number
  detalhe: string
  icone: typeof CalendarX2
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icone className="size-3.5 shrink-0" aria-hidden />
        {rotulo}
      </p>
      <p className={cn('font-heading text-2xl tabular-nums', qtd > 0 && 'text-destructive')}>{qtd}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detalhe}</p>
    </div>
  )
}

export function CancelamentosCard({ mes, rotuloMes }: { mes: string; rotuloMes: string }) {
  // O resultado guarda de qual mês é: trocar o mês volta a "carregando" sem apagar
  // estado dentro do efeito, e resposta atrasada de outro mês nunca aparece.
  const [resultado, setResultado] = useState<{
    mes: string
    dados: CancelamentosDoMes | null
    erro: string | null
  } | null>(null)
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    let cancelado = false
    fetchCancelamentosDoMes(mes)
      .then((dados) => !cancelado && setResultado({ mes, dados, erro: null }))
      .catch(
        (e) =>
          !cancelado &&
          setResultado({
            mes,
            dados: null,
            erro: e instanceof Error ? e.message : 'Falha ao carregar os cancelamentos.',
          }),
      )
    return () => {
      cancelado = true
    }
  }, [mes])

  const carregando = resultado?.mes !== mes
  const dados = carregando ? null : resultado.dados
  const erro = carregando ? null : resultado.erro

  const doTc = useMemo(
    () => (dados ? { ...dados, vendas: dados.vendas.filter((v) => v.kind === 'cirurgia') } : null),
    [dados],
  )
  const resumo = useMemo(() => resumoCancelamentos(doTc), [doTc])
  const linhas = useMemo(() => linhasDeCancelamento(doTc), [doTc])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Cancelamentos
          <span className="text-xs font-normal text-muted-foreground">
            {rotuloMes} · consultas e cirurgias
          </span>
        </CardTitle>
        {resumo.total > 0 && (
          <CardAction>
            <Button size="sm" variant="outline" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
              {aberto ? 'Esconder lista' : `Ver quem cancelou (${resumo.total})`}
              <ChevronDown className={cn('size-3.5 transition-transform', aberto && 'rotate-180')} aria-hidden />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {erro ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {erro}
          </p>
        ) : carregando ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Numero
                rotulo="Consultas desmarcadas"
                icone={CalendarX2}
                qtd={resumo.consultas.qtd}
                detalhe={
                  resumo.consultas.qtd === 0
                    ? 'nenhuma no mês'
                    : resumo.consultas.remarcaram > 0
                      ? `${resumo.consultas.remarcaram} ${resumo.consultas.remarcaram === 1 ? 'remarcou' : 'remarcaram'} · ${resumo.consultas.semNovaData} sem nova data`
                      : 'nenhuma remarcou até agora'
                }
              />
              <Numero
                rotulo="Cirurgias canceladas"
                icone={Scissors}
                qtd={resumo.cirurgia.qtd}
                detalhe={resumo.cirurgia.qtd > 0 ? `${brl(resumo.cirurgia.valorCents)} em vendas` : 'nenhuma no mês'}
              />
            </div>

            {(dados?.vendas_sem_data_de_cancelamento ?? 0) > 0 && (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                <p className="text-xs leading-relaxed">
                  {dados?.vendas_sem_data_de_cancelamento} venda
                  {dados?.vendas_sem_data_de_cancelamento === 1 ? ' cancelada está' : 's canceladas estão'} sem a
                  data do cancelamento e não entra em mês nenhum. Aparecem na lista de vendas com o filtro
                  &ldquo;Só canceladas&rdquo;.
                </p>
              </div>
            )}

            {aberto && linhas.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableCaption className="sr-only">
                    {`${linhas.length} cancelamentos em ${rotuloMes}. `}
                    No celular a tabela mostra tipo, data e paciente; motivo e valor vão junto do nome.
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Tipo</TableHead>
                      <TableHead scope="col">Data</TableHead>
                      <TableHead scope="col" className="min-w-40">Paciente</TableHead>
                      <TableHead scope="col" className="hidden md:table-cell">O quê</TableHead>
                      <TableHead scope="col" className="hidden lg:table-cell">Motivo ou observação</TableHead>
                      <TableHead scope="col" className="hidden text-right sm:table-cell">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhas.map((l) => (
                      <TableRow key={l.chave}>
                        <TableCell>
                          <Badge variant="outline" className={TIPO[l.tipo].classe}>
                            {TIPO[l.tipo].rotulo}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{dia(l.data)}</TableCell>
                        <TableCell className="min-w-40">
                          {l.leadId ? (
                            <Link
                              to={`/leads/${l.leadId}`}
                              className="font-medium text-primary underline-offset-2 hover:underline"
                            >
                              {l.paciente}
                            </Link>
                          ) : (
                            <span className="font-medium">{l.paciente}</span>
                          )}
                          {l.remarcadaPara && (
                            <div className="text-xs text-emerald-700 dark:text-emerald-500">
                              remarcou para {dia(l.remarcadaPara)}
                            </div>
                          )}
                          {/* O que as colunas escondidas no celular diriam. */}
                          <div className="text-xs text-muted-foreground lg:hidden">{l.motivo}</div>
                          {l.valorCents != null && (
                            <div className="text-xs text-muted-foreground sm:hidden">{brl(l.valorCents)}</div>
                          )}
                        </TableCell>
                        <TableCell className="hidden max-w-[240px] md:table-cell">
                          <div className="truncate">{l.oque ?? (l.tipo === 'consulta' ? 'Consulta' : '—')}</div>
                          {l.detalhe && <div className="truncate text-xs text-muted-foreground">{l.detalhe}</div>}
                        </TableCell>
                        <TableCell className="hidden max-w-[280px] text-sm lg:table-cell">
                          {l.motivo ?? <span className="text-xs text-muted-foreground">sem observação</span>}
                        </TableCell>
                        <TableCell className="hidden text-right whitespace-nowrap sm:table-cell">
                          {l.valorCents != null ? (
                            <>
                              <div>{brl(l.valorCents)}</div>
                              {l.estorno && <div className="text-xs text-muted-foreground">estorno: {l.estorno}</div>}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
