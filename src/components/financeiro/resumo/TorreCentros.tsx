// SAÍDA POR CENTRO DE CUSTO, DO MAIOR PARA O MENOR.
//
// A pizza diz o grupo; aqui aparece o centro, que é a palavra da planilha da clínica. A barra
// leva a cor do GRUPO a que o centro pertence, então dá para ler as duas coisas de uma vez:
// "Salários e encargos" e "Benefícios" são azuis porque são Pessoas.

import { useState } from 'react'

import { SEM_CENTRO, type TotalCentro } from '@/lib/resumoBanco'
import { cn } from '@/lib/utils'
import { brl, corDe, pct } from './cores'

const VISIVEIS = 10

export function TorreCentros({ itens, onAbrir }: { itens: TotalCentro[]; onAbrir: (centro: string) => void }) {
  const [todos, setTodos] = useState(false)
  const total = itens.reduce((s, i) => s + i.cents, 0)
  if (total === 0) return <p className="py-12 text-center text-sm text-muted-foreground">Nada saiu no período.</p>

  const maior = Math.max(...itens.map((i) => i.cents))
  const lista = todos ? itens : itens.slice(0, VISIVEIS)

  return (
    <div>
      <div className="space-y-1">
        {lista.map((i) => (
          <button
            key={i.centro}
            type="button"
            onClick={() => onAbrir(i.centro)}
            className="group grid w-full grid-cols-[minmax(120px,190px)_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
          >
            <span className={cn('truncate text-sm', i.centro === SEM_CENTRO && 'text-amber-700 dark:text-amber-400')} title={i.centro}>
              {i.centro}
            </span>
            <span className="viz flex items-center gap-2">
              <span
                className="h-3 rounded-r-[4px]"
                style={{ width: `${Math.max(1.5, (i.cents / maior) * 100)}%`, background: corDe('out', i.classe) }}
              />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{pct(i.cents, total)}</span>
            </span>
            <span className="w-28 text-right text-sm font-medium tabular-nums">{brl(i.cents)}</span>
          </button>
        ))}
      </div>
      {itens.length > VISIVEIS && (
        <button
          type="button"
          onClick={() => setTodos((v) => !v)}
          className="mt-1 px-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          {todos ? 'Mostrar só os maiores' : `Ver todos os ${itens.length} centros`}
        </button>
      )}
    </div>
  )
}
