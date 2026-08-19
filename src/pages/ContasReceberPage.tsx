import { hojeLocal } from '@/lib/diaLocal'
import { FiltroPeriodo } from '@/components/page/FiltroPeriodo'
import { mesAtual, periodoDoMes, type Periodo } from '@/lib/periodo'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, Check, HandCoins, Plus } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
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
import { useTenant } from '@/context/TenantContext'
import {
  type AdquirenteMes,
  type FinAccount,
  type FinCategory,
  type Receivable,
  createReceivables,
  entrouNaContaNoPeriodo,
  listAccounts,
  listAdquirenteAReceber,
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

  // Período das RECEBIDAS. Começa no mês corrente, que é o que os KPIs mostram.
  // Filtro compartilhado: dava para chegar em "junho fechado" só digitando 01 e 30
  // à mão, e um dígito errado mudava o total sem avisar.
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDoMes(mesAtual()))
  const de = periodo.de
  const ate = periodo.ate
  const [adquirente, setAdquirente] = useState<AdquirenteMes[]>([])
  const [bankMonthCents, setBankMonthCents] = useState(0)

  const load = async (d = de, a = ate) => {
    setLoading(true)
    try {
      // ABERTO vem inteiro (é o que a tela cobra, e vencida pode ser de qualquer data).
      // RECEBIDO vem por período: com o ano do Shosp importado são 3.353 contas, e puxar
      // tudo a cada abertura só pra somar o mês é desperdício.
      const mesDe = `${hojeLocal().slice(0, 7)}-01`
      const [abertas, recebidas, acc, cats, adq, banco] = await Promise.all([
        listReceivables({ status: 'aberto' }),
        listReceivables({ status: 'recebido', from: d, to: a }),
        listAccounts(),
        listCategories('receita'),
        listAdquirenteAReceber(),
        entrouNaContaNoPeriodo(mesDe, hojeLocal()),
      ])
      setReceivables([...abertas, ...recebidas])
      setAccounts(acc)
      setCategories(cats)
      setAdquirente(adq)
      setBankMonthCents(banco)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar contas a receber')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const today = hojeLocal()
  const thisMonth = today.slice(0, 7)

  const kpis = useMemo(() => {
    const open = receivables.filter((r) => r.status === 'aberto')
    return {
      overdueCents: open.filter((r) => r.dueDate < today).reduce((s, r) => s + r.amountCents, 0),
      // VENDIDO, não recebido: é o que o paciente pagou no mês, independente de onde o
      // dinheiro esteja. `dueDate` é a data da venda no Shosp.
      soldMonthCents: receivables
        .filter((r) => r.status === 'recebido' && monthKey(r.dueDate) === thisMonth)
        .reduce((s, r) => s + r.amountCents, 0),
      bankMonthCents,
      acquirerCents: adquirente.reduce((s, m) => s + m.amountCents, 0),
    }
  }, [receivables, today, thisMonth, bankMonthCents, adquirente])

  /** Último mês com parcela agendada — o "até quando" do a receber. */
  const adquirenteAte = adquirente.at(-1)?.mes ?? ''

  /**
   * Recebidas do período, agrupadas por mês.
   *
   * Sem isto a tela mostrava só o que está EM ABERTO — e depois que o ano de vendas do Shosp
   * entrou (3.353 contas, R$ 13,2 milhões, todas já recebidas) ela ficou com quatro zeros e
   * cara de quebrada. O dinheiro estava lá; a tela é que não tinha onde mostrar.
   */
  const recebidas = useMemo(() => {
    const grupos = new Map<string, Receivable[]>()
    for (const r of receivables) {
      if (r.status !== 'recebido') continue
      const key = monthKey(r.receivedAt?.slice(0, 10) || r.dueDate)
      grupos.set(key, [...(grupos.get(key) ?? []), r])
    }
    return Array.from(grupos.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [receivables])

  const totalRecebidas = useMemo(
    () => receivables.filter((r) => r.status === 'recebido').reduce((s, r) => s + r.amountCents, 0),
    [receivables],
  )

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
    setRecvDate(hojeLocal())
  }

  const confirmReceive = async () => {
    const r = receiving
    if (!r) return
    try {
      await receiveReceivable(r, { accountId: recvAccountId || null, receivedOn: recvDate || undefined })
      toast.success(recvAccountId ? `"${r.description}" recebida, entrada lançada no caixa.` : `"${r.description}" recebida.`)
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
      <FinanceTabs isSalesPolo={tenant.poloType === 'sales'} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Estes quatro nomes já mentiram. "Recebido no mês" mostrava R$ 410.681 em agosto/2026
            quando só R$ 85.956 (o PIX) tinham entrado na conta: o resto era cartão no adquirente
            e dinheiro na gaveta. Quem pagou foi o paciente — VENDIDO é a palavra certa. E o a
            receber de verdade, R$ 2,1 milhões de parcela de cartão, não aparecia em lugar nenhum. */}
        {[
          {
            label: 'Vendido no mês',
            value: kpis.soldMonthCents,
            hint: 'o paciente pagou, esteja o dinheiro onde estiver',
            alert: false,
          },
          {
            label: 'Entrou na conta no mês',
            value: kpis.bankMonthCents,
            hint: 'extrato das contas de banco',
            alert: false,
          },
          {
            label: 'A receber do adquirente',
            value: kpis.acquirerCents,
            hint: adquirenteAte ? `parcelas de cartão até ${monthLabel(adquirenteAte)}` : 'parcelas de cartão',
            alert: false,
          },
          {
            label: 'Vencidas',
            value: kpis.overdueCents,
            hint: 'contas agendadas na mão que passaram do prazo',
            alert: kpis.overdueCents > 0,
          },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
              <p className={`mt-1 text-lg font-bold ${kpi.alert ? 'text-red-500' : ''}`}>{formatBRL(kpi.value)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{kpi.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* O a receber do adquirente é um TETO, e dizer isso é o que separa número de chute:
          parcela antecipada já foi paga e deixou de ser a receber, mas o extrato só mostra o
          valor total do adiantamento, nunca QUAIS parcelas ele cobriu. */}
      {kpis.acquirerCents > 0 && (
        <div className="mb-4 -mt-1">
          <p className="text-xs text-muted-foreground">
            O valor a receber do adquirente é um teto: ele não desconta antecipação. Parcela
            antecipada já foi paga e saiu do saldo, mas o extrato só informa o total adiantado,
            nunca quais parcelas ele cobriu.
          </p>
        </div>
      )}
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
                placeholder="Ex.: Pacote 10 sessões, Maria"
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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

      {/* JÁ RECEBIDAS. Existe porque a tela inteira acima só fala de "aberto", e a receita
          real da clínica entra pelo Shosp já paga — sem este painel, R$ 13,2 milhões de
          venda importada ficavam invisíveis e a tela parecia vazia. */}
      <Card className="mt-4">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-sm">
            <HandCoins className="size-4 text-primary" /> Já recebidas
            <span className="font-normal text-muted-foreground">{formatBRL(totalRecebidas)}</span>
          </CardTitle>
          <div className="flex flex-wrap items-end gap-2">
            <FiltroPeriodo
              valor={periodo}
              onChange={setPeriodo}
              atalhos={['mes-atual', 'mes-passado', 'dias:30', 'dias:90']}
            />
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
              Buscar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {recebidas.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title={loading ? 'Carregando…' : 'Nada recebido no período'}
              description="Aumente o período acima. A venda do Shosp entra aqui já como recebida."
            />
          ) : (
            recebidas.map(([key, rows]) => {
              const total = rows.reduce((s, r) => s + r.amountCents, 0)
              return (
                <div key={key}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <h3 className="text-sm font-semibold capitalize">{monthLabel(key)}</h3>
                    <span className="text-sm font-semibold text-muted-foreground">
                      {formatBRL(total)} · {rows.length} lançamento(s)
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {rows.slice(0, 40).map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDay(r.receivedAt?.slice(0, 10) || r.dueDate)}
                            {r.customerName ? ` · ${r.customerName}` : ''}
                            {r.method ? ` · ${r.method}` : ''}
                          </div>
                        </div>
                        <span className="shrink-0 font-semibold">{formatBRL(r.amountCents)}</span>
                      </div>
                    ))}
                    {/* Nunca cortar calado: dizer quantas ficaram de fora. */}
                    {rows.length > 40 && (
                      <p className="text-xs text-muted-foreground">
                        …e mais {rows.length - 40} lançamento(s) neste mês, somados no total acima.
                      </p>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

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
