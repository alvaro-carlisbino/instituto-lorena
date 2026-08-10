import { useId, useMemo, useState } from 'react'

export type PontoSaldo = { dia: string; cents: number }

const ALTURA = 44

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Saldo diário dos últimos dias, reconstruído do extrato para trás.
 *
 * Uma série só, então não leva legenda nem eixo: o número grande do card já diz a escala, e
 * aqui o que importa é o formato da curva (subindo, caindo, secou no fim do mês). Rótulo
 * de valor só no ponto sob o cursor — eixo Y em card desse tamanho vira ruído.
 */
export function SaldoSparkline({ pontos, className }: { pontos: PontoSaldo[]; className?: string }) {
  const gradId = useId()
  const [alvo, setAlvo] = useState<number | null>(null)

  const { d, area, coords, min, max } = useMemo(() => {
    const largura = 100
    const valores = pontos.map((p) => p.cents)
    const min = Math.min(...valores, 0)
    const max = Math.max(...valores, 0)
    const span = max - min || 1
    const passo = pontos.length > 1 ? largura / (pontos.length - 1) : largura
    const coords = pontos.map((p, i) => ({
      x: i * passo,
      y: ALTURA - ((p.cents - min) / span) * ALTURA,
      ...p,
    }))
    const d = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ')
    const area = coords.length
      ? `${d} L${coords[coords.length - 1].x.toFixed(2)},${ALTURA} L0,${ALTURA} Z`
      : ''
    return { d, area, coords, min, max }
  }, [pontos])

  if (pontos.length < 2) return null

  const ponto = alvo != null ? coords[alvo] : null
  const subiu = pontos[pontos.length - 1].cents >= pontos[0].cents
  const cor = subiu ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'

  return (
    <div className={className}>
      <div className="relative">
        <svg
          viewBox={`0 0 100 ${ALTURA}`}
          className={`h-11 w-full overflow-visible ${cor}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Saldo dos últimos ${pontos.length} dias, de ${formatBRL(min)} a ${formatBRL(max)}`}
          onPointerLeave={() => setAlvo(null)}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            const rel = ((e.clientX - box.left) / box.width) * 100
            const i = Math.round((rel / 100) * (coords.length - 1))
            setAlvo(Math.max(0, Math.min(coords.length - 1, i)))
          }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradId})`} />
          <path
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {ponto ? (
            <>
              <line x1={ponto.x} y1={0} x2={ponto.x} y2={ALTURA} stroke="currentColor" strokeWidth={0.5} opacity={0.35} vectorEffect="non-scaling-stroke" />
              <circle cx={ponto.x} cy={ponto.y} r={2.5} fill="currentColor" vectorEffect="non-scaling-stroke" />
            </>
          ) : null}
        </svg>
      </div>
      <p className="mt-1 h-4 text-[0.7rem] tabular-nums text-muted-foreground">
        {ponto
          ? `${ponto.dia.slice(8, 10)}/${ponto.dia.slice(5, 7)} · ${formatBRL(ponto.cents)}`
          : `${pontos.length} dias · mín ${formatBRL(min)} · máx ${formatBRL(max)}`}
      </p>
    </div>
  )
}
