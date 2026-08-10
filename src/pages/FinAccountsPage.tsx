import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  Landmark,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Tags,
  Wallet,
} from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { StatCard } from '@/components/page/StatCard'
import { SaldoSparkline, type PontoSaldo } from '@/components/financeiro/SaldoSparkline'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { financeiroTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { diaLocalComOffset, hojeLocal } from '@/lib/diaLocal'
import { linkBancoMcp } from '@/services/openFinance'
import {
  type AccountKind,
  type CategoryKind,
  type FinAccount,
  type FinCategory,
  type FinTransaction,
  accountBalances,
  listAccounts,
  listCategories,
  listTransactions,
  upsertAccount,
  upsertCategory,
} from '@/services/financeiro'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function parseBRL(value: string): number {
  return Math.round((Number(value.replace(/\./g, '').replace(',', '.')) || 0) * 100)
}
function ddmm(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}

const KIND_LABEL: Record<AccountKind, string> = { banco: 'Banco', caixa: 'Caixa/Dinheiro', carteira: 'Carteira' }
const KIND_ICON: Record<AccountKind, typeof Landmark> = { banco: Landmark, caixa: Banknote, carteira: Wallet }

const EMPTY_ACCOUNT = { name: '', kind: 'banco' as AccountKind, bankName: '', branch: '', number: '', opening: '' }

/** Cartão de crédito é dívida, nunca entra na soma do que se tem em conta. */
function ehCartao(a: FinAccount): boolean {
  return String(a.ofMeta?.subtype ?? '').toUpperCase().includes('CREDIT') || a.kind === 'carteira'
}

/**
 * Idade do dado do banco, com tom.
 *
 * Existe porque a tela antiga carimbava a hora em que a gente gravava e chamava de "agora",
 * então saldo de horas atrás parecia recém-lido. Aqui o número velho continua aparecendo,
 * mas dizendo que é velho — é a diferença entre informar e enganar.
 */
function idadeDoDado(iso: string | null): { texto: string; tom: 'ok' | 'atencao' | 'ruim' } {
  if (!iso) return { texto: 'idade desconhecida', tom: 'ruim' }
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  const hora = new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const tom = minutos <= 120 ? 'ok' : minutos <= 12 * 60 ? 'atencao' : 'ruim'
  if (minutos < 60) return { texto: `lido às ${hora} · há ${minutos} min`, tom }
  const horas = Math.round(minutos / 60)
  if (horas < 24) return { texto: `lido às ${hora} · há ${horas}h`, tom }
  return { texto: `lido há ${Math.round(horas / 24)} dia(s)`, tom }
}

const TOM_CLASSE: Record<'ok' | 'atencao' | 'ruim', string> = {
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  atencao: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  ruim: 'bg-red-500/10 text-red-700 dark:text-red-400',
}

export function FinAccountsPage() {
  const { tenant } = useTenant()
  const [accounts, setAccounts] = useState<FinAccount[]>([])
  const [balances, setBalances] = useState<Map<string, number>>(new Map())
  const [txns, setTxns] = useState<FinTransaction[]>([])
  const [categories, setCategories] = useState<FinCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [atualizando, setAtualizando] = useState(false)

  const [gerenciar, setGerenciar] = useState(false)
  const [accForm, setAccForm] = useState({ ...EMPTY_ACCOUNT })
  const [savingAcc, setSavingAcc] = useState(false)
  const [catName, setCatName] = useState('')
  const [catKind, setCatKind] = useState<CategoryKind>('despesa')
  const [savingCat, setSavingCat] = useState(false)

  const [filtroConta, setFiltroConta] = useState<string>('todas')
  const [busca, setBusca] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [acc, bal, cats, tx] = await Promise.all([
        listAccounts(true),
        accountBalances(),
        listCategories(undefined, true),
        listTransactions({ from: diaLocalComOffset(-60), limit: 3000 }),
      ])
      setAccounts(acc)
      setBalances(bal)
      setCategories(cats)
      setTxns(tx)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar contas e categorias')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const ativas = useMemo(() => accounts.filter((a) => a.active), [accounts])
  const conectadas = useMemo(() => ativas.filter((a) => a.ofAccountId), [ativas])
  const correntes = useMemo(() => conectadas.filter((a) => !ehCartao(a)), [conectadas])
  const cartoes = useMemo(() => conectadas.filter((a) => ehCartao(a)), [conectadas])
  const manuais = useMemo(() => ativas.filter((a) => !a.ofAccountId), [ativas])

  const saldoRazao = (a: FinAccount) => balances.get(a.id) ?? a.openingBalanceCents
  /** Conta ligada: manda o banco. Conta manual: manda o razão. */
  const saldoDaConta = (a: FinAccount) => (a.ofAccountId && a.ofBalanceCents != null ? a.ofBalanceCents : saldoRazao(a))

  /** Compras depois do fechamento — sai do nosso extrato, que é dado que a gente tem. */
  const cicloAberto = (a: FinAccount): number | null => {
    if (!a.ofBillCloseDate) return null
    const doCartao = txns.filter((t) => t.accountId === a.id && t.date > a.ofBillCloseDate!)
    if (doCartao.length === 0) return 0
    return doCartao.reduce((s, t) => s + Math.abs(t.amountCents), 0)
  }

  const emConta = useMemo(
    () => correntes.reduce((s, a) => s + saldoDaConta(a), 0) + manuais.reduce((s, a) => s + saldoRazao(a), 0),
    // saldoDaConta/saldoRazao nascem de novo a cada render; o que muda o número é o que está aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [correntes, manuais, balances],
  )
  const faturaAVencer = useMemo(
    () => cartoes.reduce((s, a) => s + (a.ofBillDueCents ?? a.ofBalanceCents ?? 0), 0),
    [cartoes],
  )

  const avisos = useMemo(() => {
    const lista: { tom: 'ruim' | 'atencao'; texto: string }[] = []
    for (const a of conectadas) {
      if (a.ofLastError) lista.push({ tom: 'ruim', texto: `${a.name}: o último sync falhou — ${a.ofLastError}` })
      const st = String(a.ofStatus ?? '')
      if (st.includes('LOGIN_ERROR') || st.includes('AUTHORIZATION_NOT_GRANTED')) {
        lista.push({ tom: 'ruim', texto: `${a.name}: o banco pede autorização de novo (${st}).` })
      }
    }
    const nota = conectadas.find((a) => a.ofProviderNote)?.ofProviderNote
    if (nota) lista.push({ tom: 'atencao', texto: `Provedor degradado: ${nota}` })
    return lista
  }, [conectadas])

  /** Saldo no fim de cada dia, andando para trás a partir do saldo de hoje. */
  const serieDaConta = (a: FinAccount, dias = 30): PontoSaldo[] => {
    const porDia = new Map<string, number>()
    for (const t of txns) {
      if (t.accountId !== a.id) continue
      porDia.set(t.date, (porDia.get(t.date) ?? 0) + t.amountCents)
    }
    const pontos: PontoSaldo[] = []
    let saldo = saldoDaConta(a)
    for (let i = 0; i < dias; i += 1) {
      const dia = diaLocalComOffset(-i)
      pontos.push({ dia, cents: saldo })
      saldo -= porDia.get(dia) ?? 0
    }
    return pontos.reverse()
  }

  const atualizarBanco = async () => {
    setAtualizando(true)
    try {
      const r = await linkBancoMcp()
      await load()
      if (r?.notice) toast.warning(r.notice)
      else toast.success(r?.inserted ? `Banco atualizado: ${r.inserted} lançamento(s) novo(s).` : 'Banco atualizado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao falar com o banco')
    } finally {
      setAtualizando(false)
    }
  }

  /**
   * Acerta o saldo inicial para o razão fechar com o banco.
   *
   * A conta ligada nasce com saldo inicial 0 e só recebe os últimos 90 dias de extrato, então
   * o razão fica com um buraco do tamanho de tudo que veio antes — na clínica isso era
   * -R$ 194.531,36 aparecendo como "saldo" de uma conta que tem R$ 82.644,32 no banco.
   */
  const baterComOBanco = async (a: FinAccount) => {
    const diferenca = (a.ofBalanceCents ?? 0) - saldoRazao(a)
    try {
      await upsertAccount({
        id: a.id,
        name: a.name,
        kind: a.kind,
        bankName: a.bankName,
        branch: a.branch,
        number: a.number,
        openingBalanceCents: a.openingBalanceCents + diferenca,
      })
      toast.success(`Saldo inicial ajustado em ${formatBRL(diferenca)}. O razão agora fecha com o banco.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ajustar o saldo inicial')
    }
  }

  const extrato = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return txns
      .filter((t) => (filtroConta === 'todas' ? true : t.accountId === filtroConta))
      .filter((t) =>
        termo ? `${t.description ?? ''} ${t.counterparty ?? ''}`.toLowerCase().includes(termo) : true,
      )
      .slice(0, 60)
  }, [txns, filtroConta, busca])

  const nomeDaConta = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])

  const catsByKind = useMemo(
    () => ({
      receita: categories.filter((c) => c.kind === 'receita'),
      despesa: categories.filter((c) => c.kind === 'despesa'),
    }),
    [categories],
  )

  const handleCreateAccount = async () => {
    if (!accForm.name.trim()) {
      toast.error('Dê um nome à conta.')
      return
    }
    setSavingAcc(true)
    try {
      await upsertAccount({
        name: accForm.name,
        kind: accForm.kind,
        bankName: accForm.bankName,
        branch: accForm.branch,
        number: accForm.number,
        openingBalanceCents: parseBRL(accForm.opening),
      })
      toast.success(`Conta "${accForm.name.trim()}" criada.`)
      setAccForm({ ...EMPTY_ACCOUNT })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar conta')
    } finally {
      setSavingAcc(false)
    }
  }

  const toggleAccount = async (a: FinAccount) => {
    try {
      await upsertAccount({
        id: a.id,
        name: a.name,
        kind: a.kind,
        bankName: a.bankName,
        branch: a.branch,
        number: a.number,
        active: !a.active,
      })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar conta')
    }
  }

  const handleCreateCategory = async () => {
    if (!catName.trim()) {
      toast.error('Informe o nome da categoria.')
      return
    }
    setSavingCat(true)
    try {
      await upsertCategory({ name: catName, kind: catKind })
      toast.success('Categoria criada.')
      setCatName('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar categoria')
    } finally {
      setSavingCat(false)
    }
  }

  const toggleCategory = async (c: FinCategory) => {
    try {
      await upsertCategory({ id: c.id, name: c.name, kind: c.kind, active: !c.active })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar categoria')
    }
  }

  return (
    <AppLayout
      title="Contas & caixa"
      subtitle="O dinheiro de verdade: saldo que veio do banco, fatura do cartão e o extrato que alimenta o resto do financeiro."
      actions={
        conectadas.length > 0 ? (
          <Button size="sm" variant="outline" onClick={() => void atualizarBanco()} disabled={atualizando}>
            <RefreshCw className={`size-4 ${atualizando ? 'animate-spin' : ''}`} />
            {atualizando ? 'Falando com o banco…' : 'Atualizar agora'}
          </Button>
        ) : null
      }
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />

      {avisos.length > 0 ? (
        <div className="mb-4 space-y-2">
          {avisos.map((a) => (
            <div
              key={a.texto}
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                a.tom === 'ruim'
                  ? 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-400'
              }`}
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0">{a.texto}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Em conta"
          icon={<Landmark className="size-3.5" aria-hidden />}
          value={formatBRL(emConta)}
          hint={`${correntes.length} conta(s) do banco + ${manuais.length} manual(is)`}
          valueClassName={emConta < 0 ? 'text-red-600' : undefined}
        />
        <StatCard
          label="Fatura do cartão a vencer"
          icon={<CreditCard className="size-3.5" aria-hidden />}
          value={cartoes.length ? formatBRL(faturaAVencer) : '—'}
          hint={
            cartoes.length
              ? cartoes[0].ofBillDueDate
                ? `vence ${ddmm(cartoes[0].ofBillDueDate)}`
                : 'sem data de vencimento'
              : 'nenhum cartão conectado'
          }
          valueClassName="text-amber-600 dark:text-amber-400"
        />
        <StatCard
          label="Sobra depois do cartão"
          icon={<Wallet className="size-3.5" aria-hidden />}
          value={formatBRL(emConta - faturaAVencer)}
          hint="o que resta se a fatura for paga hoje"
          valueClassName={emConta - faturaAVencer < 0 ? 'text-red-600' : undefined}
        />
        <StatCard
          label="Movimento de hoje"
          icon={<Banknote className="size-3.5" aria-hidden />}
          value={formatBRL(
            txns.filter((t) => t.date === hojeLocal()).reduce((s, t) => s + t.amountCents, 0),
          )}
          hint={`${txns.filter((t) => t.date === hojeLocal()).length} lançamento(s) no dia`}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {conectadas.length === 0 && !loading ? (
            <Card>
              <CardContent className="pt-4">
                <EmptyState
                  icon={Landmark}
                  title="Nenhum banco conectado"
                  description="Conecte o banco pela Conciliação para o saldo e o extrato entrarem sozinhos."
                />
              </CardContent>
            </Card>
          ) : null}

          {correntes.map((a) => {
            const idade = idadeDoDado(a.ofBalanceAt)
            const razao = saldoRazao(a)
            const diferenca = (a.ofBalanceCents ?? 0) - razao
            return (
              <Card key={a.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-sm">{a.name}</CardTitle>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.ofMeta?.bank?.transferNumber ?? [a.branch, a.number].filter(Boolean).join(' / ') ?? ''}
                        {a.ofMeta?.owner ? ` · ${a.ofMeta.owner}` : ''}
                      </p>
                    </div>
                    <Badge variant="secondary" className={`shrink-0 ${TOM_CLASSE[idade.tom]}`}>
                      {idade.texto}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className={`text-3xl font-semibold tabular-nums ${a.ofBalanceCents! < 0 ? 'text-red-600' : ''}`}>
                      {formatBRL(saldoDaConta(a))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      saldo informado pelo banco
                      {a.ofMeta?.realtime === false ? ' (último retrato do provedor, não tempo real)' : ''}
                    </p>
                  </div>

                  <SaldoSparkline pontos={serieDaConta(a)} />

                  {Math.abs(diferenca) > 100 ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                      <span className="min-w-0 text-muted-foreground">
                        O razão do CRM mostra <strong className="tabular-nums">{formatBRL(razao)}</strong>, {formatBRL(Math.abs(diferenca))}{' '}
                        {diferenca > 0 ? 'a menos' : 'a mais'} que o banco. Normal quando o extrato só entrou dos últimos meses.
                      </span>
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => void baterComOBanco(a)}>
                        Bater com o banco
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}

          {cartoes.map((a) => {
            const idade = idadeDoDado(a.ofBalanceAt)
            const limite = Number(a.ofMeta?.credit?.creditLimit ?? 0) * 100
            const aberto = cicloAberto(a)
            const aVencer = a.ofBillDueCents ?? a.ofBalanceCents ?? 0
            const usoPct = limite > 0 ? Math.min(100, Math.round(((aVencer + (aberto ?? 0)) / limite) * 100)) : null
            const billNote = (a.ofMeta as { billNote?: string } | null)?.billNote
            return (
              <Card key={a.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="flex items-center gap-1.5 truncate text-sm">
                        <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        {a.name}
                      </CardTitle>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.ofMeta?.credit?.brand ?? 'Cartão'}
                        {a.number ? ` · final ${a.number}` : ''}
                        {a.ofMeta?.owner ? ` · ${a.ofMeta.owner}` : ''}
                      </p>
                    </div>
                    <Badge variant="secondary" className={`shrink-0 ${TOM_CLASSE[idade.tom]}`}>
                      {idade.texto}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Fatura fechada{a.ofBillDueDate ? `, vence ${ddmm(a.ofBillDueDate)}` : ''}
                      </p>
                      <p className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                        {formatBRL(aVencer)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Ciclo aberto{a.ofBillCloseDate ? ` desde ${ddmm(a.ofBillCloseDate)}` : ''}
                      </p>
                      <p className="text-2xl font-semibold tabular-nums">{aberto == null ? '—' : formatBRL(aberto)}</p>
                    </div>
                  </div>

                  {usoPct != null ? (
                    <div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${usoPct > 80 ? 'bg-red-500' : 'bg-primary'}`}
                          style={{ width: `${usoPct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[0.7rem] text-muted-foreground">
                        {usoPct}% de {formatBRL(limite)} de limite
                        {a.ofDebtTotalCents != null ? ` · dívida total ${formatBRL(a.ofDebtTotalCents)}` : ''}
                      </p>
                    </div>
                  ) : null}

                  {billNote ? (
                    <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      {billNote} O valor acima é o que o banco informa como saldo do cartão, e o ciclo aberto foi somado
                      do extrato que já entrou aqui.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}

          {manuais.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Contas sem conexão</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {manuais.map((a) => {
                  const Icon = KIND_ICON[a.kind]
                  return (
                    <div key={a.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{a.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {KIND_LABEL[a.kind]} · lançado à mão
                          </div>
                        </div>
                      </div>
                      <span className={`shrink-0 font-semibold tabular-nums ${saldoRazao(a) < 0 ? 'text-red-600' : ''}`}>
                        {formatBRL(saldoRazao(a))}
                      </span>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="xl:sticky xl:top-4 xl:self-start">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Extrato</CardTitle>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Select value={filtroConta} onValueChange={(v) => setFiltroConta(v ?? 'todas')}>
                <SelectTrigger className="sm:w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as contas</SelectItem>
                  {ativas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  className="pl-8"
                  placeholder="Buscar por descrição"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {extrato.length === 0 ? (
              <EmptyState
                icon={Banknote}
                title={loading ? 'Carregando…' : 'Nada por aqui'}
                description="Sem lançamentos nos últimos 60 dias para este filtro."
              />
            ) : (
              <div className="max-h-[32rem] overflow-y-auto">
                <table className="w-full table-fixed text-sm">
                  <tbody>
                    {extrato.map((t) => (
                      <tr key={t.id} className="border-b border-border/60 last:border-0">
                        <td className="w-12 py-1.5 align-top text-xs tabular-nums text-muted-foreground">{ddmm(t.date)}</td>
                        <td className="py-1.5 align-top">
                          <div className="truncate" title={t.description ?? ''}>
                            {t.description ?? 'Lançamento'}
                          </div>
                          {filtroConta === 'todas' ? (
                            <div className="truncate text-[0.7rem] text-muted-foreground">{nomeDaConta.get(t.accountId)}</div>
                          ) : null}
                        </td>
                        <td
                          className={`w-28 py-1.5 text-right align-top font-medium tabular-nums ${
                            t.amountCents < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {formatBRL(t.amountCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4">
        <Button variant="ghost" size="sm" onClick={() => setGerenciar((v) => !v)}>
          <Settings2 className="size-4" /> {gerenciar ? 'Esconder cadastro' : 'Cadastro de contas e categorias'}
        </Button>
      </div>

      {gerenciar ? (
        <div className="mt-3 grid gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Landmark className="size-4 text-primary" /> Nova conta / caixa
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="acc-name">Nome</Label>
                    <Input
                      id="acc-name"
                      value={accForm.name}
                      onChange={(e) => setAccForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Ex.: Itaú, Caixa da recepção"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="acc-kind">Tipo</Label>
                    <Select value={accForm.kind} onValueChange={(v) => setAccForm((f) => ({ ...f, kind: (v as AccountKind) ?? 'banco' }))}>
                      <SelectTrigger id="acc-kind">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(['banco', 'caixa', 'carteira'] as AccountKind[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {KIND_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {accForm.kind === 'banco' ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="acc-bank">Banco</Label>
                      <Input id="acc-bank" value={accForm.bankName} onChange={(e) => setAccForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="Itaú" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="acc-branch">Agência</Label>
                      <Input id="acc-branch" value={accForm.branch} onChange={(e) => setAccForm((f) => ({ ...f, branch: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="acc-number">Conta</Label>
                      <Input id="acc-number" value={accForm.number} onChange={(e) => setAccForm((f) => ({ ...f, number: e.target.value }))} />
                    </div>
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="acc-opening">Saldo inicial (R$)</Label>
                  <Input
                    id="acc-opening"
                    value={accForm.opening}
                    onChange={(e) => setAccForm((f) => ({ ...f, opening: e.target.value }))}
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                  <p className="text-xs text-muted-foreground">O saldo de hoje, antes de lançar movimentações no sistema.</p>
                </div>
                <Button className="w-full" onClick={handleCreateAccount} disabled={savingAcc}>
                  <Plus className="size-4" /> {savingAcc ? 'Criando…' : 'Criar conta'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Todas as contas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {accounts.length === 0 ? (
                  <EmptyState icon={Wallet} title={loading ? 'Carregando…' : 'Nenhuma conta'} description="Cadastre onde o dinheiro fica: banco(s) e o caixa." />
                ) : (
                  accounts.map((a) => {
                    const Icon = KIND_ICON[a.kind]
                    return (
                      <div key={a.id} className={`flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm ${a.active ? '' : 'opacity-50'}`}>
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{a.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {KIND_LABEL[a.kind]}
                              {a.ofAccountId ? ' · conectada' : ''}
                              {a.branch || a.number ? ` · ${[a.branch, a.number].filter(Boolean).join(' / ')}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-semibold tabular-nums">{formatBRL(saldoDaConta(a))}</span>
                          <Button size="sm" variant="ghost" onClick={() => void toggleAccount(a)}>
                            {a.active ? 'Arquivar' : 'Reativar'}
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Tags className="size-4 text-primary" /> Nova categoria (plano de contas)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cat-name">Nome</Label>
                    <Input
                      id="cat-name"
                      value={catName}
                      onChange={(e) => setCatName(e.target.value)}
                      placeholder="Ex.: Aluguel, Consultas"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cat-kind">Tipo</Label>
                    <Select value={catKind} onValueChange={(v) => setCatKind((v as CategoryKind) ?? 'despesa')}>
                      <SelectTrigger id="cat-kind" className="w-[130px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="despesa">Despesa</SelectItem>
                        <SelectItem value="receita">Receita</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button className="w-full" onClick={handleCreateCategory} disabled={savingCat}>
                  <Plus className="size-4" /> {savingCat ? 'Criando…' : 'Criar categoria'}
                </Button>
              </CardContent>
            </Card>

            {(['despesa', 'receita'] as CategoryKind[]).map((kind) => (
              <Card key={kind}>
                <CardHeader>
                  <CardTitle className="text-sm capitalize">{kind === 'despesa' ? 'Despesas' : 'Receitas'}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1.5">
                  {catsByKind[kind].length === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">Nenhuma categoria de {kind}.</p>
                  ) : (
                    catsByKind[kind].map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => void toggleCategory(c)}
                        title={c.active ? 'Clique para arquivar' : 'Clique para reativar'}
                      >
                        <Badge
                          variant="secondary"
                          className={`cursor-pointer ${c.active ? '' : 'line-through opacity-50'} ${
                            kind === 'receita' ? 'bg-emerald-500/15 text-emerald-600' : ''
                          }`}
                        >
                          {c.name}
                        </Badge>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </AppLayout>
  )
}
