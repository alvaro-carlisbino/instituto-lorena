// EXTRATO — quanto entrou, quanto saiu, o que é cada coisa.
//
// A despesa da clínica sempre esteve aqui e nunca foi lida: `fin_transactions.category_id`
// existia desde o começo e NADA no sistema escrevia nele. Resultado — o contas a pagar conhece
// R$ 122.832 do ano (tudo vindo de XML de nota de estoque) enquanto o extrato mostra
// R$ 1.234.336 de saída só em julho/2026. Aluguel, folha, anestesista, imposto: sai da conta e
// não vira despesa em lugar nenhum. Sem isso não existe DRE, margem, nem custo de cirurgia.
//
// A tela é a ponte: classificar o extrato É construir a despesa. E classificar UMA vez vale
// para sempre — "PIX ENVIADO LAVANDERIA B" volta todo mês, então a classificação vira regra e
// carimba de uma vez os meses passados e os futuros.
//
// O número que mantém esta tela honesta é "sem categoria". Enquanto ele for grande, o gráfico
// de despesa está mentindo por omissão, e é melhor dizer isso do que desenhar uma pizza bonita
// sobre 10% do dinheiro.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowDownLeft, ArrowUpRight, Landmark, Tag, Wand2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTenant } from '@/context/TenantContext'
import { hojeLocal } from '@/lib/diaLocal'
import { sugerirPadrao } from '@/lib/extratoPadrao'
import { LancamentoEditor } from '@/components/financeiro/LancamentoEditor'
import {
  listCategories,
  listCostCenters,
  listExtratoPorDia,
  listSaidaPorCategoria,
  listTransactions,
  saveCategoryRule,
  updateTransaction,
  type CostCenter,
  type ExtratoDia,
  type FinCategory,
  type FinTransaction,
  type SaidaCategoria,
} from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCurto = (c: number) =>
  Math.abs(c) >= 100_000_00
    ? `${(c / 100_000_00).toFixed(1).replace('.', ',')}M`
    : `${Math.round(c / 100_00)}k`
const dia = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—')
const diaCurto = (iso: string) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''

function inicioDoMes(): string {
  return `${hojeLocal().slice(0, 7)}-01`
}

