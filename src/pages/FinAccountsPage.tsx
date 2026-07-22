import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Banknote, Landmark, Plus, Wallet, Tags } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { financeiroTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import {
  type AccountKind,
  type CategoryKind,
  type FinAccount,
  type FinCategory,
  accountBalances,
  listAccounts,
  listCategories,
  upsertAccount,
  upsertCategory,
} from '@/services/financeiro'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function parseBRL(value: string): number {
  return Math.round((Number(value.replace(/\./g, '').replace(',', '.')) || 0) * 100)
}

const KIND_LABEL: Record<AccountKind, string> = { banco: 'Banco', caixa: 'Caixa/Dinheiro', carteira: 'Carteira' }
const KIND_ICON: Record<AccountKind, typeof Landmark> = { banco: Landmark, caixa: Banknote, carteira: Wallet }

const EMPTY_ACCOUNT = { name: '', kind: 'banco' as AccountKind, bankName: '', branch: '', number: '', opening: '' }

export function FinAccountsPage() {
  const { tenant } = useTenant()
  const [accounts, setAccounts] = useState<FinAccount[]>([])
  const [balances, setBalances] = useState<Map<string, number>>(new Map())
  const [categories, setCategories] = useState<FinCategory[]>([])
  const [loading, setLoading] = useState(false)

  const [accForm, setAccForm] = useState({ ...EMPTY_ACCOUNT })
  const [savingAcc, setSavingAcc] = useState(false)

  const [catName, setCatName] = useState('')
  const [catKind, setCatKind] = useState<CategoryKind>('despesa')
  const [savingCat, setSavingCat] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [acc, bal, cats] = await Promise.all([listAccounts(true), accountBalances(), listCategories(undefined, true)])
      setAccounts(acc)
      setBalances(bal)
      setCategories(cats)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar contas e categorias')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const totalBalance = useMemo(
    () => accounts.filter((a) => a.active).reduce((s, a) => s + (balances.get(a.id) ?? a.openingBalanceCents), 0),
    [accounts, balances],
  )

  const catsByKind = useMemo(() => {
    return {
      receita: categories.filter((c) => c.kind === 'receita'),
      despesa: categories.filter((c) => c.kind === 'despesa'),
    }
  }, [categories])

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
      subtitle="Onde o dinheiro fica (bancos e caixa) e o plano de contas que organiza entradas e saídas."
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />

      <div className="mb-4">
        <Card>
          <CardContent className="flex items-center justify-between pt-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Saldo total (contas ativas)</p>
              <p className="mt-1 text-2xl font-bold">{formatBRL(totalBalance)}</p>
            </div>
            <Wallet className="size-8 text-muted-foreground/40" aria-hidden />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Contas / caixa */}
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
                <div className="grid grid-cols-3 gap-2">
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
              <CardTitle className="text-sm">Contas cadastradas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {accounts.length === 0 ? (
                <EmptyState icon={Wallet} title={loading ? 'Carregando…' : 'Nenhuma conta'} description="Cadastre onde o dinheiro fica: banco(s) e o caixa." />
              ) : (
                accounts.map((a) => {
                  const Icon = KIND_ICON[a.kind]
                  const bal = balances.get(a.id) ?? a.openingBalanceCents
                  return (
                    <div key={a.id} className={`flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm ${a.active ? '' : 'opacity-50'}`}>
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{a.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {KIND_LABEL[a.kind]}
                            {a.branch || a.number ? ` · ${[a.branch, a.number].filter(Boolean).join(' / ')}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`font-semibold ${bal < 0 ? 'text-red-500' : ''}`}>{formatBRL(bal)}</span>
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

        {/* Plano de contas / categorias */}
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
    </AppLayout>
  )
}
