// DIA A DIA (OU SEMANA A SEMANA): as colunas do mês.
//
// Três leituras do mesmo desenho, escolhidas no topo da tela:
//   entradas e saídas · entrou para cima, saiu para baixo, do mesmo zero
//   só saídas         · a coluna do dia empilhada pelo grupo do gasto
//   só entradas       · a coluna do dia empilhada pela forma de entrada
//
// Clicar numa coluna recorta a tela naquele dia ou semana (os cartões, as roscas e o ranking
// passam a falar só dele). O gráfico continua mostrando o mês inteiro, com a coluna escolhida
// acesa, para ninguém perder de vista onde está.

import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { cn } from '@/lib/utils'
import { ordemDasClasses, type Direcao, type PontoSerie } from '@/lib/resumoBanco'
import { COR_ENTROU, COR_SAIU, brl, corDe, eixo } from './cores'

export type Modo = 'ambos' | 'saidas' | 'entradas'

type Serie = { chave: string; rotulo: string; cor: string; direcao: Direcao }

export function GraficoPeriodo({
  pontos,
  modo,
  selecionado,
  onSelecionar,
  porSemana,
}: {
  pontos: PontoSerie[]
  modo: Modo
  selecionado: string | null
  onSelecionar: (p: PontoSerie | null) => void
  porSemana: boolean
}) {
  const [emTabela, setEmTabela] = useState(false)

  // Séries que aparecem: só as classes que tiveram dinheiro no período, na ordem fixa.
  const series = useMemo<Serie[]>(() => {
    if (modo === 'ambos') {
      return [
        { chave: 'entrou', rotulo: 'Entrou', cor: COR_ENTROU, direcao: 'in' },
        { chave: 'saiu', rotulo: 'Saiu', cor: COR_SAIU, direcao: 'out' },
      ]
    }
    const direcao: Direcao = modo === 'entradas' ? 'in' : 'out'
    const campo = direcao === 'in' ? 'entradaPorClasse' : 'saidaPorClasse'
    const usadas = new Set(pontos.flatMap((p) => Object.keys(p[campo])))
    return ordemDasClasses(direcao)
      .filter((c) => usadas.has(c))
      .map((c) => ({ chave: c, rotulo: c, cor: corDe(direcao, c), direcao }))
  }, [pontos, modo])

  const dados = useMemo(
    () =>
      pontos.map((p) => {
        const linha: Record<string, number | string> = { chave: p.chave, rotulo: p.rotulo }
        if (modo === 'ambos') {
          linha.entrou = p.entrou / 100
          // Para baixo do zero: a saída é o mesmo dinheiro com o sinal trocado, sem segunda escala.
          linha.saiu = -p.saiu / 100
        } else {
          const campo = modo === 'entradas' ? p.entradaPorClasse : p.saidaPorClasse
          for (const s of series) linha[s.chave] = (campo[s.chave] ?? 0) / 100
        }
        return linha
      }),
    [pontos, modo, series],
  )

  const temDinheiro = pontos.some((p) => (modo !== 'saidas' && p.entrou > 0) || (modo !== 'entradas' && p.saiu > 0))
  const ultimaDaPilha = series.at(-1)?.chave

  return (
    <div className="viz">
      {/* Legenda sempre à vista, antes do desenho: a cor nunca fica sozinha dizendo o que é. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.chave} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: s.cor }} />
            {s.rotulo}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setEmTabela((v) => !v)}
          className="ml-auto underline-offset-2 hover:text-foreground hover:underline"
        >
          {emTabela ? 'Ver gráfico' : 'Ver em tabela'}
        </button>
      </div>

      {!temDinheiro ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Nenhum movimento no período.</p>
      ) : emTabela ? (
        <TabelaDoPeriodo pontos={pontos} modo={modo} series={series} />
      ) : (
        <div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={dados}
              margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
              stackOffset={modo === 'ambos' ? 'sign' : 'none'}
              barCategoryGap={porSemana ? '28%' : '18%'}
              onClick={(st) => {
                const i = Number(st?.activeTooltipIndex)
                if (!Number.isInteger(i) || !pontos[i]) return
                onSelecionar(pontos[i].chave === selecionado ? null : pontos[i])
              }}
              style={{ cursor: 'pointer' }}
            >
              <CartesianGrid vertical={false} stroke="var(--viz-grade)" />
              <XAxis
                dataKey="rotulo"
                tick={{ fontSize: 11, fill: 'var(--viz-muted)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--viz-linha)' }}
                interval="preserveStartEnd"
                minTickGap={8}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--viz-muted)' }}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v) => eixo(Number(v) * 100)}
              />
              {modo === 'ambos' && <ReferenceLine y={0} stroke="var(--viz-linha)" />}
              <Tooltip
                cursor={{ fill: 'var(--viz-grade)', opacity: 0.5 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const chave = String((payload[0].payload as { chave: string }).chave)
                  const p = pontos.find((x) => x.chave === chave)
                  return p ? <Dica ponto={p} modo={modo} series={series} porSemana={porSemana} /> : null
                }}
              />
              {series.map((s) => (
                <Bar
                  key={s.chave}
                  dataKey={s.chave}
                  name={s.rotulo}
                  stackId={modo === 'ambos' ? 'mov' : 'pilha'}
                  fill={s.cor}
                  maxBarSize={porSemana ? 48 : 24}
                  // Ponta arredondada só no fim do dado; a base fica reta no zero.
                  radius={modo === 'ambos' ? (s.chave === 'saiu' ? [0, 0, 4, 4] : [4, 4, 0, 0]) : s.chave === ultimaDaPilha ? [4, 4, 0, 0] : 0}
                  // O vão de 2px entre os pedaços da pilha é o fundo, não uma borda.
                  stroke="var(--card)"
                  strokeWidth={modo === 'ambos' ? 0 : 1}
                  isAnimationActive={false}
                >
                  {dados.map((d) => (
                    <Cell
                      key={String(d.chave)}
                      fillOpacity={selecionado && d.chave !== selecionado ? 0.3 : 1}
                    />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-xs text-muted-foreground">
            Clique numa coluna para ver só {porSemana ? 'aquela semana' : 'aquele dia'} na tela.
          </p>
        </div>
      )}
    </div>
  )
}

function Dica({ ponto, modo, series, porSemana }: { ponto: PontoSerie; modo: Modo; series: Serie[]; porSemana: boolean }) {
  const linhas =
    modo === 'ambos'
      ? [
          { s: series[0], cents: ponto.entrou },
          { s: series[1], cents: ponto.saiu },
        ]
      : series
          .map((s) => ({ s, cents: (modo === 'entradas' ? ponto.entradaPorClasse : ponto.saidaPorClasse)[s.chave] ?? 0 }))
          .filter((l) => l.cents > 0)
          .reverse()
  const total = modo === 'entradas' ? ponto.entrou : ponto.saiu
  return (
    <div className="min-w-[220px] rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="mb-1 font-medium">{porSemana ? ponto.rotuloLongo : `Dia ${ponto.rotulo}`}</div>
      {linhas.map(({ s, cents }) => (
        <div key={s.chave} className="flex items-center gap-2 py-0.5">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.cor }} />
          <span className="flex-1 text-muted-foreground">{s.rotulo}</span>
          <span className="tabular-nums">{brl(cents)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-border pt-1 font-medium">
        <span>{modo === 'ambos' ? 'Entrou menos saiu' : 'Total'}</span>
        <span className="tabular-nums">{brl(modo === 'ambos' ? ponto.entrou - ponto.saiu : total)}</span>
      </div>
    </div>
  )
}

function TabelaDoPeriodo({ pontos, modo, series }: { pontos: PontoSerie[]; modo: Modo; series: Serie[] }) {
  const cols = modo === 'ambos' ? [] : series
  return (
    <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Quando</th>
            {modo === 'ambos' && <th className="px-2 py-1.5 text-right font-medium">Entrou</th>}
            {modo === 'ambos' && <th className="px-2 py-1.5 text-right font-medium">Saiu</th>}
            {cols.map((s) => (
              <th key={s.chave} className="px-2 py-1.5 text-right font-medium">
                {s.rotulo}
              </th>
            ))}
            <th className="px-2 py-1.5 text-right font-medium">{modo === 'ambos' ? 'Entrou menos saiu' : 'Total'}</th>
          </tr>
        </thead>
        <tbody>
          {pontos.map((p) => {
            const campo = modo === 'entradas' ? p.entradaPorClasse : p.saidaPorClasse
            return (
              <tr key={p.chave} className="border-t border-border/60">
                <td className="px-2 py-1">{p.rotuloLongo}</td>
                {modo === 'ambos' && <td className="px-2 py-1 text-right tabular-nums">{brl(p.entrou)}</td>}
                {modo === 'ambos' && <td className="px-2 py-1 text-right tabular-nums">{brl(p.saiu)}</td>}
                {cols.map((s) => (
                  <td key={s.chave} className="px-2 py-1 text-right tabular-nums">
                    {campo[s.chave] ? brl(campo[s.chave]) : ''}
                  </td>
                ))}
                <td className={cn('px-2 py-1 text-right font-medium tabular-nums')}>
                  {brl(modo === 'ambos' ? p.entrou - p.saiu : modo === 'entradas' ? p.entrou : p.saiu)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
