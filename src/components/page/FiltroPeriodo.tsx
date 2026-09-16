import { useMemo, useState } from 'react'
import { CalendarDays } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  mesAtual,
  mesComOffset,
  periodoDaSemana,
  periodoDoDia,
  periodoDoMes,
  periodoDoMesInteiro,
  periodoEsteAno,
  periodoPersonalizado,
  periodoUltimosDias,
  type Periodo,
} from '@/lib/periodo'
import { cn } from '@/lib/utils'

/**
 * Filtro de período padrão das telas de resultado e do financeiro. As contas de
 * calendário moram em `@/lib/periodo` — aqui é só o controle.
 */

const ATALHOS: Array<{ id: string; label: string; build: () => Periodo }> = [
  { id: 'dias:7', label: '7 dias', build: () => periodoUltimosDias(7) },
  { id: 'dias:30', label: '30 dias', build: () => periodoUltimosDias(30) },
  { id: 'dias:90', label: '90 dias', build: () => periodoUltimosDias(90) },
  { id: 'mes-atual', label: 'Este mês', build: () => periodoDoMes(mesAtual()) },
  { id: 'mes-passado', label: 'Mês passado', build: () => periodoDoMes(mesComOffset(mesAtual(), -1)) },
  // Agenda: olham para frente (contato marcado, cirurgia marcada).
  { id: 'hoje', label: 'Hoje', build: () => periodoDoDia(0) },
  { id: 'amanha', label: 'Amanhã', build: () => periodoDoDia(1) },
  { id: 'semana', label: 'Esta semana', build: () => periodoDaSemana(0) },
  { id: 'semana-que-vem', label: 'Semana que vem', build: () => periodoDaSemana(1) },
  { id: 'mes-inteiro', label: 'Este mês', build: () => periodoDoMesInteiro(mesAtual()) },
]

/** O padrão olha para trás. Os de agenda só aparecem quando a tela pede por `atalhos`. */
const ATALHOS_DE_RESULTADO = ['dias:7', 'dias:30', 'dias:90', 'mes-atual', 'mes-passado']

export function FiltroPeriodo({
  valor,
  onChange,
  atalhos = ATALHOS_DE_RESULTADO,
  agenda = false,
  className,
}: {
  valor: Periodo
  onChange: (p: Periodo) => void
  /** Quais atalhos mostrar, na ordem. */
  atalhos?: string[]
  /**
   * Tela de agenda (o que está MARCADO): o mês escolhido vai até o último dia e aceita mês
   * futuro, e some o "Ano todo", que para em hoje.
   */
  agenda?: boolean
  className?: string
}) {
  const [aberto, setAberto] = useState(false)

  const visiveis = useMemo(
    () => atalhos.map((id) => ATALHOS.find((a) => a.id === id)).filter((a) => a != null),
    [atalhos],
  )

  // "Este mês" e "Mês passado" geram id `mes:YYYY-MM`; o botão precisa reconhecer
  // o próprio período para ficar aceso.
  const idAtivo = (atalho: (typeof ATALHOS)[number]) =>
    atalho.build().id === valor.id ? atalho.id : null

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex flex-wrap gap-1">
        {visiveis.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant={idAtivo(a) ? 'default' : 'outline'}
            onClick={() => onChange(a.build())}
          >
            {a.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={aberto ? 'secondary' : 'ghost'}
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
        >
          <CalendarDays className="size-3.5" />
          Outro período
        </Button>
      </div>

      {aberto ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="fp-mes" className="text-[11px] text-muted-foreground">
              Mês fechado
            </Label>
            <Input
              id="fp-mes"
              type="month"
              max={agenda ? undefined : mesAtual()}
              value={/^mes(-inteiro)?:/.test(valor.id) ? valor.id.slice(valor.id.indexOf(':') + 1) : ''}
              onChange={(e) =>
                e.target.value &&
                onChange(agenda ? periodoDoMesInteiro(e.target.value) : periodoDoMes(e.target.value))
              }
              className="h-8 w-[150px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="fp-de" className="text-[11px] text-muted-foreground">
              De
            </Label>
            <Input
              id="fp-de"
              type="date"
              value={valor.de}
              max={valor.ate}
              onChange={(e) => e.target.value && onChange(periodoPersonalizado(e.target.value, valor.ate))}
              className="h-8 w-[145px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="fp-ate" className="text-[11px] text-muted-foreground">
              Até
            </Label>
            <Input
              id="fp-ate"
              type="date"
              value={valor.ate}
              min={valor.de}
              onChange={(e) => e.target.value && onChange(periodoPersonalizado(valor.de, e.target.value))}
              className="h-8 w-[145px]"
            />
          </div>
          {!agenda && (
            <Button size="sm" variant="ghost" onClick={() => onChange(periodoEsteAno())}>
              Ano todo
            </Button>
          )}
        </div>
      ) : null}
    </div>
  )
}
