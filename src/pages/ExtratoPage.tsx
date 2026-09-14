// EXTRATO — quanto entrou, quanto saiu, o que é cada coisa.
//
// A despesa da clínica sempre esteve aqui e nunca foi lida: `fin_transactions.category_id`
// existia desde o começo e NADA no sistema escrevia nele. Resultado — o contas a pagar conhece
// R$ 122.832 do ano (tudo vindo de XML de nota de estoque) enquanto o extrato mostra
// R$ 1.234.336 de saída só em julho/2026. Aluguel, folha, anestesista, imposto: sai da conta e
// não vira despesa em lugar nenhum. Sem isso não existe DRE, margem, nem custo de cirurgia.
//
// A tela é a ponte: classificar o extrato É construir a despesa. E classificar UMA vez vale
// para sempre: "PIX ENVIADO LAVANDERIA B" volta todo mês, então a classificação vira regra e
// carimba os meses passados e, desde 14/set/2026, também o que ainda vai chegar do banco.
//
// Saída se classifica por CENTRO DE CUSTO, com o mesmo seletor de Gastos. Antes esta tela
// perguntava "categoria" numa lista e Gastos perguntava "centro" em outra, e quem classificava
// aqui não via o número de lá mexer. Entrada continua por categoria de receita.
//
// O número que mantém esta tela honesta é "sem centro de custo". Enquanto ele for grande, a
// divisão da despesa está mentindo por omissão.

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

import { CentroCustoPicker } from '@/components/financeiro/CentroCustoPicker'
import { ExcluirLancamento } from '@/components/financeiro/ExcluirLancamento'
import { possiveisCopias } from '@/lib/copiasBanco'
import { centroForaDoTotal } from '@/lib/centroCusto'
import { GastosPorCentro, type LinhaGasto } from '@/components/financeiro/GastosPorCentro'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTenant } from '@/context/TenantContext'
import { hojeLocal } from '@/lib/diaLocal'
import { FiltroPeriodo } from '@/components/page/FiltroPeriodo'
import { mesAtual, periodoDoMes, type Periodo } from '@/lib/periodo'
import { padraoDaRegra, sugerirPadrao } from '@/lib/extratoPadrao'
import { LancamentoEditor } from '@/components/financeiro/LancamentoEditor'
import { SugestaoIAPanel } from '@/components/financeiro/SugestaoIA'
import {
  classificarSaida,
  listAccounts,
  listCategories,
  listCostCenters,
  listExtratoPorDia,
  listTransactions,
  saveCategoryRule,
  updateTransaction,
  type CostCenter,
  type ExtratoDia,
  type FinAccount,
  type FinCategory,
  type FinTransaction,
} from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCurto = (c: number) =>
  Math.abs(c) >= 100_000_00
    ? `${(c / 100_000_00).toFixed(1).replace('.', ',')}M`
    : `${Math.round(c / 100_00)}k`
const dia = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—')
const diaCurto = (iso: string) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''

function quantosDias(de: string, ate: string): number {
  if (!de || !ate) return 0
  const d = Date.parse(`${de}T12:00:00Z`)
  const a = Date.parse(`${ate}T12:00:00Z`)
  if (Number.isNaN(d) || Number.isNaN(a) || a < d) return 0
  return Math.round((a - d) / 86_400_000) + 1
}

