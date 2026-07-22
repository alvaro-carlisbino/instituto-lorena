import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, Check, HandCoins, Plus } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { financeiroTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import {
  type FinAccount,
  type FinCategory,
  type Receivable,
  createReceivables,
  listAccounts,
  listCategories,
  listReceivables,
  receiveReceivable,
} from '@/services/financeiro'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function parseBRL(value: string): number {
  return Math.round((Number(value.replace(/\./g, '').replace(',', '.')) || 0) * 100)
}
function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')
}
function monthKey(iso: string): string {
  return iso.slice(0, 7)
}
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

const EMPTY_FORM = {
  description: '',
  customerName: '',
  categoryId: '',
  accountId: '',
  amount: '',
  firstDue: '',
  installments: '1',
  method: 'pix',
}

export function ContasReceberPage() {
  const { tenant } = useTenant()
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [accounts, setAccounts] = useState<FinAccount[]>([])
  const [categories, setCategories] = useState<FinCategory[]>([])
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)

  const [receiving, setReceiving] = useState<Receivable | null>(null)
  const [recvAccountId, setRecvAccountId] = useState('')
  const [recvDate, setRecvDate] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [r, acc, cats] = await Promise.all([listReceivables(), listAccounts(), listCategories('receita')])
      setReceivables(r)
      setAccounts(acc)
      setCategories(cats)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar contas a receber')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const thisMonth = today.slice(0, 7)

  const kpis = useMemo(() => {
    const open = receivables.filter((r) => r.status === 'aberto')
    const in7 = new Date()
    in7.setDate(in7.getDate() + 7)
    const in7Key = in7.toISOString().slice(0, 10)
    return {
      overdueCents: open.filter((r) => r.dueDate < today).reduce((s, r) => s + r.amountCents, 0),
      next7Cents: open.filter((r) => r.dueDate >= today && r.dueDate <= in7Key).reduce((s, r) => s + r.amountCents, 0),
      openMonthCents: open.filter((r) => monthKey(r.dueDate) === thisMonth).reduce((s, r) => s + r.amountCents, 0),
      receivedMonthCents: receivables
        .filter((r) => r.status === 'recebido' && r.receivedAt != null && r.receivedAt.slice(0, 7) === thisMonth)
        .reduce((s, r) => s + r.amountCents, 0),
    }
  }, [receivables, today, thisMonth])

  const agenda = useMemo(() => {
    const open = receivables.filter((r) => r.status === 'aberto')
    const groups = new Map<string, Receivable[]>()
    for (const r of open) {
      const key = r.dueDate < today ? 'vencidas' : monthKey(r.dueDate)
      groups.set(key, [...(groups.get(key) ?? []), r])
    }
    return Array.from(groups.entries()).sort(([a], [b]) =>
      a === 'vencidas' ? -1 : b === 'vencidas' ? 1 : a.localeCompare(b),
    )
  }, [receivables, today])

  const handleCreate = async () => {
    if (!form.description.trim() || !form.firstDue || parseBRL(form.amount) <= 0) {
      toast.error('Preencha descrição, valor e primeiro vencimento.')
      return
    }
    setSaving(true)
    try {
      await createReceivables({
        description: form.description,
        customerName: form.customerName || null,
        categoryId: form.categoryId || null,
        accountId: form.accountId || null,
        amountCents: parseBRL(form.amount),
        firstDueDate: form.firstDue,
        installments: Number(form.installments) || 1,
        method: form.method,
      })
      toast.success('Recebimento programado.')
      setForm({ ...EMPTY_FORM })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao programar recebimento')
    } finally {
      setSaving(false)
    }
  }

  const openReceiveDialog = (r: Receivable) => {
    setReceiving(r)
    setRecvAccountId(r.accountId ?? '')
    setRecvDate(new Date().toISOString().slice(0, 10))
  }

  const confirmReceive = async () => {
    const r = receiving
    if (!r) return
    try {
      await receiveReceivable(r, { accountId: recvAccountId || null, receivedOn: recvDate || undefined })
      toast.success(recvAccountId ? `"${r.description}" recebida — entrada lançada no caixa.` : `"${r.description}" recebida.`)
      setReceiving(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao dar baixa')
    }
  }

  return (
    <AppLayout
      title="Contas a receber"
      subtitle="O que a clínica tem para receber: consultas, pacotes e vendas, com vencimento e baixa no caixa."
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Vencidas', value: kpis.overdueCents, alert: kpis.overdueCents > 0 },
          { label: 'Vencem em 7 dias', value: kpis.next7Cents, alert: false },
          { label: 'A receber no mês', value: kpis.openMonthCents, alert: false },
          { label: 'Recebido no mês', value: kpis.receivedMonthCents, alert: false },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
              <p className={`mt-1 text-lg font-bold ${kpi.alert ? 'text-red-500' : ''}`}>{formatBRL(kpi.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Plus className="size-4 text-primary" /> Programar recebimento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rc-desc">Descrição</Label>
              <Input
                id="rc-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Ex.: Pacote 10 sessões — Maria"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-customer">Cliente (opcional)</Label>
              <Input
                id="rc-customer"
                value={form.customerName}
                onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                placeholder="Nome do paciente"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="rc-amount">Valor parcela</Label>
                <Input
                  id="rc-amount"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-due">1º vencimento</Label>
                <Input id="rc-due" type="date" value={form.firstDue} onChange={(e) => setForm((f) => ({ ...f, firstDue: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-inst">Parcelas</Label>
                <Input
                  id="rc-inst"
                  value={form.installments}
                  onChange={(e) => setForm((f) => ({ ...f, installments: e.target.value }))}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="rc-category">Categoria</Label>
                <Select value={form.categoryId} onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v ?? '' }))}>
                  <SelectTrigger id="rc-category">
                    <SelectValue placeholder="Opcional" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-method">Forma</Label>
                <Select value={form.method} onValueChange={(v) => setForm((f) => ({ ...f, method: v ?? 'pix' }))}>
                  <SelectTrigger id="rc-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['pix', 'cartao', 'dinheiro', 'transferencia', 'boleto'].map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={saving}>
              {saving ? 'Programando…' : 'Programar recebimento'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClock className="size-4 text-primary" /> Agenda de recebimentos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {agenda.length === 0 ? (
              <EmptyState
                icon={HandCoins}
                title={loading ? 'Carregando…' : 'Nada a receber'}
                description="Programe recebimentos ao lado; a projeção por mês aparece aqui."
              />
            ) : (
              agenda.map(([key, rows]) => {
                const total = rows.reduce((s, r) => s + r.amountCents, 0)
                const isOverdue = key === 'vencidas'
                return (
                  <div key={key}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <h3 className={`text-sm font-semibold capitalize ${isOverdue ? 'text-red-500' : ''}`}>
                        {isOverdue ? 'Vencidas' : monthLabel(key)}
                      </h3>
                      <span className={`text-sm font-semibold ${isOverdue ? 'text-red-500' : 'text-muted-foreground'}`}>
                        {formatBRL(total)}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {rows.map((r) => (
                        <div
                          key={r.id}
                          className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                            isOverdue ? 'border-red-500/40 bg-red-500/5' : 'border-border'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{r.description}</div>
                            <div className="text-xs text-muted-foreground">
                              vence {formatDay(r.dueDate)}
                              {r.customerName ? ` · ${r.customerName}` : ''}
                              {r.method ? ` · ${r.method}` : ''}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="font-semibold">{formatBRL(r.amountCents)}</span>
                            <Button size="sm" variant="outline" onClick={() => openReceiveDialog(r)}>
                              <Check className="size-3.5" /> Recebi
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
            )}

            {receivables.some((r) => r.status === 'recebido') ? (
              <div>
                <h3 className="mb-1.5 text-sm font-semibold text-muted-foreground">Recebidas recentemente</h3>
                <div className="space-y-1.5">
                  {receivables
                    .filter((r) => r.status === 'recebido')
                    .slice(-8)
                    .reverse()
                    .map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm opacity-70">
                        <div className="min-w-0">
                          <div className="truncate">{r.description}</div>
                          <div className="text-xs text-muted-foreground">venceu {formatDay(r.dueDate)}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span>{formatBRL(r.amountCents)}</span>
                          <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600">
                            recebido
                          </Badge>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={receiving != null} onOpenChange={(open) => (!open ? setReceiving(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar recebimento</DialogTitle>
            <DialogDescription>
              {receiving?.description} · {formatBRL(receiving?.amountCents ?? 0)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="recv-account">Conta que recebeu</Label>
              <Select value={recvAccountId} onValueChange={(v) => setRecvAccountId(v ?? '')}>
                <SelectTrigger id="recv-account">
                  <SelectValue placeholder="Sem lançar no caixa" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Com uma conta, a entrada aparece no fluxo de caixa. Sem conta, só marca como recebida.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recv-date">Data do recebimento</Label>
              <Input id="recv-date" type="date" value={recvDate} onChange={(e) => setRecvDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReceiving(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmReceive}>Confirmar recebimento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