export function ExtratoPage() {
  const { tenant } = useTenant()
  const [de, setDe] = useState(inicioDoMes())
  const [ate, setAte] = useState(hojeLocal())
  const [dias, setDias] = useState<ExtratoDia[]>([])
  const [porCategoria, setPorCategoria] = useState<SaidaCategoria[]>([])
  const [lancamentos, setLancamentos] = useState<FinTransaction[]>([])
  const [categorias, setCategorias] = useState<FinCategory[]>([])
  const [filtro, setFiltro] = useState<'todos' | 'in' | 'out' | 'sem_categoria'>('sem_categoria')
  const [criarRegra, setCriarRegra] = useState(true)
  const [centros, setCentros] = useState<CostCenter[]>([])
  /** Linha aberta pra edição. Uma por vez: duas abertas viram formulário perdido. */
  const [abertoId, setAbertoId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const carregar = async (d = de, a = ate) => {
    setBusy(true)
    try {
      const [dd, cc, tx, cats, ce] = await Promise.all([
        listExtratoPorDia(d, a),
        listSaidaPorCategoria(d, a),
        listTransactions({ from: d, to: a, limit: 5000 }),
        listCategories(),
        listCostCenters(),
      ])
      setDias(dd)
      setPorCategoria(cc)
      setLancamentos(tx)
      setCategorias(cats)
      setCentros(ce)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar o extrato')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hoje = hojeLocal()
  const doDia = useMemo(() => dias.find((d) => d.dia === hoje), [dias, hoje])

  const totais = useMemo(() => {
    const entrou = dias.reduce((s, d) => s + d.entrouCents, 0)
    const saiu = dias.reduce((s, d) => s + d.saiuCents, 0)
    const classificada = dias.reduce((s, d) => s + d.saidaClassificadaCents, 0)
    return { entrou, saiu, saldo: entrou - saiu, classificada, semCategoria: saiu - classificada }
  }, [dias])

  const grafico = useMemo(
    () =>
      dias.map((d) => ({
        label: diaCurto(d.dia),
        Entrou: Math.round(d.entrouCents / 100),
        Saiu: -Math.round(d.saiuCents / 100),
      })),
    [dias],
  )

  const visiveis = useMemo(() => {
    const base = lancamentos.filter((t) => {
      if (filtro === 'in') return t.direction === 'in'
      if (filtro === 'out') return t.direction === 'out'
      if (filtro === 'sem_categoria') return t.categoryId == null
      return true
    })
    return base.slice(0, 300)
  }, [lancamentos, filtro])

  const nomeCategoria = (id: string | null) => categorias.find((c) => c.id === id)?.name ?? null

  /** Classifica um lançamento e, se pedido, transforma em regra que carimba o resto. */
  const classificar = async (t: FinTransaction, categoryId: string) => {
    setBusy(true)
    try {
      if (criarRegra) {
        const padrao = sugerirPadrao(t.description ?? t.counterparty ?? '')
        if (padrao.length >= 4) {
          const { carimbados } = await saveCategoryRule({ pattern: padrao, categoryId, direction: t.direction })
          toast.success(`"${padrao}" classificado — ${carimbados} lançamento(s) carimbado(s).`)
        } else {
          await updateTransaction(t.id, { categoryId })
          toast.success('Classificado (descrição curta demais para virar regra).')
        }
      } else {
        await updateTransaction(t.id, { categoryId })
        toast.success('Classificado.')
      }
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao classificar')
    } finally {
      setBusy(false)
    }
  }

  const pctClassificada = totais.saiu > 0 ? (totais.classificada / totais.saiu) * 100 : 100

  return (
    <AppLayout
      title="Extrato"
      subtitle="O que entrou, o que saiu e o que é cada coisa. Classificar aqui é o que constrói a despesa."
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
          <Landmark className="size-4" /> Atualizar
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ArrowDownLeft className="size-3.5 text-emerald-600" /> Entrou hoje
            </div>
            <div className="mt-0.5 text-lg font-semibold">{brl(doDia?.entrouCents ?? 0)}</div>
            <div className="text-xs text-muted-foreground">{brl(totais.entrou)} no período</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ArrowUpRight className="size-3.5 text-red-500" /> Saiu hoje
            </div>
            <div className="mt-0.5 text-lg font-semibold">{brl(doDia?.saiuCents ?? 0)}</div>
            <div className="text-xs text-muted-foreground">{brl(totais.saiu)} no período</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Saldo do período</div>
            <div className={`mt-0.5 text-lg font-semibold ${totais.saldo < 0 ? 'text-red-500' : ''}`}>
              {brl(totais.saldo)}
            </div>
            <div className="text-xs text-muted-foreground">entrou menos saiu</div>
          </CardContent>
        </Card>
        {/* O número que mantém o resto honesto. */}
        <Card className={totais.semCategoria > 0 ? 'border-amber-500/40 bg-amber-500/[0.04]' : ''}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Tag className="size-3.5" /> Saída sem categoria
            </div>
            <div className="mt-0.5 text-lg font-semibold">{brl(totais.semCategoria)}</div>
            <div className="text-xs text-muted-foreground">
              {pctClassificada.toFixed(0)}% da saída está classificada
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_minmax(0,340px)]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Entrou × saiu por dia</CardTitle>
          </CardHeader>
          <CardContent>
            {grafico.length === 0 ? (
              <EmptyState title={busy ? 'Carregando…' : 'Sem movimento no período'} description="Ajuste as datas." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={grafico} margin={{ left: 8, right: 12, top: 8 }} stackOffset="sign">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={(v) => brlCurto(Math.abs(Number(v ?? 0)) * 100)}
                  />
                  <Tooltip
                    formatter={(v, name) => [brl(Math.abs(Number(v ?? 0)) * 100), String(name ?? '')]}
                    labelFormatter={(l) => `Dia ${l}`}
                    contentStyle={{ fontSize: 12, borderRadius: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Entrou" fill="var(--color-chart-2, #10b981)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Saiu" fill="var(--color-chart-5, #ef4444)" radius={[0, 0, 3, 3]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Saída por categoria</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {porCategoria.length === 0 ? (
              <EmptyState title="Nada saiu no período" description="" />
            ) : (
              porCategoria.map((c) => {
                const pct = totais.saiu > 0 ? (c.amountCents / totais.saiu) * 100 : 0
                const semCat = c.categoryId == null
                return (
                  <div key={c.categoria}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className={`min-w-0 truncate ${semCat ? 'text-amber-600' : ''}`}>
                        {c.categoria} <span className="text-xs text-muted-foreground">({c.qtd})</span>
                      </span>
                      <span className="shrink-0 font-medium">{brl(c.amountCents)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${semCat ? 'bg-amber-500' : 'bg-primary'}`}
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm">Lançamentos</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            {/* Ligado por padrão: classificar um por um em 63 lançamentos por mês é o
                caminho garantido pra ninguém classificar nada. */}
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Checkbox checked={criarRegra} onCheckedChange={() => setCriarRegra((v) => !v)} />
              <Wand2 className="size-3.5" /> classificar todos os iguais
            </label>
            <Select value={filtro} onValueChange={(v) => setFiltro((v as typeof filtro) ?? 'todos')}>
              <SelectTrigger className="h-8 w-[190px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sem_categoria">Sem categoria</SelectItem>
                <SelectItem value="out">Só saídas</SelectItem>
                <SelectItem value="in">Só entradas</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {visiveis.length === 0 ? (
            <EmptyState
              icon={Tag}
              title={busy ? 'Carregando…' : 'Nada aqui'}
              description="Com o filtro em “Sem categoria”, vazio quer dizer que está tudo classificado."
            />
          ) : (
            <>
              {visiveis.map((t) => {
                const cat = nomeCategoria(t.categoryId)
                const saida = t.direction === 'out'
                const aberto = abertoId === t.id
                return (
                  <div key={t.id} className="rounded-md border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setAbertoId(aberto ? null : t.id)}
                    >
                      <div className="truncate text-sm">{t.description || t.counterparty || 'sem descrição'}</div>
                      <div className="text-xs text-muted-foreground">
                        {dia(t.date)}
                        {cat ? ` · ${cat}` : ''}
                        {t.costCenter ? ` · ${t.costCenter}` : ''}
                        <span className="ml-1 underline">{aberto ? 'fechar' : 'editar'}</span>
                      </div>
                    </button>
                    <span className={`shrink-0 font-semibold ${saida ? 'text-red-500' : 'text-emerald-600'}`}>
                      {saida ? '−' : '+'}
                      {brl(Math.abs(t.amountCents))}
                    </span>
                    {cat ? (
                      <Badge variant="secondary" className="shrink-0">
                        {cat}
                      </Badge>
                    ) : null}
                    {/* O Select do projeto entrega `string | null`; sem a guarda, limpar a
                        seleção chamaria classificar com null e gravaria categoria vazia. */}
                    <Select value="" onValueChange={(v) => (v ? void classificar(t, v) : undefined)}>
                      <SelectTrigger className="h-8 w-[200px] shrink-0 text-xs">
                        <SelectValue placeholder={cat ? 'Trocar categoria…' : 'Classificar…'} />
                      </SelectTrigger>
                      <SelectContent>
                        {categorias
                          .filter((c) => (saida ? c.kind === 'despesa' : c.kind === 'receita'))
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {aberto && (
                    <div className="mt-2">
                      <LancamentoEditor
                        lancamento={t}
                        categorias={categorias}
                        centros={centros}
                        onSalvo={() => {
                          setAbertoId(null)
                          void carregar()
                        }}
                      />
                    </div>
                  )}
                  </div>
                )
              })}
              {/* Nunca cortar calado. */}
              {lancamentos.length > visiveis.length && filtro === 'todos' && (
                <p className="pt-1 text-xs text-muted-foreground">
                  Mostrando 300 de {lancamentos.length} lançamentos do período. Os totais e o gráfico
                  acima usam todos.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  )
}
