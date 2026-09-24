import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { formatQtd } from '@/components/kits/kitUi'
import { LIMITE_DIAS_ATRAS, diaAntes, diaValido, limitarUsado, rotuloDoDia } from '@/lib/transferenciaUso'
import { cn } from '@/lib/utils'

// Peças da transferência com uso (criar e editar usam as mesmas): o dia do uso e a linha do
// item com "levou" e "usou".

/** Dia em que aconteceu: Hoje, Ontem ou o calendário (até 30 dias atrás). */
export function DiaDoUso({
  dia,
  hoje,
  onChange,
  rotulo = 'Dia',
  ajuda,
}: {
  dia: string
  hoje: string
  onChange: (dia: string) => void
  rotulo?: string
  ajuda?: string
}) {
  const ontem = diaAntes(hoje, 1)
  const valido = diaValido(dia, hoje)
  const chip = (valor: string, texto: string) => (
    <button
      type="button"
      aria-pressed={dia === valor}
      onClick={() => onChange(valor)}
      className={cn(
        'min-h-9 rounded-lg border px-3 text-sm transition-colors',
        dia === valor ? 'border-primary bg-primary/10 font-medium' : 'border-border bg-card hover:bg-muted',
      )}
    >
      {texto}
    </button>
  )
  return (
    <div className="space-y-2">
      <Label htmlFor="dia-do-uso">{rotulo}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {chip(hoje, 'Hoje')}
        {chip(ontem, 'Ontem')}
        <Input
          id="dia-do-uso"
          type="date"
          value={dia}
          min={diaAntes(hoje, LIMITE_DIAS_ATRAS)}
          max={hoje}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-auto min-w-0"
          aria-invalid={!valido}
        />
      </div>
      {!valido ? (
        <p className="text-xs text-destructive">Escolha um dia entre hoje e {LIMITE_DIAS_ATRAS} dias atrás.</p>
      ) : dia !== hoje ? (
        <p className="text-xs text-amber-800 dark:text-amber-200">Vai entrar no dia {rotuloDoDia(dia, hoje)}.</p>
      ) : ajuda ? (
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      ) : null}
    </div>
  )
}

/**
 * Um item: quanto levou para o setor e quanto o setor usou (sai do estoque). "Usou tudo" é o
 * atalho do caso mais comum; usou nunca passa do que levou.
 */
export function LinhaLevouUsou({
  itemId,
  nome,
  unidade,
  levou,
  usou,
  onChange,
  onRemover,
  detalhe,
  aviso,
  bloqueado,
}: {
  itemId: string
  nome: string
  unidade: string
  levou: number
  usou: number
  /** Levou menos do que usou puxa o usou junto. */
  onChange: (v: { levou: number; usou: number }) => void
  onRemover?: () => void
  /** Linha pequena sob o nome (saldo na origem, o que estava antes). */
  detalhe?: ReactNode
  aviso?: ReactNode
  bloqueado?: boolean
}) {
  const tudo = levou > 0 && usou >= levou
  return (
    <li className={cn('px-3 py-2.5', levou <= 0 && 'bg-muted/40')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* Aba nova: tocar no nome no meio do lançamento não pode apagar a lista. */}
          <Link
            to={`/estoque/item/${itemId}`}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'text-sm font-medium leading-snug hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
              levou <= 0 && 'text-muted-foreground line-through',
            )}
          >
            {nome}
          </Link>
          {detalhe ? <div className="text-xs text-muted-foreground tabular-nums">{detalhe}</div> : null}
        </div>
        {onRemover ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={onRemover}
            disabled={bloqueado}
            aria-label={`Tirar ${nome}`}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="w-10 text-xs text-muted-foreground">Levou</span>
          <QtyStepper value={levou} min={0} label={`${nome} (levou)`} onChange={(q) => onChange({ levou: q, usou: limitarUsado(usou, q) })} />
          <span className="text-xs text-muted-foreground">{unidade}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-10 text-xs text-muted-foreground">Usou</span>
          <QtyStepper
            value={usou}
            min={0}
            max={levou}
            label={`${nome} (usou)`}
            onChange={(q) => onChange({ levou, usou: limitarUsado(q, levou) })}
          />
          <Button
            type="button"
            variant={tudo ? 'secondary' : 'outline'}
            size="sm"
            className="h-9"
            aria-pressed={tudo}
            disabled={bloqueado || levou <= 0}
            onClick={() => onChange({ levou, usou: tudo ? 0 : levou })}
          >
            {tudo ? <Check className="size-4" aria-hidden /> : null}
            Usou tudo
          </Button>
        </div>
      </div>
      {usou > 0 && usou < levou ? (
        <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
          Fica no setor: {formatQtd(levou - usou)} {unidade}
        </p>
      ) : null}
      {aviso}
    </li>
  )
}
