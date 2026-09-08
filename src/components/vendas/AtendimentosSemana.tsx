import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { diaLocalComOffset } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'
import {
  type Atendimento,
  type IndicacaoAtendimento,
  type SemanaAtendimentos,
  listAtendimentos,
  resumoPorSemana,
  segundaDaSemana,
} from '@/services/atendimentos'
import { KANBAN_COLUNAS, type KanbanColuna } from '@/services/leadFollowups'

/**
 * A porcentagem de fechamento da semana COM OS NOMES, que é o que a planilha da Aline
 * responde de olho (linha verde fechou, linha rosa não) e o CRM não sabia responder.
 *
 * O número sozinho não serve: "23%" não diz com quem falar hoje. Ela pediu explicitamente
 * ("eu precisava que tivesse o nome deles também, para a gente conseguir visualizar e não
 * só números"), e é o mesmo motivo pelo qual a planilha nunca foi um gráfico — a lista É a
 * ferramenta de trabalho, a porcentagem é o resumo dela.
 *
 * Denominador é o ATENDIMENTO, não a ligação: das pessoas que saíram do consultório com
 * indicação naquela semana, quantas compraram. Por isso a conta mora aqui e não no quadro
 * de follow-up. O quadro conta trabalho, esta faixa conta safra.
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
  const [linhas, setLinhas] = useState<Atendimento[]>([])
  const [semanas, setSemanas] = useState<SemanaAtendimentos[]>([])
  const [erro, setErro] = useState<string | null>(null)
  /** null = a mais recente. Só vira escolha explícita quando ela clica em outra. */
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const semanaAtual = useMemo(() => segundaDaSemana(diaLocalComOffset(0)), [])

  useEffect(() => {
    let vivo = true
    // Oito semanas para caber a comparação que ela faz ("essa semana contra a passada")
    // com folga, sem virar relatório.
    listAtendimentos({ indicacao, desde: diaLocalComOffset(-56) })
      .then((rows) => {
        if (!vivo) return
        setLinhas(rows)
        setSemanas(resumoPorSemana(rows, 6))
        setErro(null)
      })
      .catch((e: unknown) => {
        if (!vivo) return
        setErro(e instanceof Error ? e.message : 'Falha ao ler os atendimentos')
      })
    return () => {
      vivo = false
    }
  }, [indicacao, recarregar])

  // Trocar de fila (transplante/protocolo) recarrega a lista, e a semana escolhida pode
  // não existir mais lá. Cair na mais recente é melhor que mostrar lista vazia.
  const aberta = semanas.some((s) => s.inicio === escolhida) ? escolhida : (semanas[0]?.inicio ?? null)

  const daSemana = useMemo(() => {
    if (!aberta) return { fecharam: [] as Atendimento[], abertos: [] as Atendimento[] }
    const itens = linhas
      .filter((a) => segundaDaSemana(a.atendidoEm) === aberta)
      .sort((x, y) => x.atendidoEm.localeCompare(y.atendidoEm) || x.paciente.localeCompare(y.paciente))
    return {
      fecharam: itens.filter((i) => i.fechou),
      abertos: itens.filter((i) => !i.fechou),
    }
  }, [linhas, aberta])

  if (erro) {
    return <p className="text-xs text-muted-foreground">Fechamento por semana indisponível: {erro}</p>
  }
  if (semanas.length === 0) return null

  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        <div className="flex shrink-0 flex-col justify-center pr-1">
          <p className="text-xs font-medium">Fechamento</p>
          <p className="text-[11px] text-muted-foreground">por semana</p>
        </div>
        {semanas.map((s) => {
          const atual = s.inicio === semanaAtual
          return (
            <button
              key={s.inicio}
              type="button"
              onClick={() => setEscolhida(s.inicio)}
              className={cn(
                'shrink-0 rounded-md border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-accent',
                atual && 'border-primary/60',
                s.inicio === aberta && 'bg-accent',
              )}
              title="Ver quem foi atendido nesta semana"
            >
              <p className="text-[11px] text-muted-foreground">
                {ptBr(s.inicio)} a {ptBr(s.fim)}
                {atual ? ' · em curso' : ''}
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
    </div>
  )
}
