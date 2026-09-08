import { useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { diaLocalComOffset } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'
import {
  type IndicacaoAtendimento,
  type SemanaAtendimentos,
  listAtendimentos,
  resumoPorSemana,
  segundaDaSemana,
} from '@/services/atendimentos'

/**
 * A porcentagem de fechamento da semana, que é o que a planilha da Aline responde de olho
 * (linha verde fechou, linha rosa não) e o CRM não sabia responder.
 *
 * Denominador é o ATENDIMENTO, não a ligação: das pessoas que saíram do consultório com
 * indicação naquela semana, quantas compraram. Por isso a conta mora aqui e não no quadro
 * de follow-up — o quadro conta trabalho, esta faixa conta safra.
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

export function AtendimentosSemana({
  indicacao,
  recarregar,
}: {
  indicacao: IndicacaoAtendimento
  /** Muda quando o quadro recarrega: atendimento novo tem de aparecer na safra na hora. */
  recarregar: number
}) {
  const [semanas, setSemanas] = useState<SemanaAtendimentos[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const semanaAtual = useMemo(() => segundaDaSemana(diaLocalComOffset(0)), [])

  useEffect(() => {
    let vivo = true
    // Oito semanas para caber a comparação que ela faz ("essa semana contra a passada")
    // com folga, sem virar relatório.
    listAtendimentos({ indicacao, desde: diaLocalComOffset(-56) })
      .then((linhas) => {
        if (!vivo) return
        setSemanas(resumoPorSemana(linhas, 6))
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

  if (erro) {
    return <p className="text-xs text-muted-foreground">Fechamento por semana indisponível: {erro}</p>
  }
  if (semanas.length === 0) return null

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
      <div className="flex shrink-0 flex-col justify-center pr-1">
        <p className="text-xs font-medium">Fechamento</p>
        <p className="text-[11px] text-muted-foreground">por semana</p>
      </div>
      {semanas.map((s) => {
        const atual = s.inicio === semanaAtual
        return (
          <div
            key={s.inicio}
            className={cn(
              'shrink-0 rounded-md border border-border px-2.5 py-1.5',
              atual && 'border-primary/60 bg-primary/5',
            )}
            title={
              s.incompleta
                ? 'Semana anterior ao registro de atendimentos: só quem fechou ficou gravado, então a taxa sai por cima.'
                : `${s.fecharam} de ${s.atendimentos} atendimentos fecharam${
                    s.receitaCents > 0 ? ` · ${reais(s.receitaCents)}` : ''
                  }`
            }
          >
            <p className="text-[11px] text-muted-foreground">
              {ptBr(s.inicio)}–{ptBr(s.fim)}
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
          </div>
        )
      })}
    </div>
  )
}
