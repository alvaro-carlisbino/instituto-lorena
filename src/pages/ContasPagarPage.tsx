import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, Check, ChevronDown, FileCode, FileText, Paperclip, Plus, Receipt } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
  type InvoiceMovement,
  type Payable,
  type PurchaseInvoice,
  type StockItem,
  type Supplier,
  createPayables,
  createPurchaseInvoice,
  getAttachmentSignedUrl,
  listInvoiceMovements,
  listPayables,
  listPurchaseInvoices,
  listStockItems,
  listSuppliers,
  setPayableStatus,
} from '@/services/estoqueCompras'
import { type NfeParsed, parseNfeXml } from '@/services/nfeXml'
import { type NfeItemPlan, importNfe, suggestItemPlan } from '@/services/nfeImport'
import { type FinAccount, type FinCategory, listAccounts, listCategories } from '@/services/financeiro'

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

const EMPTY_NF = { number: '', supplierId: '', issueDate: '', total: '', note: '' }
const EMPTY_PAYABLE = {
  description: '',
  supplierId: '',
  invoiceId: '',
  categoryId: '',
  accountId: '',
  amount: '',
  firstDue: '',
  installments: '1',
  method: 'boleto',
  barcode: '',
}

export function ContasPagarPage() {
  const { tenant } = useTenant()
  const [payables, setPayables] = useState<Payable[]>([])
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(false)

  const [nfForm, setNfForm] = useState({ ...EMPTY_NF })
  const [nfFile, setNfFile] = useState<File | null>(null)
  const nfFileRef = useRef<HTMLInputElement | null>(null)
  const [savingNf, setSavingNf] = useState(false)

  const [payForm, setPayForm] = useState({ ...EMPTY_PAYABLE })
  const [savingPayable, setSavingPayable] = useState(false)

  // Plano de contas + contas bancárias/caixa (para categorizar e dar baixa no caixa).
  const [accounts, setAccounts] = useState<FinAccount[]>([])
  const [categories, setCategories] = useState<FinCategory[]>([])

  // Diálogo de baixa: escolher conta (banco/caixa) e data — registra a saída no fluxo de caixa.
  const [payingPayable, setPayingPayable] = useState<Payable | null>(null)
  const [payAccountId, setPayAccountId] = useState('')
  const [payDate, setPayDate] = useState('')

  // Importador de NF-e (XML)
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [nfe, setNfe] = useState<NfeParsed | null>(null)
  const [nfePlan, setNfePlan] = useState<NfeItemPlan[]>([])
  const [nfeCreateSupplier, setNfeCreateSupplier] = useState(true)
  const [nfeCreatePayables, setNfeCreatePayables] = useState(true)
  /** Vencimento da parcela única quando a nota não traz duplicatas. */
  const [nfeSingleDue, setNfeSingleDue] = useState('')
  const [importing, setImporting] = useState(false)
  const nfeFileRef = useRef<HTMLInputElement | null>(null)

  // Histórico da nota: quais entradas de estoque saíram dela (carrega ao expandir).
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null)
  const [invoiceMovements, setInvoiceMovements] = useState<Record<string, InvoiceMovement[]>>({})
  const [loadingInvoiceId, setLoadingInvoiceId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [p, inv, sup, items, acc, cats] = await Promise.all([
        listPayables(),
        listPurchaseInvoices(),
        listSuppliers(),
        listStockItems(true),
        listAccounts(),
        listCategories('despesa'),
      ])
      setPayables(p)
      setInvoices(inv)
      setSuppliers(sup)
      setStockItems(items)
      setAccounts(acc)
      setCategories(cats)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar contas a pagar')
    } finally {
      setLoading(false)
    }
  }

  const handleNfeFile = async (file: File | null) => {
    if (!file) return
    try {
      const xml = await file.text()
      const parsed = parseNfeXml(xml)
      setNfe(parsed)
      setNfePlan(suggestItemPlan(parsed, stockItems))
      setNfeCreateSupplier(true)
      // Sem duplicata a nota também vira conta a pagar (parcela única, vence na emissão) —
      // senão a compra à vista entra no estoque e nunca aparece no financeiro.
      setNfeCreatePayables(parsed.totalCents > 0)
      setNfeSingleDue(parsed.issueDate ?? new Date().toISOString().slice(0, 10))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ler o XML')
    } finally {
      if (nfeFileRef.current) nfeFileRef.current.value = ''
    }
  }

  const existingSupplierMatch = useMemo(() => {
    if (!nfe?.supplierCnpj) return null
    const digits = nfe.supplierCnpj.replace(/\D/g, '')
    return suppliers.find((s) => (s.cnpj ?? '').replace(/\D/g, '') === digits) ?? null
  }, [nfe, suppliers])

  const confirmImport = async () => {
    if (!nfe) return
    setImporting(true)
    try {
      const result = await importNfe(nfe, {
        createSupplier: nfeCreateSupplier && !existingSupplierMatch,
        supplierId: existingSupplierMatch?.id ?? null,
        createPayables: nfeCreatePayables,
        singleDueDate: nfe.installments.length === 0 ? nfeSingleDue || null : null,
        itemsPlan: nfePlan,
      })
      toast.success(
        `NF ${result.invoiceNumber} importada: ${result.itemsStocked} ${result.itemsStocked === 1 ? 'entrada' : 'entradas'} no estoque` +
          (result.itemsCreated > 0 ? ` (${result.itemsCreated} ${result.itemsCreated === 1 ? 'item novo' : 'itens novos'})` : '') +
          (result.batches > 0 ? `, ${result.batches} ${result.batches === 1 ? 'lote' : 'lotes'}` : '') +
          (result.payables > 0 ? `, ${result.payables} ${result.payables === 1 ? 'parcela' : 'parcelas'}` : '') +
          (result.blingPushed > 0 ? `, ${result.blingPushed} ${result.blingPushed === 1 ? 'entrada' : 'entradas'} espelhada${result.blingPushed === 1 ? '' : 's'} no Bling` : '') + '.',
      )
      setNfe(null)
      setNfePlan([])
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao importar a NF-e')
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const thisMonth = today.slice(0, 7)

  const kpis = useMemo(() => {
    const open = payables.filter((p) => p.status === 'aberto')
    const in7 = new Date()
    in7.setDate(in7.getDate() + 7)
    const in7Key = in7.toISOString().slice(0, 10)
    return {
      overdueCents: open.filter((p) => p.dueDate < today).reduce((s, p) => s + p.amountCents, 0),
      next7Cents: open.filter((p) => p.dueDate >= today && p.dueDate <= in7Key).reduce((s, p) => s + p.amountCents, 0),
      openMonthCents: open.filter((p) => monthKey(p.dueDate) === thisMonth).reduce((s, p) => s + p.amountCents, 0),
      paidMonthCents: payables
        .filter((p) => p.status === 'pago' && p.paidAt != null && p.paidAt.slice(0, 7) === thisMonth)
        .reduce((s, p) => s + p.amountCents, 0),
    }
  }, [payables, today, thisMonth])

  // Projeção: parcelas em aberto agrupadas por mês de vencimento (vencidas primeiro).
  const agenda = useMemo(() => {
    const open = payables.filter((p) => p.status === 'aberto')
    const groups = new Map<string, Payable[]>()
    for (const p of open) {
      const key = p.dueDate < today ? 'vencidas' : monthKey(p.dueDate)
      groups.set(key, [...(groups.get(key) ?? []), p])
    }
    return Array.from(groups.entries()).sort(([a], [b]) =>
      a === 'vencidas' ? -1 : b === 'vencidas' ? 1 : a.localeCompare(b),
    )
  }, [payables, today])

  const handleCreateNf = async () => {
    if (!nfForm.number.trim()) {
      toast.error('Informe o número da nota.')
      return
    }
    setSavingNf(true)
    try {
      await createPurchaseInvoice({
        number: nfForm.number,
        supplierId: nfForm.supplierId || null,
        issueDate: nfForm.issueDate || null,
        totalCents: parseBRL(nfForm.total),
        note: nfForm.note,
        file: nfFile,
      })
      toast.success(`NF ${nfForm.number.trim()} registrada.`)
      setNfForm({ ...EMPTY_NF })
      setNfFile(null)
      if (nfFileRef.current) nfFileRef.current.value = ''
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar a nota')
    } finally {
      setSavingNf(false)
    }
  }

  const handleCreatePayable = async () => {
    if (!payForm.description.trim() || !payForm.firstDue || parseBRL(payForm.amount) <= 0) {
      toast.error('Preencha descrição, valor e primeiro vencimento.')
      return
    }
    setSavingPayable(true)
    try {
      await createPayables({
        description: payForm.description,
        supplierId: payForm.supplierId || null,
        invoiceId: payForm.invoiceId || null,
        categoryId: payForm.categoryId || null,
        accountId: payForm.accountId || null,
        amountCents: parseBRL(payForm.amount),
        firstDueDate: payForm.firstDue,
        installments: Number(payForm.installments) || 1,
        paymentMethod: payForm.method,
        barcode: payForm.barcode,
      })
      toast.success('Pagamento programado.')
      setPayForm({ ...EMPTY_PAYABLE })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao programar pagamento')
    } finally {
      setSavingPayable(false)
    }
  }

  const openPayDialog = (p: Payable) => {
    setPayingPayable(p)
    setPayAccountId(p.accountId ?? '')
    setPayDate(new Date().toISOString().slice(0, 10))
  }

  const confirmPay = async () => {
    const p = payingPayable
    if (!p) return
    try {
      await setPayableStatus(p.id, 'pago', {
        accountId: payAccountId || null,
        paidOn: payDate || undefined,
        amountCents: p.amountCents,
        categoryId: p.categoryId,
        description: p.description,
        supplierName: p.supplierName,
      })
      toast.success(
        payAccountId
          ? `"${p.description}" paga — saída lançada no caixa.`
          : `"${p.description}" marcada como paga.`,
      )
      setPayingPayable(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao marcar como paga')
    }
  }

  const openAttachment = async (storagePath: string) => {
    try {
      const url = await getAttachmentSignedUrl(storagePath)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir anexo')
    }
  }

  const toggleInvoice = async (invoiceId: string) => {
    if (openInvoiceId === invoiceId) {
      setOpenInvoiceId(null)
      return
    }
    setOpenInvoiceId(invoiceId)
    if (invoiceMovements[invoiceId]) return
    setLoadingInvoiceId(invoiceId)
    try {
      const rows = await listInvoiceMovements(invoiceId)
      setInvoiceMovements((prev) => ({ ...prev, [invoiceId]: rows }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar o histórico da nota')
      setOpenInvoiceId(null)
    } finally {
      setLoadingInvoiceId(null)
    }
  }

  return (
    <AppLayout
      title="Contas a pagar"
      subtitle="Notas fiscais de compra, boletos e a agenda de vencimentos com projeção por mês."
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Vencidas', value: kpis.overdueCents, alert: kpis.overdueCents > 0 },
          { label: 'Vencem em 7 dias', value: kpis.next7Cents, alert: false },
          { label: 'Em aberto no mês', value: kpis.openMonthCents, alert: false },
          { label: 'Pago no mês', value: kpis.paidMonthCents, alert: false },
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
        <div className="space-y-4">
          <Card className="border-primary/40 bg-primary/[0.03]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileCode className="size-4 text-primary" /> Importar NF-e (XML)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Suba o XML da nota: preenche fornecedor, itens (com lote/validade), dá entrada no estoque e cria as parcelas, tudo de uma vez, com confirmação.
              </p>
              <Input
                ref={nfeFileRef}
                type="file"
                accept=".xml,text/xml,application/xml"
                aria-label="Arquivo XML da NF-e"
                onChange={(e) => void handleNfeFile(e.target.files?.[0] ?? null)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Receipt className="size-4 text-primary" /> Registrar NF de compra
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nf-number">Número</Label>
                  <Input
                    id="nf-number"
                    value={nfForm.number}
                    onChange={(e) => setNfForm((f) => ({ ...f, number: e.target.value }))}
                    placeholder="Ex.: 12345"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nf-date">Emissão</Label>
                  <Input
                    id="nf-date"
                    type="date"
                    value={nfForm.issueDate}
                    onChange={(e) => setNfForm((f) => ({ ...f, issueDate: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nf-supplier">Fornecedor</Label>
                  <Select value={nfForm.supplierId} onValueChange={(v) => setNfForm((f) => ({ ...f, supplierId: v ?? '' }))}>
                    <SelectTrigger id="nf-supplier">
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
                <div className="space-y-1.5">
                  <Label htmlFor="nf-total">Valor total (R$)</Label>
                  <Input
                    id="nf-total"
                    value={nfForm.total}
                    onChange={(e) => setNfForm((f) => ({ ...f, total: e.target.value }))}
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nf-file">Anexo (PDF/XML)</Label>
                <Input
                  id="nf-file"
                  ref={nfFileRef}
                  type="file"
                  accept=".pdf,.xml,image/*"
                  onChange={(e) => setNfFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button className="w-full" onClick={handleCreateNf} disabled={savingNf}>
                {savingNf ? 'Registrando…' : 'Registrar nota'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Plus className="size-4 text-primary" /> Programar pagamento / boleto
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pg-desc">Descrição</Label>
                <Input
                  id="pg-desc"
                  value={payForm.description}
                  onChange={(e) => setPayForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Ex.: Boleto fornecedor X"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pg-supplier">Fornecedor</Label>
                  <Select value={payForm.supplierId} onValueChange={(v) => setPayForm((f) => ({ ...f, supplierId: v ?? '' }))}>
                    <SelectTrigger id="pg-supplier">
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
                <div className="space-y-1.5">
                  <Label htmlFor="pg-invoice">NF vinculada</Label>
                  <Select value={payForm.invoiceId} onValueChange={(v) => setPayForm((f) => ({ ...f, invoiceId: v ?? '' }))}>
                    <SelectTrigger id="pg-invoice">
                      <SelectValue placeholder="Opcional" />
                    </SelectTrigger>
                    <SelectContent>
                      {invoices.map((inv) => (
                        <SelectItem key={inv.id} value={inv.id}>
                          NF {inv.number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pg-amount">Valor parcela</Label>
                  <Input
                    id="pg-amount"
                    value={payForm.amount}
                    onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pg-due">1º vencimento</Label>
                  <Input
                    id="pg-due"
                    type="date"
                    value={payForm.firstDue}
                    onChange={(e) => setPayForm((f) => ({ ...f, firstDue: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pg-inst">Parcelas</Label>
                  <Input
                    id="pg-inst"
                    value={payForm.installments}
                    onChange={(e) => setPayForm((f) => ({ ...f, installments: e.target.value }))}
                    inputMode="numeric"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pg-category">Categoria</Label>
                  <Select value={payForm.categoryId} onValueChange={(v) => setPayForm((f) => ({ ...f, categoryId: v ?? '' }))}>
                    <SelectTrigger id="pg-category">
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
                  <Label htmlFor="pg-account">Conta (débito)</Label>
                  <Select value={payForm.accountId} onValueChange={(v) => setPayForm((f) => ({ ...f, accountId: v ?? '' }))}>
                    <SelectTrigger id="pg-account">
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
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pg-method">Forma</Label>
                  <Select value={payForm.method} onValueChange={(v) => setPayForm((f) => ({ ...f, method: v ?? 'boleto' }))}>
                    <SelectTrigger id="pg-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['boleto', 'pix', 'cartao', 'transferencia', 'dinheiro'].map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pg-bar">Linha digitável</Label>
                  <Input
                    id="pg-bar"
                    value={payForm.barcode}
                    onChange={(e) => setPayForm((f) => ({ ...f, barcode: e.target.value }))}
                    placeholder="Opcional"
                  />
                </div>
              </div>
              <Button className="w-full" onClick={handleCreatePayable} disabled={savingPayable}>
                {savingPayable ? 'Programando…' : 'Programar pagamento'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="size-4 text-primary" /> Notas registradas ({invoices.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {invoices.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma NF de compra registrada.</p>
              ) : (
                invoices.map((inv) => {
                  const expanded = openInvoiceId === inv.id
                  const movements = invoiceMovements[inv.id] ?? []
                  const linked = payables.filter((p) => p.invoiceId === inv.id)
                  return (
                    <div key={inv.id} className="rounded-md border border-border">
                      <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <button
                          type="button"
                          onClick={() => void toggleInvoice(inv.id)}
                          aria-expanded={expanded}
                          aria-label={`Histórico da NF ${inv.number}`}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <ChevronDown
                            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <div className="font-medium">NF {inv.number}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {inv.supplierName ?? 'Sem fornecedor'}
                              {inv.issueDate ? ` · ${formatDay(inv.issueDate)}` : ''}
                            </div>
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-2">
                          {linked.length === 0 ? (
                            <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
                              sem parcela
                            </Badge>
                          ) : null}
                          <span className="font-semibold">{formatBRL(inv.totalCents)}</span>
                          {inv.storagePath ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => void openAttachment(inv.storagePath!)}
                              aria-label={`Abrir anexo da NF ${inv.number}`}
                            >
                              <Paperclip className="size-3.5" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {expanded ? (
                        <div className="border-t border-border px-3 py-2 text-xs">
                          {loadingInvoiceId === inv.id ? (
                            <p className="text-muted-foreground">Carregando…</p>
                          ) : movements.length === 0 ? (
                            <p className="text-muted-foreground">Nenhuma entrada de estoque vinculada a esta nota.</p>
                          ) : (
                            <ul className="space-y-1">
                              {movements.map((m) => (
                                <li key={m.id} className="flex items-center justify-between gap-2">
                                  <span className="min-w-0 truncate">{m.itemName}</span>
                                  <span className="shrink-0 text-muted-foreground">
                                    {m.qtyDelta} {m.unit}
                                    {m.unitCostCents != null ? ` · ${formatBRL(m.unitCostCents)}/un` : ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="mt-2 border-t border-border pt-2 text-muted-foreground">
                            {linked.length === 0
                              ? 'Sem conta a pagar vinculada — esta compra não está no financeiro.'
                              : `${linked.length} ${linked.length === 1 ? 'parcela' : 'parcelas'} em contas a pagar.`}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClock className="size-4 text-primary" /> Agenda de pagamentos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {agenda.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title={loading ? 'Carregando…' : 'Nada em aberto'}
                description="Programe boletos e parcelas ao lado, a projeção por mês aparece aqui."
              />
            ) : (
              agenda.map(([key, rows]) => {
                const total = rows.reduce((s, p) => s + p.amountCents, 0)
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
                      {rows.map((p) => (
                        <div
                          key={p.id}
                          className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                            isOverdue ? 'border-red-500/40 bg-red-500/5' : 'border-border'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{p.description}</div>
                            <div className="text-xs text-muted-foreground">
                              vence {formatDay(p.dueDate)}
                              {p.supplierName ? ` · ${p.supplierName}` : ''}
                              {p.paymentMethod ? ` · ${p.paymentMethod}` : ''}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="font-semibold">{formatBRL(p.amountCents)}</span>
                            <Button size="sm" variant="outline" onClick={() => openPayDialog(p)}>
                              <Check className="size-3.5" /> Pago
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
            )}

            {payables.some((p) => p.status === 'pago') ? (
              <div>
                <h3 className="mb-1.5 text-sm font-semibold text-muted-foreground">Pagas recentemente</h3>
                <div className="space-y-1.5">
                  {payables
                    .filter((p) => p.status === 'pago')
                    .slice(-8)
                    .reverse()
                    .map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm opacity-70">
                        <div className="min-w-0">
                          <div className="truncate">{p.description}</div>
                          <div className="text-xs text-muted-foreground">venceu {formatDay(p.dueDate)}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span>{formatBRL(p.amountCents)}</span>
                          <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600">
                            pago
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

      <Dialog open={nfe != null} onOpenChange={(open) => (!open ? setNfe(null) : null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar NF-e {nfe?.number}</DialogTitle>
            <DialogDescription>
              {nfe?.supplierName ?? 'Fornecedor não identificado'}
              {nfe?.issueDate ? ` · emitida ${formatDay(nfe.issueDate)}` : ''} · total {formatBRL(nfe?.totalCents ?? 0)}
            </DialogDescription>
          </DialogHeader>

          {nfe ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="mb-1 font-semibold">Fornecedor</p>
                {existingSupplierMatch ? (
                  <p className="text-muted-foreground">
                    Já cadastrado: <span className="font-medium text-foreground">{existingSupplierMatch.name}</span>, a NF será vinculada a ele.
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="nfe-create-supplier"
                      checked={nfeCreateSupplier}
                      onCheckedChange={(checked) => setNfeCreateSupplier(checked)}
                    />
                    <Label htmlFor="nfe-create-supplier" className="font-normal text-muted-foreground">
                      Cadastrar fornecedor “{nfe.supplierName ?? 'sem nome'}”{nfe.supplierCnpj ? ` (CNPJ ${nfe.supplierCnpj})` : ''}
                    </Label>
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">Itens ({nfe.items.length}) → estoque</p>
                <div className="space-y-1.5">
                  {nfe.items.map((item, index) => {
                    const plan = nfePlan[index]
                    const matchedItem =
                      plan?.action === 'existente' && plan.matchedItemId
                        ? stockItems.find((s) => s.id === plan.matchedItemId) ?? null
                        : null
                    const matchLabel =
                      plan?.matchedBy === 'ean'
                        ? 'casou por código de barras'
                        : plan?.matchedBy === 'sku'
                          ? 'casou por SKU'
                          : plan?.matchedBy === 'nome'
                            ? 'casou por nome'
                            : plan?.matchedBy === 'alias'
                              ? 'casou por alias (NF)'
                              : null
                    return (
                      <div key={index} className="rounded-md border border-border p-2.5 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium">{item.description}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.qty} {item.unit} · {formatBRL(item.unitCostCents)}/un
                              {item.ean ? ` · EAN ${item.ean}` : ''}
                              {item.supplierCode ? ` · cód. ${item.supplierCode}` : ''}
                              {item.lotCode ? ` · lote ${item.lotCode}` : ''}
                              {item.expiresOn ? ` · val. ${formatDay(item.expiresOn)}` : ''}
                            </div>
                            {matchedItem ? (
                              <div className="mt-0.5 text-xs text-emerald-600">
                                ↳ dá entrada em: {matchedItem.name}
                                {matchedItem.sku ? ` (SKU ${matchedItem.sku})` : ''}
                                {matchLabel ? ` · ${matchLabel}` : ' · manual'}
                              </div>
                            ) : null}
                          </div>
                          <Select
                            value={plan?.action === 'existente' ? (plan.matchedItemId ?? 'novo') : (plan?.action ?? 'novo')}
                            onValueChange={(v) =>
                              setNfePlan((prev) =>
                                prev.map((p, j) =>
                                  j === index
                                    ? v === 'novo'
                                      ? { index, action: 'novo', matchedItemId: null, matchedBy: null }
                                      : v === 'ignorar'
                                        ? { index, action: 'ignorar', matchedItemId: null, matchedBy: null }
                                        : { index, action: 'existente', matchedItemId: v, matchedBy: null }
                                    : p,
                                ),
                              )
                            }
                          >
                            <SelectTrigger
                              className="h-8 w-[180px] shrink-0"
                              aria-label={`Destino do item ${item.description}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="novo">Criar item novo</SelectItem>
                              <SelectItem value="ignorar">Ignorar</SelectItem>
                              {stockItems.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  ↳ {s.name}
                                  {s.sku ? ` · SKU ${s.sku}` : s.barcode ? ` · ${s.barcode}` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {nfe.installments.length > 0 ? (
                <div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="nfe-create-payables"
                      checked={nfeCreatePayables}
                      onCheckedChange={(checked) => setNfeCreatePayables(checked)}
                    />
                    <Label htmlFor="nfe-create-payables" className="font-semibold">
                      Criar {nfe.installments.length} {nfe.installments.length === 1 ? 'parcela' : 'parcelas'} em contas a pagar
                    </Label>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {nfe.installments.map((inst) => (
                      <span key={inst.number} className="rounded-md bg-muted px-2 py-1 text-xs">
                        {formatDay(inst.dueDate)} · {formatBRL(inst.amountCents)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="nfe-create-payables"
                      checked={nfeCreatePayables}
                      onCheckedChange={(checked) => setNfeCreatePayables(checked)}
                      disabled={nfe.totalCents <= 0}
                    />
                    <Label htmlFor="nfe-create-payables" className="font-semibold">
                      Criar 1 parcela de {formatBRL(nfe.totalCents)} em contas a pagar
                    </Label>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    A nota não traz duplicatas (compra à vista). Sem essa parcela o gasto entra só no
                    estoque e não aparece no financeiro.
                  </p>
                  {nfeCreatePayables ? (
                    <div className="mt-2 flex items-center gap-2">
                      <Label htmlFor="nfe-single-due" className="text-xs font-normal text-muted-foreground">
                        Vencimento
                      </Label>
                      <Input
                        id="nfe-single-due"
                        type="date"
                        className="h-8 w-[160px]"
                        value={nfeSingleDue}
                        onChange={(e) => setNfeSingleDue(e.target.value)}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setNfe(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmImport} disabled={importing}>
              {importing ? 'Importando…' : 'Confirmar importação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payingPayable != null} onOpenChange={(open) => (!open ? setPayingPayable(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar como paga</DialogTitle>
            <DialogDescription>
              {payingPayable?.description} · {formatBRL(payingPayable?.amountCents ?? 0)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-account">Conta que pagou</Label>
              <Select value={payAccountId} onValueChange={(v) => setPayAccountId(v ?? '')}>
                <SelectTrigger id="pay-account">
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
                Com uma conta, a saída entra no fluxo de caixa. Sem conta, só marca como paga.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">Data do pagamento</Label>
              <Input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayingPayable(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmPay}>Confirmar pagamento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
