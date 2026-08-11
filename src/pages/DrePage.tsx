// DRE — receita menos despesa, e o tamanho do que ainda não dá pra afirmar.
//
// Este é o relatório que justifica todo o resto do módulo, e é também o mais fácil de mentir.
// Duas honestidades ficam no topo, em destaque, porque sem elas o número de baixo vira ficção
// com cara de contabilidade:
//
//   1. A DESPESA SÓ CONHECE O QUE SAIU DA CONTA. Compromisso que ainda não foi pago não entra,
//      e a clínica registrou pouquíssimo em contas a pagar — então o resultado é um TETO, não
//      um lucro. Melhor um teto declarado do que um lucro inventado.
//
//   2. A QUEBRA POR CATEGORIA SÓ VALE SOBRE O QUE FOI CLASSIFICADO. Enquanto isso for uma
//      fração, o gráfico de composição fala de uma minoria do dinheiro, e dizer o percentual
//      é a diferença entre um relatório e um enfeite.
//
// Aplicação financeira e transferência entre contas próprias saem do resultado. São o mesmo
// dinheiro trocando de lugar — contá-las como despesa erraria o DRE em R$ 859 mil.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Bar,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, Download, TrendingUp } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTenant } from '@/context/TenantContext'
import { hojeLocal } from '@/lib/diaLocal'
import { listDre, listSaidaPorCategoria, type DreMes, type SaidaCategoria } from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCurto = (c: number) =>
  Math.abs(c) >= 100_000_00 ? `${(c / 100_000_00).toFixed(1).replace('.', ',')}M` : `${Math.round(c / 100_00)}k`
