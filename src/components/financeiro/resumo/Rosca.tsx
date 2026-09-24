// A PIZZA, COM A TABELA DO LADO.
//
// Parte do todo de relance: para onde foi a saída (por grupo do gasto) ou de onde veio a
// entrada (por forma). Poucas fatias de propósito, no máximo sete: com mais do que isso a
// pizza vira confete e ninguém compara nada. O detalhe mora na ficha, a um clique.
//
// A tabela ao lado não é enfeite: é onde o valor se lê. Três das cores ficam claras demais
// para carregar informação sozinhas no fundo branco, então nome, valor e % estão sempre escritos.

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { cn } from '@/lib/utils'
import type { Direcao, TotalClasse } from '@/lib/resumoBanco'
import { brl, brlCurto, corDe, pct } from './cores'

export function Rosca({
  itens,
  direcao,
  rotuloTotal,
  onAbrir,
  vazio,
}: {
  itens: TotalClasse[]
  direcao: Direcao
  rotuloTotal: string
  onAbrir: (classe: string) => void
  vazio: string
}) {
  const total = itens.reduce((s, i) => s + i.cents, 0)
  if (total === 0) return <p className="py-12 text-center text-sm text-muted-foreground">{vazio}</p>

  return (
    <div className="viz grid items-center gap-4 sm:grid-cols-[170px_1fr]">
      <div className="relative mx-auto aspect-square w-full max-w-[200px] sm:max-w-none">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={itens.map((i) => ({ ...i, valor: i.cents }))}
              dataKey="valor"
              nameKey="classe"
              innerRadius="64%"
              outerRadius="96%"
              startAngle={90}
              endAngle={-270}
              // O vão entre as fatias é o fundo do cartão, não uma borda desenhada.
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(d) => {
                const c = (d as { classe?: string })?.classe ?? (d as { payload?: { classe?: string } })?.payload?.classe
                if (c) onAbrir(c)
              }}
              style={{ cursor: 'pointer' }}
            >
              {itens.map((i) => (
                <Cell key={i.classe} fill={corDe(direcao, i.classe)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const i = payload[0].payload as TotalClasse
                return (
                  <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span className="size-2.5 rounded-[3px]" style={{ background: corDe(direcao, i.classe) }} />
                      {i.classe}
                    </div>
                    <div className="mt-0.5 tabular-nums">
                      {brl(i.cents)} · {pct(i.cents, total)}
                    </div>
                    <div className="text-muted-foreground">Clique para abrir</div>
                  </div>
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[0.68rem] text-muted-foreground">{rotuloTotal}</span>
          <span className="text-lg font-semibold">{brlCurto(total)}</span>
        </div>
      </div>

      <div className="min-w-0 divide-y divide-border/60">
        {itens.map((i) => (
          <button
            key={i.classe}
            type="button"
            onClick={() => onAbrir(i.classe)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/50"
          >
            <span className="size-3 shrink-0 rounded-[3px]" style={{ background: corDe(direcao, i.classe) }} />
            <span className={cn('min-w-0 flex-1 truncate')}>{i.classe}</span>
            <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{pct(i.cents, total)}</span>
            <span className="shrink-0 whitespace-nowrap text-right font-medium tabular-nums">{brl(i.cents)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
