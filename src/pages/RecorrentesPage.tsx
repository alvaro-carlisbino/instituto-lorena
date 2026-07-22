import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Repeat } from 'lucide-react'

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
import { type Supplier, listSuppliers } from '@/services/estoqueCompras'
import {
  type FinAccount,
  type FinCategory,
  type Recurring,
  type RecurringKind,
  listAccounts,
  listCategories,
  listRecurring,
  setRecurringActive,
  upsertRecurring,
} from '@/services/financeiro'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function parseBRL(value: string): number {
  return Math.round((Number(value.replace(/\./g, '').replace(',', '.')) || 0) * 100)
}

const EMPTY = {
  kind: 'payable' as RecurringKind,
  description: '',
  categoryId: '',
  accountId: '',
  supplierId: '',
  amount: '',
  dayOfMonth: '5',
  method: 'boleto',
}

export function RecorrentesPage() {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<Recurring[]>([])
  const [accounts, setAccounts] = useState<FinAccount[]>([])
  const [categories, setCategories] = useState<FinCategory[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [r, acc, cats, sup] = await Promise.all([
        listRecurring(),
        listAccounts(),
        listCategories(undefined, false),
        listSuppliers(),
      ])
      setRows(r)
      setAccounts(acc)
      setCategories(cats)
      setSuppliers(sup)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar recorrentes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const catsForKind = useMemo(
    () => categories.filter((c) => c.kind === (form.kind === 'receivable' ? 'receita' : 'despesa')),
    [categories, form.kind],
  )
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name] as const)), [categories])
  const accName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name] as const)), [accounts])

  const handleCreate = async () => {
    if (!form.description.trim() || parseBRL(form.amount) <= 0) {
      toast.error('Preencha descrição e valor.')
      return
    }
    setSaving(true)
    try {
      await upsertRecurring({
        kind: form.kind,
        description: form.description,
        categoryId: form.categoryId || null,
        accountId: form.accountId || null,
        supplierId: form.kind === 'payable' ? form.supplierId || null : null,
        amountCents: parseBRL(form.amount),
        dayOfMonth: Number(form.dayOfMonth) || 1,
        paymentMethod: form.method,
      })
      toast.success('Recorrência criada. Ela vira conta todo mês automaticamente.')
      setForm({ ...EMPTY })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar recorrência')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (r: Recurring) => {
    try {
      await setRecurringActive(r.id, !r.active)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar')
    }
  }

  return (
    <AppLayout
      title="Recorrentes"
      subtitle="Aluguel, salários e contas fixas que viram automaticamente conta a pagar/receber todo mês."
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Plus className="size-4 text-primary" /> Nova recorrência
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="rec-kind">Tipo</Label>
                <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: (v as RecurringKind) ?? 'payable', categoryId: '' }))}>
                  <SelectTrigger id="rec-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="payable">A pagar</SelectItem>
                    <SelectItem value="receivable">A receber</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-day">Dia do vencimento</Label>
                <Input
                  id="rec-day"
                  value={form.dayOfMonth}
                  onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value }))}
                  inputMode="numeric"
                  placeholder="1 a 28"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-desc">Descrição</Label>
              <Input
                id="rec-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Ex.: Aluguel da clínica"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="rec-amount">Valor (R$)</Label>
                <Input
                  id="rec-amount"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rec-category">Categoria</Label>
                <Select value={form.categoryId} onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v ?? '' }))}>
                  <SelectTrigger id="rec-category">
                    <SelectValue placeholder="Opcional" />
                  </SelectTrigger>
                  <SelectContent>
                    {catsForKind.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="rec-account">Conta prevista</Label>
                <Select value={form.accountId} onValueChange={(v) => setForm((f) => ({ ...f, accountId: v ?? '' }))}>
                  <SelectTrigger id="rec-account">
                    <SelectValue placeholder="Opcional" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.kind === 'payable' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="rec-supplier">Fornecedor</Label>
                  <Select value={form.supplierId} onValueChange={(v) => setForm((f) => ({ ...f, supplierId: v ?? '' }))}>
                    <SelectTrigger id="rec-supplier">
                      <SelectValue placeholder="Opcional" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="rec-method">Forma</Label>
                  <Select value={form.method} onValueChange={(v) => setForm((f) => ({ ...f, method: v ?? 'pix' }))}>
                    <SelectTrigger id="rec-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['pix', 'boleto', 'cartao', 'dinheiro', 'transferencia'].map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={saving}>
              {saving ? 'Criando…' : 'Criar recorrência'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Repeat className="size-4 text-primary" /> Recorrências ({rows.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {rows.length === 0 ? (
              <EmptyState
                icon={Repeat}
                title={loading ? 'Carregando…' : 'Nenhuma recorrência'}
                description="Cadastre aluguel, salários e contas fixas; o sistema gera as parcelas todo mês."
              />
            ) : (
              rows.map((r) => (
                <div key={r.id} className={`flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm ${r.active ? '' : 'opacity-50'}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={r.kind === 'receivable' ? 'bg-emerald-500/15 text-emerald-600' : ''}>
                        {r.kind === 'receivable' ? 'a receber' : 'a pagar'}
                      </Badge>
                      <span className="truncate font-medium">{r.description}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      todo dia {r.dayOfMonth}
                      {r.categoryId ? ` · ${catName.get(r.categoryId) ?? ''}` : ''}
                      {r.accountId ? ` · ${accName.get(r.accountId) ?? ''}` : ''}
                      {r.lastGeneratedOn ? ` · último: ${r.lastGeneratedOn.slice(0, 7)}` : ' · ainda não gerou'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold">{formatBRL(r.amountCents)}</span>
                    <Button size="sm" variant="ghost" onClick={() => void toggle(r)}>
                      {r.active ? 'Pausar' : 'Reativar'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
