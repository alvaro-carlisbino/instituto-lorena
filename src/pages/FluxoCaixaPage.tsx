import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { financeiroTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { listPayables, type Payable } from '@/services/estoqueCompras'
import {
  type FinCategory,
  type FinTransaction,
  type Receivable,
  buildCashflow,
  listCategories,
  listReceivables,
  listTransactions,
} from '@/services/financeiro'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
}

const MONTHS_BACK = 6

export function FluxoCaixaPage() {
  const { tenant } = useTenant()
  const [txns, setTxns] = useState<FinTransaction[]>([])
  const [payables, setPayables] = useState<Payable[]>([])
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [categories, setCategories] = useState<FinCategory[]>([])
  const [loading, setLoading] = useState(false)

  const from = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - MONTHS_BACK)
    d.setDate(1)
    return d.toISOString().slice(0, 10)
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [t, p, r, c] = await Promise.all([
        listTransactions({ from, limit: 5000 }),
        listPayables(),
        listReceivables(),
        listCategories(undefined, true),
      ])
      setTxns(t)
      setPayables(p)
      setReceivables(r)
      setCategories(c)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar fluxo de caixa')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cashflow = useMemo(
    () => buildCashflow(txns, payables, receivables, categories),
    [txns, payables, receivables, categories],
  )
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name] as const)), [categories])

  const totals = useMemo(() => {
    const realizedIn = cashflow.months.reduce((s, m) => s + m.realizedInCents, 0)
    const realizedOut = cashflow.months.reduce((s, m) => s + m.realizedOutCents, 0)
    return { realizedIn, realizedOut, net: realizedIn - realizedOut }
  }, [cashflow])

  const despesasByCat = useMemo(
    () => cashflow.byCategory.filter((c) => c.kind === 'despesa').sort((a, b) => b.realizedCents - a.realizedCents),
    [cashflow],
  )
  const receitasByCat = useMemo(
    () => cashflow.byCategory.filter((c) => c.kind === 'receita').sort((a, b) => b.realizedCents - a.realizedCents),
    [cashflow],
  )

  const hasData = txns.length > 0

  return (
    <AppLayout
      title="Fluxo de caixa"
      subtitle={`Entrou × saiu × saldo nos últimos ${MONTHS_BACK} meses (realizado no caixa) + o previsto das contas em aberto.`}
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between pt-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Entrou (realizado)</p>
              <p className="mt-1 text-xl font-bold text-emerald-600">{formatBRL(totals.realizedIn)}</p>
            </div>
            <TrendingUp className="size-7 text-emerald-500/40" aria-hidden />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Saiu (realizado)</p>
              <p className="mt-1 text-xl font-bold text-red-500">{formatBRL(totals.realizedOut)}</p>
            </div>
            <TrendingDown className="size-7 text-red-500/40" aria-hidden />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Resultado do período</p>
              <p className={`mt-1 text-xl font-bold ${totals.net < 0 ? 'text-red-500' : ''}`}>{formatBRL(totals.net)}</p>
            </div>
            <Wallet className="size-7 text-muted-foreground/30" aria-hidden />
          </CardContent>
        </Card>
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Wallet}
              title={loading ? 'Carregando…' : 'Sem movimentações ainda'}
              description="Dê baixa em contas a pagar/receber por uma conta, ou concilie um extrato — os lançamentos aparecem aqui."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Por mês</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mês</TableHead>
                    <TableHead className="text-right">Entrou</TableHead>
                    <TableHead className="text-right">Saiu</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-right text-muted-foreground">Previsto (rec./pag.)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashflow.months.map((m) => {
                    const net = m.realizedInCents - m.realizedOutCents
                    return (
                      <TableRow key={m.month}>
                        <TableCell className="font-medium capitalize">{monthLabel(m.month)}</TableCell>
                        <TableCell className="text-right text-emerald-600">{formatBRL(m.realizedInCents)}</TableCell>
                        <TableCell className="text-right text-red-500">{formatBRL(m.realizedOutCents)}</TableCell>
                        <TableCell className={`text-right font-semibold ${net < 0 ? 'text-red-500' : ''}`}>
                          {formatBRL(net)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          +{formatBRL(m.plannedInCents)} / −{formatBRL(m.plannedOutCents)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Despesas por categoria (DRE)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {despesasByCat.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">Sem despesas no período.</p>
                ) : (
                  despesasByCat.map((c) => (
                    <div key={c.categoryId ?? 'sem'} className="flex items-center justify-between text-sm">
                      <span>{c.categoryId ? catName.get(c.categoryId) ?? 'Categoria' : 'Sem categoria'}</span>
                      <span className="font-semibold text-red-500">{formatBRL(c.realizedCents)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Receitas por categoria (DRE)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {receitasByCat.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">Sem receitas no período.</p>
                ) : (
                  receitasByCat.map((c) => (
                    <div key={c.categoryId ?? 'sem'} className="flex items-center justify-between text-sm">
                      <span>{c.categoryId ? catName.get(c.categoryId) ?? 'Categoria' : 'Sem categoria'}</span>
                      <span className="font-semibold text-emerald-600">{formatBRL(c.realizedCents)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