const mesLabel = (m: string) =>
  new Date(`${m}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })

function mesesAtras(n: number): string {
  const d = new Date(`${hojeLocal()}T12:00:00`)
  d.setMonth(d.getMonth() - n)
  return `${d.toISOString().slice(0, 8)}01`
}

export function DrePage() {
  const { tenant } = useTenant()
  const [de, setDe] = useState(mesesAtras(5))
  const [ate, setAte] = useState(hojeLocal())
  const [meses, setMeses] = useState<DreMes[]>([])
  const [categorias, setCategorias] = useState<SaidaCategoria[]>([])
  const [busy, setBusy] = useState(false)

  const carregar = async (d = de, a = ate) => {
    setBusy(true)
    try {
      const [m, c] = await Promise.all([listDre(d, a), listSaidaPorCategoria(d, a)])
      setMeses(m)
      setCategorias(c)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao montar o DRE')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = useMemo(
    () =>
      meses.reduce(
        (a, m) => ({
          receita: a.receita + m.receitaCents,
          despesa: a.despesa + m.despesaCents,
          classificada: a.classificada + m.despesaClassificadaCents,
          fora: a.fora + m.foraDoResultadoCents,
          resultado: a.resultado + m.resultadoCents,
        }),
        { receita: 0, despesa: 0, classificada: 0, fora: 0, resultado: 0 },
      ),
    [meses],
  )

  const pctClassificada = total.despesa > 0 ? (total.classificada / total.despesa) * 100 : 100
  const margem = total.receita > 0 ? (total.resultado / total.receita) * 100 : 0

  const grafico = useMemo(
    () =>
      meses.map((m) => ({
        label: mesLabel(m.mes),
        Receita: Math.round(m.receitaCents / 100),
        Despesa: -Math.round(m.despesaCents / 100),
        Resultado: Math.round(m.resultadoCents / 100),
      })),
    [meses],
  )

  const baixarCsv = () => {
    const l = [
      ['Mês', 'Receita', 'Despesa', 'Despesa classificada', 'Fora do resultado', 'Resultado'],
      ...meses.map((m) => [
        m.mes,
        brl(m.receitaCents),
        brl(m.despesaCents),
        brl(m.despesaClassificadaCents),
        brl(m.foraDoResultadoCents),
        brl(m.resultadoCents),
      ]),
    ]
    const csv = l.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    // BOM: sem ele o Excel abre em latin-1 e come os acentos.
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `dre-${de}-a-${ate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppLayout
      title="DRE"
      subtitle="Receita menos despesa por mês — e o tamanho do que ainda não dá pra afirmar."
    >
      <FinanceTabs isSalesPolo={tenant.poloType === 'sales'} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="de" className="text-xs">De</Label>
          <Input id="de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-[150px]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ate" className="text-xs">Até</Label>
          <Input id="ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-[150px]" />
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void carregar()}>
          <TrendingUp className="size-4" /> Atualizar
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={baixarCsv} disabled={meses.length === 0}>
          <Download className="size-4" /> CSV
        </Button>
      </div>

      {/* As duas ressalvas ficam ANTES do número, não num rodapé que ninguém lê. */}
      <Card className="mt-4 border-amber-500/40 bg-amber-500/[0.05]">
        <CardContent className="space-y-1 pt-4 text-xs">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3.5 text-amber-600" /> Leia antes do número
          </div>
          <p>
            A despesa conta só o que <strong>saiu da conta</strong>. Compromisso registrado e ainda
            não pago não entra, e a clínica lançou pouquíssimo em contas a pagar — então o
            resultado abaixo é um <strong>teto</strong>, não um lucro apurado.
          </p>
          {/* Sem despesa no período, "100% classificada" seria uma afirmação sobre nada. */}
          {total.despesa > 0 && (
            <p>
              {pctClassificada.toFixed(0)}% da despesa tem categoria. A quebra por categoria fala
              só dessa fatia; o resto está somado no total, mas sem nome.
            </p>
          )}
          {total.fora > 0 && (
            <p>
              {brl(total.fora)} de aplicação e transferência entre contas próprias ficaram fora do
              resultado — é o mesmo dinheiro trocando de lugar, não despesa.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Receita</div>
            <div className="mt-0.5 text-lg font-semibold">{brl(total.receita)}</div>
            <div className="text-xs text-muted-foreground">venda do Shosp no período</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Despesa</div>
            <div className="mt-0.5 text-lg font-semibold">{brl(total.despesa)}</div>
            <div className="text-xs text-muted-foreground">o que saiu da conta</div>
          </CardContent>
        </Card>
        <Card className={total.resultado < 0 ? 'border-destructive/40' : ''}>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Resultado (teto)</div>
            <div className={`mt-0.5 text-lg font-semibold ${total.resultado < 0 ? 'text-red-500' : ''}`}>
              {brl(total.resultado)}
            </div>
            <div className="text-xs text-muted-foreground">margem de {margem.toFixed(1)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Despesa sem nome</div>
            <div className="mt-0.5 text-lg font-semibold">{brl(total.despesa - total.classificada)}</div>
            <div className="text-xs text-muted-foreground">classifique no Extrato</div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Mês a mês</CardTitle>
        </CardHeader>
        <CardContent>
          {grafico.length === 0 ? (
            <EmptyState title={busy ? 'Carregando…' : 'Sem dado no período'} description="Ajuste as datas." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={grafico} margin={{ left: 8, right: 12, top: 8 }} stackOffset="sign">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                  tickFormatter={(v) => brlCurto(Math.abs(Number(v ?? 0)) * 100)}
                />
                <Tooltip
                  formatter={(v, name) => [brl(Math.abs(Number(v ?? 0)) * 100), String(name ?? '')]}
                  contentStyle={{ fontSize: 12, borderRadius: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Receita" fill="var(--color-chart-2, #10b981)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Despesa" fill="var(--color-chart-5, #ef4444)" radius={[0, 0, 3, 3]} />
                <Line type="monotone" dataKey="Resultado" stroke="var(--color-primary, #c2410c)" strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Detalhe por mês</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-2 py-1.5 text-left">Mês</th>
                    <th className="px-2 py-1.5 text-right">Receita</th>
                    <th className="px-2 py-1.5 text-right">Despesa</th>
                    <th className="px-2 py-1.5 text-right">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {meses.map((m) => (
                    <tr key={m.mes} className="border-t border-border/60">
                      <td className="px-2 py-1.5 whitespace-nowrap">{mesLabel(m.mes)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{brl(m.receitaCents)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{brl(m.despesaCents)}</td>
                      <td
                        className={`px-2 py-1.5 text-right font-medium tabular-nums ${
                          m.resultadoCents < 0 ? 'text-red-500' : ''
                        }`}
                      >
                        {brl(m.resultadoCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Composição da despesa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {categorias.length === 0 ? (
              <EmptyState title="Nada no período" description="" />
            ) : (
              categorias.map((c) => {
                const pct = total.despesa > 0 ? (c.amountCents / total.despesa) * 100 : 0
                const semCat = c.categoryId == null
                return (
                  <div key={c.categoria}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className={`min-w-0 truncate ${semCat ? 'text-amber-600' : ''}`}>{c.categoria}</span>
                      <span className="shrink-0 font-medium">{brl(c.amountCents)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${semCat ? 'bg-amber-500' : 'bg-primary'}`}
                        style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