export function ExtratoPage() {
  const { tenant } = useTenant()
  // O período agora é um objeto só, do filtro compartilhado — que traz o seletor de
  // mês fechado que faltava aqui (dava para chegar em "junho" só digitando 01 e 30).
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoMes(mesAtual()))
  const de = periodo.de
  const ate = periodo.ate
  const [dias, setDias] = useState<ExtratoDia[]>([])
  const [lancamentos, setLancamentos] = useState<FinTransaction[]>([])
  const [categorias, setCategorias] = useState<FinCategory[]>([])
  const [contas, setContas] = useState<FinAccount[]>([])
  const [filtro, setFiltro] = useState<'todos' | 'in' | 'out' | 'sem_centro'>('sem_centro')
  const [criarRegra, setCriarRegra] = useState(true)
  const [centros, setCentros] = useState<CostCenter[]>([])
  /** Linha aberta pra edição. Uma por vez: duas abertas viram formulário perdido. */
  const [abertoId, setAbertoId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const carregar = async (d = de, a = ate) => {
    setBusy(true)
    try {
      const [dd, tx, cats, ce, ac] = await Promise.all([
        listExtratoPorDia(d, a),
        listTransactions({ from: d, to: a, limit: 5000 }),
        listCategories(),
        listCostCenters(),
        listAccounts(),
      ])
      setDias(dd)
      setLancamentos(tx)
      setCategorias(cats)
      setCentros(ce)
      setContas(ac)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar o extrato')
    } finally {
      setBusy(false)
    }
  }

  // Recarrega sozinho quando as datas mudam. Antes só o botão "Atualizar" buscava, então dava
  // pra ficar com o filtro dizendo 01/08 a 11/08 e os números sendo de outro período. Filtro que
  // mente é o jeito mais rápido de um relatório perder a confiança de quem lê.
  useEffect(() => {
    if (!de || !ate || de > ate) return
    const id = window.setTimeout(() => void carregar(de, ate), 350)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate])

  const hoje = hojeLocal()
  const doDia = useMemo(() => dias.find((d) => d.dia === hoje), [dias, hoje])
  const hojeNoPeriodo = hoje >= de && hoje <= ate
  const diasNoPeriodo = quantosDias(de, ate)

  const totais = useMemo(() => {
    const entrou = dias.reduce((s, d) => s + d.entrouCents, 0)
    const saiu = dias.reduce((s, d) => s + d.saiuCents, 0)
    const classificada = dias.reduce((s, d) => s + d.saidaClassificadaCents, 0)
    return { entrou, saiu, saldo: entrou - saiu, classificada, semCategoria: saiu - classificada }
  }, [dias])

  // Dinheiro que só trocou de conta: aplicação e transferência entre contas próprias. O DRE já
  // tira isso do resultado (é a convenção do nome "não é despesa"), mas o extrato somava tudo
  // junto — e é o que faz um dia de R$ 180 mil de "saída" parecer gasto que não houve.
  const nomeCategoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c.name])), [categorias])
  const saidaForaDoTotal = (t: FinTransaction) =>
    centroForaDoTotal(centros, t.costCenter) || /não é despesa/i.test(nomeCategoriaPorId.get(t.categoryId ?? '') ?? '')

  // Saídas de BANCO, o mesmo recorte dos cards (a lista traz cartão e caixa junto).
  const saidasBanco = useMemo(() => {
    const banco = new Set(contas.filter((c) => c.kind === 'banco').map((c) => c.id))
    return lancamentos.filter((t) => t.direction === 'out' && banco.has(t.accountId))
  }, [lancamentos, contas])

  // Possíveis cópias entre as saídas da mesma conta (lib/copiasBanco).
  const copias = useMemo(() => {
    const porConta = new Map<string, FinTransaction[]>()
    for (const t of lancamentos) {
      if (t.direction !== 'out') continue
      porConta.set(t.accountId, [...(porConta.get(t.accountId) ?? []), t])
    }
    const out = new Map<string, Array<{ id: string; descricao: string; data: string; amountCents: number }>>()
    for (const lista of porConta.values()) {
      const m = possiveisCopias(
        lista.map((t) => ({ id: t.id, data: t.date, descricao: t.description ?? '', amountCents: Math.abs(t.amountCents) })),
      )
      for (const [id, outros] of m) out.set(id, outros)
    }
    return out
  }, [lancamentos])

  const foraDoResultado = useMemo(
    () => saidasBanco.filter(saidaForaDoTotal).reduce((s, t) => s + Math.abs(t.amountCents), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saidasBanco, centros, nomeCategoriaPorId],
  )

  const linhasCentro = useMemo<LinhaGasto[]>(
    () =>
      saidasBanco.map((t) => ({
        id: t.id,
        refId: t.id,
        origem: 'banco' as const,
        data: t.date,
        nome: t.counterparty || t.description || 'sem descrição',
        descricao: t.description ?? '',
        amountCents: Math.abs(t.amountCents),
        centro: t.costCenter,
        foraDoTotal: saidaForaDoTotal(t),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saidasBanco, centros, nomeCategoriaPorId],
  )

  // Os cards vêm da RPC, que só olha conta de BANCO. A lista de lançamentos traz cartão e caixa
  // junto, então todo número tirado dela precisa do mesmo recorte: senão a "maior entrada" pode
  // ser de um cartão e não fechar com o total logo ao lado.
  const entradasBanco = useMemo(() => {
    const banco = new Set(contas.filter((c) => c.kind === 'banco').map((c) => c.id))
    return lancamentos.filter((t) => t.direction === 'in' && banco.has(t.accountId))
  }, [lancamentos, contas])

  // A maior entrada do período, à vista. Um total de R$ 367 mil não conta que R$ 157 mil vieram
  // de UMA transferência; ver o nome do pagador ao lado do total responde "de onde veio isso?"
  // sem precisar caçar na lista.
  const maiorEntrada = useMemo(
    () =>
      entradasBanco.reduce<FinTransaction | null>((m, t) => (!m || t.amountCents > m.amountCents ? t : m), null),
    [entradasBanco],
  )

  // Entrada que só mudou de conta. Mesma convenção de nome da saída, agora do lado de cá: quem
  // marcar a TED como "Transferência entre contas próprias (não é receita)" tira ela do que a
  // tela apresenta como dinheiro que a clínica ganhou.
  const entradaForaDoResultado = useMemo(() => {
    const ids = new Set(categorias.filter((c) => /não é receita/i.test(c.name)).map((c) => c.id))
    if (ids.size === 0) return 0
    return entradasBanco
      .filter((t) => t.categoryId && ids.has(t.categoryId))
      .reduce((s, t) => s + t.amountCents, 0)
  }, [entradasBanco, categorias])

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
      if (filtro === 'sem_centro') return t.direction === 'out' && !t.costCenter
      return true
    })
    return base.slice(0, 300)
  }, [lancamentos, filtro])

  const nomeCategoria = (id: string | null) => categorias.find((c) => c.id === id)?.name ?? null

  /** Saída: centro de custo, e com "iguais" vira regra (inclusive para o que ainda vai chegar). */
  const classificarCentro = async (
    t: FinTransaction,
    c: CostCenter,
    aplicarIguais: boolean,
    padraoGrupo?: string | null,
  ) => {
    setLancamentos((xs) => xs.map((x) => (x.id === t.id ? { ...x, costCenter: c.name } : x)))
    try {
      const padrao = aplicarIguais ? (padraoGrupo ?? padraoDaRegra(t.description ?? t.counterparty ?? '')) : null
      const n = await classificarSaida(t.id, c.name, padrao)
      toast.success(n > 0 ? `${c.name}: este e mais ${n} lançamento(s) iguais.` : `Classificado em ${c.name}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao classificar')
    }
    await carregar()
  }

  /** Entrada: categoria de receita e, se pedido, regra que carimba o resto. */
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
      subtitle="O que entrou e o que saiu do banco. Toda saída ganha um centro de custo, o mesmo de Gastos."
    >
      <FinanceTabs isSalesPolo={tenant.poloType === 'sales'} />

      <div className="flex flex-wrap items-end gap-2">
        <FiltroPeriodo
          valor={periodo}
          onChange={setPeriodo}
          atalhos={['dias:7', 'dias:30', 'mes-atual', 'mes-passado', 'dias:90']}
        />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void carregar()}>
          <Landmark className="size-4" /> {busy ? 'Buscando…' : 'Atualizar'}
        </Button>
      </div>

      {/* O período por extenso, uma vez só. Os cards abaixo são todos DESTE intervalo, e era
          justamente isso que "Entrou hoje" em cima de um filtro de 10 dias não deixava claro. */}
      <p className="mt-2 text-xs text-muted-foreground">
        {diasNoPeriodo > 0
          ? `Mostrando ${dia(de)} a ${dia(ate)} · ${diasNoPeriodo} ${diasNoPeriodo === 1 ? 'dia' : 'dias'}.`
          : 'Escolha um intervalo válido: a data inicial está depois da final.'}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ArrowDownLeft className="size-3.5 text-emerald-600" /> Entrou no período
            </div>
            <div className="mt-0.5 text-lg font-semibold">{brl(totais.entrou)}</div>
            {/* "hoje" só aparece quando hoje está dentro do filtro, e como detalhe. Era o número
                grande do card, o que fazia um dia parecer o período inteiro. */}
            {hojeNoPeriodo && (
              <div className="text-xs text-muted-foreground">{brl(doDia?.entrouCents ?? 0)} entrou hoje</div>
            )}
            {entradaForaDoResultado > 0 && (
              <div className="text-xs text-amber-600">
                {brl(entradaForaDoResultado)} só mudou de conta (transferência sua ou resgate de
                aplicação), não é faturamento
              </div>
            )}
            {maiorEntrada && maiorEntrada.amountCents > totais.entrou / 3 && (
              <div className="truncate text-xs text-muted-foreground">
                maior: {brl(maiorEntrada.amountCents)} · {maiorEntrada.description ?? maiorEntrada.counterparty ?? ''}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ArrowUpRight className="size-3.5 text-red-500" /> Saiu no período
            </div>
            <div className="mt-0.5 text-lg font-semibold">{brl(totais.saiu)}</div>
            {hojeNoPeriodo && (
              <div className="text-xs text-muted-foreground">{brl(doDia?.saiuCents ?? 0)} saiu hoje</div>
            )}
            {foraDoResultado > 0 && (
              <div className="text-xs text-amber-600">
                {brl(foraDoResultado)} só mudou de conta (aplicação ou transferência entre contas
                próprias), não é gasto
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Entrou menos saiu</div>
            <div className={`mt-0.5 text-lg font-semibold ${totais.saldo < 0 ? 'text-red-500' : ''}`}>
              {brl(totais.saldo)}
            </div>
            {/* Não é lucro nem saldo de conta: é o movimento bruto do banco, transferência
                inclusive. Quem quer resultado olha o DRE, e quem quer saldo olha Contas & saldos. */}
            <div className="text-xs text-muted-foreground">movimento do banco, não é o lucro</div>
          </CardContent>
        </Card>
        {/* O número que mantém o resto honesto. */}
        <button
          type="button"
          aria-pressed={filtro === 'sem_centro'}
          onClick={() => {
            setFiltro('sem_centro')
            document.getElementById('extrato-lancamentos')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          className="text-left"
        >
          <Card
            className={`h-full transition-colors hover:bg-muted/30 ${totais.semCategoria > 0 ? 'border-amber-500/40 bg-amber-500/[0.04]' : ''}`}
          >
            <CardContent className="pt-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Tag className="size-3.5" /> Saída sem centro de custo
              </div>
              <div className="mt-0.5 text-lg font-semibold">{brl(totais.semCategoria)}</div>
              <div className="text-xs text-muted-foreground">
                {pctClassificada.toFixed(0)}% da saída classificada. Clique para ver.
              </div>
            </CardContent>
          </Card>
        </button>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
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
            <CardTitle className="text-sm">Saída por centro de custo</CardTitle>
          </CardHeader>
          <CardContent>
            <GastosPorCentro
              linhas={linhasCentro}
              centros={centros}
              vazio="Nada saiu do banco no período."
              onClassificar={async (l, c, aplicarIguais, padrao) => {
                const t = lancamentos.find((x) => x.id === l.refId)
                if (t) await classificarCentro(t, c, aplicarIguais, padrao)
              }}
            />
          </CardContent>
        </Card>
      </div>

      {/* Antes da lista: o caminho rápido é a IA propor os pagadores grandes de uma vez,
          e a lista abaixo fica pro que sobrar. */}
      {totais.semCategoria > 0 && (
        <div className="mt-4">
          <SugestaoIAPanel de={de} ate={ate} onAplicado={() => void carregar()} />
        </div>
      )}

      <Card className="mt-4">
        <CardHeader
          id="extrato-lancamentos"
          className="scroll-mt-20 flex-row flex-wrap items-center justify-between gap-2 space-y-0"
        >
          <CardTitle className="text-sm">Lançamentos</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            {/* Só para ENTRADA. Na saída, "aplicar aos iguais" mora dentro do seletor de centro,
                com a contagem à vista antes de confirmar. */}
            {(filtro === 'in' || filtro === 'todos') && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <Checkbox checked={criarRegra} onCheckedChange={() => setCriarRegra((v) => !v)} />
                <Wand2 className="size-3.5" /> entradas: classificar as iguais
              </label>
            )}
            <Select value={filtro} onValueChange={(v) => setFiltro((v as typeof filtro) ?? 'todos')}>
              <SelectTrigger className="h-8 w-[230px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sem_centro">Saídas sem centro de custo</SelectItem>
                <SelectItem value="out">Só saídas</SelectItem>
                <SelectItem value="in">Só entradas</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {visiveis.length === 0 ? (
            <EmptyState
              icon={Tag}
              title={busy ? 'Carregando…' : 'Nada aqui'}
              description="Com o filtro em “Saídas sem centro de custo”, vazio quer dizer que está tudo classificado."
            />
          ) : (
            <>
              <div className="divide-y divide-border/60 border-t border-border/60">
              {visiveis.map((t) => {
                const cat = nomeCategoria(t.categoryId)
                const saida = t.direction === 'out'
                const aberto = abertoId === t.id
                const nome = t.description || t.counterparty || 'sem descrição'
                return (
                  <div key={t.id} className={aberto ? 'bg-muted/20' : ''}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 hover:bg-muted/20">
                    <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">{dia(t.date)}</span>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setAbertoId(aberto ? null : t.id)}
                    >
                      <div className="truncate text-sm font-medium">{nome}</div>
                      <div className="text-xs text-muted-foreground">
                        {!saida && cat ? `${cat} · ` : ''}
                        <span className="underline underline-offset-2">{aberto ? 'fechar' : 'detalhes e rateio'}</span>
                      </div>
                    </button>
                    <span
                      className={`w-32 shrink-0 text-right font-semibold tabular-nums ${saida ? 'text-red-500' : 'text-emerald-600'}`}
                    >
                      {saida ? '−' : '+'}
                      {brl(Math.abs(t.amountCents))}
                    </span>
                    {saida ? (
                      <CentroCustoPicker
                        size="sm"
                        className="h-8 w-[210px] shrink-0"
                        centros={centros}
                        value={t.costCenter}
                        resumo={{ descricao: nome, data: t.date, amountCents: Math.abs(t.amountCents) }}
                        permitirIguais
                        padrao={padraoDaRegra(t.description ?? t.counterparty ?? '')}
                        excluirId={t.id}
                        onPick={(c, { aplicarIguais }) => classificarCentro(t, c, aplicarIguais)}
                      />
                    ) : null}
                    {saida ? (
                      <ExcluirLancamento
                        variante="icone"
                        origem="banco"
                        id={t.id}
                        descricao={t.description ?? ''}
                        outros={copias.get(t.id) ?? []}
                        resumo={`${nome} · ${dia(t.date)} · ${brl(Math.abs(t.amountCents))}`}
                        centros={centros}
                        onTirarDoTotal={(c) => classificarCentro(t, c, false)}
                        onExcluido={() => void carregar()}
                      />
                    ) : (
                      // O Select do projeto entrega `string | null`; sem a guarda, limpar a
                      // seleção chamaria classificar com null e gravaria categoria vazia.
                      <Select value="" onValueChange={(v) => (v ? void classificar(t, v) : undefined)}>
                        <SelectTrigger className="h-8 w-[210px] shrink-0 text-xs">
                          <SelectValue placeholder={cat ? 'Trocar categoria…' : 'Categoria da entrada…'} />
                        </SelectTrigger>
                        <SelectContent>
                          {categorias
                            .filter((c) => c.kind === 'receita')
                            .map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {aberto && (
                    <div className="px-4 pb-3">
                      <LancamentoEditor
                        lancamento={t}
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
              </div>
              {/* Nunca cortar calado. */}
              {lancamentos.length > visiveis.length && filtro === 'todos' && (
                <p className="px-4 py-2 text-xs text-muted-foreground">
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
