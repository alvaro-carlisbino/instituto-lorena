// ACOMPANHAMENTO DO MÊS: onde o mês estava em cada dia.
//
// A coluna do dia mostra o dia; esta linha mostra o caminho. É ela que responde "no dia 15 já
// tinha saído mais do que entrou?" e "a folha do dia 5 pesou quanto no mês?". Entrou e saiu
// acumulados usam a MESMA escala (são o mesmo tipo de número), então cabem num eixo só.

import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { PontoAcumulado } from '@/lib/resumoBanco'
import { COR_ENTROU, COR_SAIU, brl, brlCurto, eixo } from './cores'
import type { Modo } from './GraficoPeriodo'

export function GraficoAcumulado({ pontos, modo }: { pontos: PontoAcumulado[]; modo: Modo }) {
  const dados = useMemo(
    () => pontos.map((p) => ({ rotulo: p.rotulo, entrou: p.entrou / 100, saiu: p.saiu / 100, sobra: p.sobra })),
    [pontos],
  )
  const fim = pontos.at(-1)
  const series = [
    ...(modo !== 'saidas' ? [{ chave: 'entrou' as const, rotulo: 'Entrou no mês', cor: COR_ENTROU }] : []),
    ...(modo !== 'entradas' ? [{ chave: 'saiu' as const, rotulo: 'Saiu no mês', cor: COR_SAIU }] : []),
  ]
  const ultimo = dados.length - 1

  if (!fim || (fim.entrou === 0 && fim.saiu === 0)) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Nenhum movimento no período.</p>
  }

  return (
    <div className="viz">
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {series.map((s) => (
            <span key={s.chave} className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: s.cor }} />
              {s.rotulo}
            </span>
          ))}
        </div>
      )}
      <div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={dados} margin={{ left: 4, right: 80, top: 12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--viz-grade)" />
            <XAxis
              dataKey="rotulo"
              tick={{ fontSize: 11, fill: 'var(--viz-muted)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--viz-linha)' }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--viz-muted)' }}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={(v) => eixo(Number(v) * 100)}
            />
            <Tooltip
              cursor={{ stroke: 'var(--viz-linha)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const r = payload[0].payload as { rotulo: string; entrou: number; saiu: number; sobra: number }
                return (
                  <div className="min-w-[200px] rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
                    <div className="mb-1 font-medium">Até o dia {r.rotulo}</div>
                    {series.map((s) => (
                      <div key={s.chave} className="flex items-center gap-2 py-0.5">
                        <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.cor }} />
                        <span className="flex-1 text-muted-foreground">{s.rotulo}</span>
                        <span className="tabular-nums">{brl(r[s.chave] * 100)}</span>
                      </div>
                    ))}
                    {modo === 'ambos' && (
                      <div className="mt-1 flex justify-between border-t border-border pt-1 font-medium">
                        <span>Entrou menos saiu</span>
                        <span className="tabular-nums">{brl(r.sobra)}</span>
                      </div>
                    )}
                  </div>
                )
              }}
            />
            {series.map((s) => (
              <Area
                key={s.chave}
                type="monotone"
                dataKey={s.chave}
                name={s.rotulo}
                stroke={s.cor}
                strokeWidth={2}
                fill={s.cor}
                fillOpacity={0.08}
                isAnimationActive={false}
                // Só o último ponto ganha marcador e o valor escrito: o resto fica no eixo e na dica.
                dot={(props: { cx?: number; cy?: number; index?: number }) =>
                  props.index === ultimo && props.cx != null && props.cy != null ? (
                    <g key={`fim-${s.chave}`}>
                      <circle cx={props.cx} cy={props.cy} r={4.5} fill={s.cor} stroke="var(--card)" strokeWidth={2} />
                      <text x={props.cx + 8} y={props.cy + 4} fontSize={11} fill="var(--viz-ink)">
                        {brlCurto(Math.round(dados[ultimo][s.chave] * 100))}
                      </text>
                    </g>
                  ) : (
                    <g key={`p-${s.chave}-${props.index}`} />
                  )
                }
                activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
