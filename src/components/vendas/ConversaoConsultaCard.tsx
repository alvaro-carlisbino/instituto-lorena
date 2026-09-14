import { useEffect, useState } from 'react'
import { PhoneCall, TrendingUp } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { fetchConversaoConsulta, taxaProjetada, type ConversaoConsulta } from '@/services/conversaoConsulta'

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
  piso,
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
  /**
   * Onde a taxa cai se as consultas que a agenda não classifica entrarem no denominador. Vai
   * colado no número grande de propósito: é esse que sai da tela e vira meta na reunião.
   */
  piso?: number | null
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
      <p className="mt-1 font-heading text-3xl tabular-nums">
        {pct(valor)}
        {piso != null ? (
          <span className="ml-1.5 font-sans text-xs font-medium text-amber-700 dark:text-amber-500">
            piso {pct(piso)}
          </span>
        ) : null}
      </p>
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

  const projetada = taxaProjetada(dados)
  const semConsulta = !carregando && dados != null && dados.pacientes === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          Conversão da consulta
          <span className="text-xs font-normal text-muted-foreground">
            {rotuloMes} · {dados?.pacientes ?? 0} {dados?.pacientes === 1 ? 'paciente' : 'pacientes'} em{' '}
            {dados?.denominador?.tipo_usado === 'tc' ? 'consulta de transplante' : 'consulta'}
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
            Nenhuma consulta na agenda da Shosp neste mês.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Cenario
              titulo="Das consultas do mês"
              explicacao="Consulta do mês que fechou no próprio mês."
              valor={dados?.cenario_mes.pct ?? null}
              vendas={dados?.cenario_mes.vendas ?? 0}
              pacientes={dados?.pacientes ?? 0}
              receitaCents={dados?.cenario_mes.receita_cents ?? 0}
              piso={projetada?.pctSafra}
              icone={TrendingUp}
            />
            <Cenario
              titulo="Fechado no mês (com follow-up)"
              explicacao="Tudo o que fechou no mês, inclusive de consulta de meses anteriores."
              valor={dados?.cenario_followup.pct ?? null}
              vendas={dados?.cenario_followup.vendas ?? 0}
              pacientes={dados?.pacientes ?? 0}
              receitaCents={dados?.cenario_followup.receita_cents ?? 0}
              piso={projetada?.pctCaixa}
              destaque
              icone={PhoneCall}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
