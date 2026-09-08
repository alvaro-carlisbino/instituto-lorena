import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { hojeLocal } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'
import {
  type Atendimento,
  type IndicacaoAtendimento,
  type Mes,
  type SemanaAtendimentos,
  limitesDoMes,
  listAtendimentos,
  mesAtual,
  mesComOffset,
  nomeDoMes,
  resumoDoMes,
  resumoPorSemana,
} from '@/services/atendimentos'
import { KANBAN_COLUNAS, type KanbanColuna } from '@/services/leadFollowups'

/**
 * O fechamento do MÊS, semana a semana e com os nomes.
 *
 * Duas coisas que a Aline pediu em 08/set, nesta ordem. Primeiro os nomes ("eu precisava
 * que tivesse o nome deles também, para a gente conseguir visualizar e não só números"):
 * "23%" não diz com quem falar hoje, e é o mesmo motivo pelo qual a planilha dela nunca
 * virou gráfico. Depois o recorte ("tem como deixar só do mês de setembro?"): a planilha é
 * uma aba por mês ("AGOSTO//2026") e a clínica fecha meta por mês, então oito semanas
 * corridas atravessando a virada não é a leitura que ela faz.
 *
 * Denominador é o ATENDIMENTO, não a ligação: das pessoas que saíram do consultório com
 * indicação naquele mês, quantas compraram. Por isso a conta mora aqui e não no quadro de
 * follow-up. O quadro conta trabalho, esta faixa conta safra.
 *
 * Semana marcada como incompleta não é enfeite de rodapé: até 24/ago o CRM só guardava o
 * atendimento que virou venda, então aquelas semanas fecham perto de 100% por construção.
 * Mostrar 100% sem dizer isso seria mentir com número.
 */

const ptBr = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

const reais = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const ROTULO_COLUNA = new Map<string, string>(KANBAN_COLUNAS.map((c) => [c.id as KanbanColuna, c.label]))

/**
 * Onde o paciente que não fechou está parado hoje. Sem isto a lista de "não fecharam"
 * viraria uma lápide: ela precisa saber se ainda tem contato marcado ou se o card morreu.
 */
function ondeEsta(a: Atendimento): string {
  if (!a.coluna) return 'sem contato marcado'
  // O rótulo da coluna "Atendimentos" só faz sentido no cabeçalho dela. Aqui, em cima do
  // nome de uma pessoa, "atendimentos" não diz nada: o que ela precisa saber é que
  // ninguém encostou nesse paciente ainda.
  if (a.coluna === 'atendimento') return 'aguardando 1º contato'
  return ROTULO_COLUNA.get(a.coluna)?.toLowerCase() ?? a.coluna
}

function linhaDoPaciente(a: Atendimento) {
  const detalhe = [
    `${a.tipo === 'retorno' ? 'Retorno' : 'Consulta'} ${ptBr(a.atendidoEm)}`,
    a.medico,
    a.cidade,
    a.origem,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      key={a.id}
      className="flex items-start justify-between gap-2 rounded-md border border-border px-2 py-1.5"
    >
      <div className="min-w-0">
        {a.leadId ? (
          <Link
            to={`/leads/${a.leadId}`}
            className="block truncate text-sm font-medium leading-tight hover:underline"
          >
            {a.paciente}
          </Link>
        ) : (
          <p className="truncate text-sm font-medium leading-tight">{a.paciente}</p>
        )}
        <p className="truncate text-xs text-muted-foreground">{detalhe}</p>
      </div>
      {a.fechou ? (
        <Badge className="shrink-0 bg-emerald-600 text-[10px] text-white hover:bg-emerald-600">
          {a.valorCents ? reais(a.valorCents) : 'Fechou'}
        </Badge>
      ) : (
        <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
          {ondeEsta(a)}
        </Badge>
      )}
    </div>
  )
}

