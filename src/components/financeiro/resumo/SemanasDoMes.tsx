// AS SEMANAS DO MÊS, SEMPRE NO MESMO LUGAR.
//
// Segunda a domingo, cortadas nas pontas do mês. Cada semana é um botão que recorta a tela
// nela, e o número de cada uma fica escrito: é o que se lê em voz alta numa reunião
// ("a semana 2 foi a da folha").

import { cn } from '@/lib/utils'
import type { PontoSerie } from '@/lib/resumoBanco'
import { COR_ENTROU, COR_SAIU, brl } from './cores'
import type { Modo } from './GraficoPeriodo'

export function SemanasDoMes({
  semanas,
  modo,
  selecionado,
  onSelecionar,
}: {
  semanas: PontoSerie[]
  modo: Modo
  selecionado: string | null
  onSelecionar: (p: PontoSerie | null) => void
}) {
  const maior = Math.max(1, ...semanas.map((s) => Math.max(modo !== 'saidas' ? s.entrou : 0, modo !== 'entradas' ? s.saiu : 0)))
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))` }}>
      {semanas.map((s) => {
        const ativo = selecionado === s.chave
        const sobra = s.entrou - s.saiu
        return (
          <button
            key={s.chave}
            type="button"
            aria-pressed={ativo}
            onClick={() => onSelecionar(ativo ? null : s)}
            className={cn(
              'rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40',
              ativo ? 'border-primary ring-1 ring-primary/40' : 'border-border',
              selecionado && !ativo && 'opacity-60',
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{s.rotulo.replace('Sem', 'Semana')}</span>
              <span className="text-[0.7rem] text-muted-foreground">{s.rotuloLongo.split('· ')[1]}</span>
            </div>
            <div className="viz mt-2 space-y-1.5">
              {modo !== 'saidas' && <Linha rotulo="Entrou" cents={s.entrou} cor={COR_ENTROU} maior={maior} />}
              {modo !== 'entradas' && <Linha rotulo="Saiu" cents={s.saiu} cor={COR_SAIU} maior={maior} />}
            </div>
            {modo === 'ambos' && (
              <div className="mt-1.5 flex justify-between border-t border-border/60 pt-1 text-xs">
                <span className="text-muted-foreground">Entrou menos saiu</span>
                <span className={cn('font-medium tabular-nums', sobra < 0 && 'text-red-600 dark:text-red-400')}>{brl(sobra)}</span>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

function Linha({ rotulo, cents, cor, maior }: { rotulo: string; cents: number; cor: string; maior: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{rotulo}</span>
        <span className="font-medium tabular-nums">{brl(cents)}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${Math.max(cents > 0 ? 2 : 0, (cents / maior) * 100)}%`, background: cor }} />
      </div>
    </div>
  )
}
