import { useEffect, useState } from 'react'
import { AlertTriangle, PhoneCall, TrendingUp } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  atrasoDeLancamento,
  fetchConversaoConsulta,
  ganhoDoFollowUp,
  type ConversaoConsulta,
} from '@/services/conversaoConsulta'

/**
 * "De quem sentou na cadeira, quantos compraram" — a conta que a Aline fazia de
 * cabeça e o painel não mostrava.
 *
 * Dois cenários lado a lado porque a diferença entre eles É a informação: o
 * primeiro é o que fechou dentro do mês, o segundo inclui o que o follow-up
 * fechou depois. Mostrar só o primeiro apaga o trabalho de recuperação; mostrar
 * só o segundo faz o mês corrente parecer pior do que é, porque a safra ainda
 * está rendendo.
 */

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const diaCurto = (iso: string | null) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—')

/** 35.6 → "35,6". O Postgres devolve ponto e o Brasil lê vírgula. */
const pct = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

function Cenario({
  titulo,
  explicacao,
  valor,
  vendas,
  pacientes,
  receitaCents,
  destaque,
  icone: Icone,
}: {
  titulo: string
  explicacao: string
  /** A porcentagem já calculada pela RPC. */
  valor: number | null
  vendas: number
  pacientes: number
  receitaCents: number
  destaque?: boolean
  icone: typeof TrendingUp
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border p-4',
        destaque ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-muted/20',
      )}
    >
      <div className="absolute top-0 right-0 p-3 opacity-[0.06]" aria-hidden>
        <Icone className="size-12" />
      </div>
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p className="mt-1 font-heading text-3xl tabular-nums">{pct(valor)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {vendas} de {pacientes} {pacientes === 1 ? 'paciente' : 'pacientes'} · {brl(receitaCents)}
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/80">{explicacao}</p>
    </div>
  )
}

export function ConversaoConsultaCard({ mes, kind, rotuloMes }: { mes: string; kind: string; rotuloMes: string }) {
  const [dados, setDados] = useState<ConversaoConsulta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro(null)
    fetchConversaoConsulta(mes, kind)
      .then((r) => !cancelado && setDados(r))
      .catch((e) => !cancelado && setErro(e instanceof Error ? e.message : 'Falha ao calcular a conversão.'))
      .finally(() => !cancelado && setCarregando(false))
    return () => {
      cancelado = true
    }
  }, [mes, kind])

  const ganho = ganhoDoFollowUp(dados)
  const atraso = atrasoDeLancamento(dados)
  const semConsulta = !carregando && dados != null && dados.pacientes === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Conversão da consulta
          <span className="text-xs font-normal text-muted-foreground">
            {rotuloMes} · {dados?.pacientes ?? 0} {dados?.pacientes === 1 ? 'paciente em consulta' : 'pacientes em consulta'}
            {dados && dados.agendamentos !== dados.pacientes ? ` (${dados.agendamentos} agendamentos)` : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {erro ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {erro}
          </p>
        ) : carregando ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : semConsulta ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nenhuma consulta na agenda da Shosp neste mês. A conversão precisa da agenda para ter denominador — sem ela
            não dá para dizer de quantos pacientes as vendas vieram.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Cenario
                titulo="No mês"
                explicacao="Consulta e venda dentro do mesmo mês. É o que casa com a meta e com o fechamento."
                valor={dados?.cenario_mes.pct ?? null}
                vendas={dados?.cenario_mes.vendas ?? 0}
                pacientes={dados?.pacientes ?? 0}
                receitaCents={dados?.cenario_mes.receita_cents ?? 0}
                icone={TrendingUp}
              />
              <Cenario
                titulo="Com follow-up"
                explicacao="As mesmas consultas, contando também o que fechou depois do mês. Mede a recuperação."
                valor={dados?.cenario_followup.pct ?? null}
                vendas={dados?.cenario_followup.vendas ?? 0}
                pacientes={dados?.pacientes ?? 0}
                receitaCents={dados?.cenario_followup.receita_cents ?? 0}
                destaque
                icone={PhoneCall}
              />
            </div>

            {ganho.vendas > 0 ? (
              <p className="text-xs text-muted-foreground">
                O follow-up acrescentou{' '}
                <span className="font-semibold text-foreground">
                  {ganho.vendas} venda{ganho.vendas > 1 ? 's' : ''}
                </span>{' '}
                a esta safra, {brl(ganho.receitaCents)}
                {ganho.pontos ? ` e ${pct(ganho.pontos).replace('%', '')} pontos de conversão` : ''}. Sem ligar de volta, a conversão do mês
                teria parado nos {pct(dados?.cenario_mes.pct)}.
              </p>
            ) : dados?.em_curso ? (
              <p className="text-xs text-muted-foreground">
                O follow-up ainda não acrescentou nada a esta safra, o que é normal num mês em curso: a consulta de hoje
                pode fechar em setembro e só então os dois números se separam.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nesta safra os dois cenários são iguais: tudo o que fechou, fechou dentro do mês. Nenhuma venda veio de
                follow-up de consulta deste mês.
              </p>
            )}

            {/* O furo que faria o card mentir: a agenda entra sozinha e vai até
                hoje, a venda é digitada e atrasa. */}
            {atraso != null ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <p className="text-xs leading-relaxed">
                  <span className="font-semibold text-amber-700 dark:text-amber-500">
                    A última venda lançada é de {diaCurto(dados?.ultima_venda_registrada ?? null)}, há {atraso} dias
                  </span>
                  , mas a agenda já contou consulta até {diaCurto(dados?.ate_dia ?? null)}. Enquanto o lançamento não
                  alcança a agenda, esta conversão é PISO: o numerador está atrasado e o denominador não.
                </p>
              </div>
            ) : null}
          </>
        )}

        <p className="border-t border-border/40 pt-2 text-[11px] leading-relaxed text-muted-foreground">
          Conta paciente, não agendamento: quem passa duas vezes no mês decide uma vez. Consulta é a mesma leitura da
          fila de pós-consulta (hora passada, sem desmarcação nem falta, fora do spa, e retorno/lavagem/protocolo não
          entram). O denominador é da clínica inteira e não muda com o filtro de consultora.
        </p>
      </CardContent>
    </Card>
  )
}
