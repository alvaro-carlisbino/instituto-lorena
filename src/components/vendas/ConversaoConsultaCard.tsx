import { useEffect, useState } from 'react'
import { AlertTriangle, PhoneCall, TrendingUp } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  atrasoDeLancamento,
  fetchConversaoConsulta,
  ganhoDoFollowUp,
  vendasForaDaConta,
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
  const fora = vendasForaDaConta(dados)
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
                titulo="Das consultas do mês"
                explicacao="Consulta gerada no mês que virou venda ainda no mês. É a safra: casa com a meta e com o fechamento."
                valor={dados?.cenario_mes.pct ?? null}
                vendas={dados?.cenario_mes.vendas ?? 0}
                pacientes={dados?.pacientes ?? 0}
                receitaCents={dados?.cenario_mes.receita_cents ?? 0}
                icone={TrendingUp}
              />
              <Cenario
                titulo="Fechado no mês (com follow-up)"
                explicacao="Tudo o que fechou dentro do mês, inclusive de consulta de meses atrás. É o caixa do mês."
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
                Do que fechou neste mês,{' '}
                <span className="font-semibold text-foreground">
                  {ganho.vendas} venda{ganho.vendas > 1 ? 's' : ''} ({brl(ganho.receitaCents)})
                </span>{' '}
                veio de consulta de mês anterior — é o follow-up trabalhando. Sem ele, o mês teria parado nos{' '}
                {pct(dados?.cenario_mes.pct)}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Neste mês nenhuma venda veio de consulta de mês anterior: tudo o que fechou nasceu de consulta do
                próprio mês. Quando o follow-up resgatar uma consulta antiga, ela aparece aqui.
              </p>
            )}

            {/* O denominador é o mesmo para os dois tipos de venda: uma consulta pode virar
                cirurgia OU protocolo, e medir cada uma contra o bolo inteiro esconde isso. */}
            {dados && dados.outro_kind?.pacientes > 0 ? (
              <p className="text-xs text-muted-foreground">
                Das mesmas consultas,{' '}
                <span className="font-semibold text-foreground">
                  {dados.outro_kind.pacientes} paciente{dados.outro_kind.pacientes > 1 ? 's' : ''}
                </span>{' '}
                fechou {dados.outro_kind.kind === 'protocolo' ? 'protocolo' : 'cirurgia'} em vez de{' '}
                {dados.kind === 'cirurgia' ? 'cirurgia' : 'protocolo'}. O denominador é compartilhado: não é tudo
                perda.
              </p>
            ) : null}

            {/* Venda que não casa com consulta nenhuma: fora da conta, mas na tela. */}
            {fora.vendas > 0 ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {fora.vendas} venda{fora.vendas > 1 ? 's' : ''} ({brl(fora.receitaCents)})
                </span>{' '}
                da safra do mês não entrou nesta conta: não há prontuário na venda nem no lead que ligue o paciente a
                uma consulta da agenda. Enquanto isso não é preenchido, a taxa é PISO.
              </p>
            ) : null}

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
          entram). A venda só entra quando dá para ligá-la a um paciente que consultou, pelo prontuário da venda ou do
          lead. O denominador é da clínica inteira, ainda sem separar consulta de transplante das demais, e não muda
          com o filtro de consultora.
        </p>
      </CardContent>
    </Card>
  )
}