export function AtendimentosSemana({
  indicacao,
  recarregar,
}: {
  indicacao: IndicacaoAtendimento
  /** Muda quando o quadro recarrega: atendimento novo tem de aparecer na safra na hora. */
  recarregar: number
}) {
  const [mes, setMes] = useState<Mes>(() => mesAtual())
  const [linhas, setLinhas] = useState<Atendimento[]>([])
  const [erro, setErro] = useState<string | null>(null)
  /** null = a semana mais recente do mês. Só vira escolha explícita quando ela clica. */
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const hoje = hojeLocal()
  const limites = useMemo(() => limitesDoMes(mes), [mes])

  useEffect(() => {
    let vivo = true
    listAtendimentos({ indicacao, desde: limites.primeiro, ate: limites.ultimo })
      .then((rows) => {
        if (!vivo) return
        setLinhas(rows)
        setErro(null)
      })
      .catch((e: unknown) => {
        if (!vivo) return
        setErro(e instanceof Error ? e.message : 'Falha ao ler os atendimentos')
      })
    return () => {
      vivo = false
    }
  }, [indicacao, recarregar, limites])

  const semanas = useMemo(
    // Um mês tem no máximo seis pedaços de semana; o corte não esconde nada.
    () => resumoPorSemana(linhas, { quantas: 6, limites }),
    [linhas, limites],
  )
  const mesInteiro = useMemo(() => resumoDoMes(linhas), [linhas])

  // Trocar de mês ou de fila troca as semanas, e a escolhida pode não existir mais.
  // Cair na mais recente é melhor que mostrar lista vazia.
  const aberta: SemanaAtendimentos | null =
    semanas.find((s) => s.inicio === escolhida) ?? semanas[0] ?? null

  const daSemana = useMemo(() => {
    if (!aberta) return { fecharam: [] as Atendimento[], abertos: [] as Atendimento[] }
    // Por FAIXA DE DATA, não pela segunda-feira: a semana que atravessa a virada do mês vem
    // recortada, e agrupar pela segunda traria de volta o que é do mês anterior.
    const itens = linhas
      .filter((a) => a.atendidoEm >= aberta.inicio && a.atendidoEm <= aberta.fim)
      .sort((x, y) => x.atendidoEm.localeCompare(y.atendidoEm) || x.paciente.localeCompare(y.paciente))
    return {
      fecharam: itens.filter((i) => i.fechou),
      abertos: itens.filter((i) => !i.fechou),
    }
  }, [linhas, aberta])

  const cabecalho = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5">
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          title="Mês anterior"
          onClick={() => setMes((m) => mesComOffset(m, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <p className="min-w-36 text-center text-xs font-medium first-letter:uppercase">{nomeDoMes(mes)}</p>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          title="Mês seguinte"
          // Mês que ainda não começou não tem atendimento nenhum: o botão só levaria a uma
          // tela vazia e à dúvida de se o sistema perdeu alguém.
          disabled={mes >= mesAtual()}
          onClick={() => setMes((m) => mesComOffset(m, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {mesInteiro.pct == null ? '—' : `${mesInteiro.pct}%`}
        </span>{' '}
        no mês · {mesInteiro.fecharam} de {mesInteiro.atendimentos} atendimentos
        {mesInteiro.receitaCents > 0 ? ` · ${reais(mesInteiro.receitaCents)}` : ''}
      </p>
      {mesInteiro.incompleta && (
        <Badge
          variant="outline"
          className="text-[10px] font-normal"
          title="Neste mês há atendimento que só ficou gravado porque virou venda. Quem não fechou naquela época não foi registrado, então a taxa sai por cima."
        >
          safra incompleta
        </Badge>
      )}
    </div>
  )

  if (erro) {
    return (
      <div className="rounded-md border border-border p-2">
        {cabecalho}
        <p className="mt-1 text-xs text-muted-foreground">
          Fechamento por semana indisponível: {erro}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border p-2">
      {cabecalho}

      {semanas.length === 0 ? (
        <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
          Nenhum atendimento registrado em {nomeDoMes(mes)}.
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-stretch gap-2 overflow-x-auto pb-1">
            {semanas.map((s) => {
              const emCurso = hoje >= s.inicio && hoje <= s.fim
              return (
                <button
                  key={s.inicio}
                  type="button"
                  onClick={() => setEscolhida(s.inicio)}
                  className={cn(
                    'shrink-0 rounded-md border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-accent',
                    emCurso && 'border-primary/60',
                    s.inicio === aberta?.inicio && 'bg-accent',
                  )}
                  title="Ver quem foi atendido nesta semana"
                >
                  <p className="text-[11px] text-muted-foreground">
                    {ptBr(s.inicio)} a {ptBr(s.fim)}
                    {emCurso ? ' · em curso' : ''}
                  </p>
                  <p className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        'text-base font-semibold tabular-nums',
                        s.incompleta && 'text-muted-foreground',
                      )}
                    >
                      {s.pct == null ? '—' : `${s.pct}%`}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {s.fecharam}/{s.atendimentos}
                    </span>
                  </p>
                  {s.incompleta && (
                    <Badge variant="outline" className="mt-0.5 text-[10px] font-normal">
                      só quem fechou
                    </Badge>
                  )}
                </button>
              )
            })}
          </div>

          {/* Os nomes. Em duas listas porque a pergunta dela é "quem fechou e quem não":
              uma lista só, ordenada por data, obriga a ler badge por badge. */}
          {aberta && (
            <div className="mt-2 grid gap-3 border-t border-border pt-2 md:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-500">
                  Fecharam ({daSemana.fecharam.length})
                </p>
                {daSemana.fecharam.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Ninguém fechou nesta semana ainda.</p>
                ) : (
                  <div className="space-y-1">{daSemana.fecharam.map(linhaDoPaciente)}</div>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium">Ainda não fecharam ({daSemana.abertos.length})</p>
                {daSemana.abertos.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {daSemana.fecharam.length > 0
                      ? 'Todo mundo desta semana fechou.'
                      : 'Nenhum atendimento registrado nesta semana.'}
                  </p>
                ) : (
                  <div className="space-y-1">{daSemana.abertos.map(linhaDoPaciente)}</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
