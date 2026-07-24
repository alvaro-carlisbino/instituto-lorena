import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileSpreadsheet, Plus, RefreshCw, Search, Upload } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import type { Payable } from '@/services/estoqueCompras'
import {
  DEFAULT_COST_CENTERS,
  createGastoManual,
  importGastosRows,
  listGastos,
  parseGastosSpreadsheet,
  totalsByCostCenter,
} from '@/services/gastosControle'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDay(iso: string): string {
  if (!iso) return '—'
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const EMPTY_FORM = {
  date: new Date().toISOString().slice(0, 10),
  counterparty: '',
  paymentMethod: 'PIX - Pagamentos Instantâneos',
  costCenter: 'Administrativo',
  subcategory: '',
  amount: '',
  markPaid: true,
}

export function GastosControlePage() {
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'
  const [month, setMonth] = useState(currentMonth())
  const [costCenter, setCostCenter] = useState<string>('all')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Payable[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [openForm, setOpenForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await listGastos({
        month,
        costCenter: costCenter === 'all' ? undefined : costCenter,
        q: q.trim() || undefined,
      })
      setRows(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar gastos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, costCenter])

  const totals = useMemo(() => totalsByCostCenter(rows), [rows])
  const totalCents = useMemo(() => rows.reduce((s, r) => s + r.amountCents, 0), [rows])
  const costCenterOptions = useMemo(() => {
    const set = new Set<string>([...DEFAULT_COST_CENTERS])
    for (const r of rows) if (r.costCenter) set.add(r.costCenter)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [rows])

  const handleImport = async (file: File | null) => {
    if (!file) return
    setImporting(true)
    try {
      const parsed = await parseGastosSpreadsheet(file)
      if (parsed.length === 0) {
        toast.error('Nenhuma linha válida encontrada na planilha.')
        return
      }
      const { inserted, skipped } = await importGastosRows(parsed, { markPaid: true })
      toast.success(`Importados ${inserted} gasto(s)${skipped ? ` · ${skipped} já existiam` : ''}.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao importar planilha')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleSave = async () => {
    const amountCents = Math.round(
      (Number(String(form.amount).replace(/\./g, '').replace(',', '.')) || 0) * 100,
    )
    if (!form.date || !form.counterparty.trim() || !form.costCenter.trim() || amountCents <= 0) {
      toast.error('Preencha data, razão social, centro de custo e valor.')
      return
    }
    setSaving(true)
    try {
      await createGastoManual({
        date: form.date,
        counterparty: form.counterparty,
        paymentMethod: form.paymentMethod,
        costCenter: form.costCenter,
        subcategory: form.subcategory,
        amountCents,
        markPaid: form.markPaid,
      })
      toast.success('Gasto lançado.')
      setOpenForm(false)
      setForm({ ...EMPTY_FORM })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppLayout>
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Gastos e controle</h1>
            <p className="text-sm text-muted-foreground">
              Espelho da planilha: data, razão social, forma, centro de custo, subcategoria e valor.
            </p>
          </div>
          <SubTabs items={financeiroTabs(isSalesPolo)} />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label>Mês</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-[160px]" />
          </div>
          <div className="space-y-1">
            <Label>Centro de custo</Label>
            <Select value={costCenter} onValueChange={(v) => setCostCenter(v ?? 'all')}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {costCenterOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void load()}
              placeholder="Buscar razão social, NF, subcategoria…"
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Atualizar
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => void handleImport(e.target.files?.[0] ?? null)}
          />
          <Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> {importing ? 'Importando…' : 'Importar planilha'}
          </Button>
          <Button onClick={() => setOpenForm(true)}>
            <Plus size={14} /> Novo gasto
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2">
                  <FileSpreadsheet size={16} /> Lançamentos
                </span>
                <span className="text-sm font-normal text-muted-foreground">
                  {rows.length} · {formatBRL(totalCents)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
              ) : rows.length === 0 ? (
                <EmptyState
                  title="Nenhum gasto neste filtro"
                  description="Importe a planilha de maio ou lance um gasto manualmente."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Data</th>
                        <th className="px-3 py-2 text-left">Razão social</th>
                        <th className="px-3 py-2 text-left">Forma</th>
                        <th className="px-3 py-2 text-left">C. custo</th>
                        <th className="px-3 py-2 text-left">Subcategoria</th>
                        <th className="px-3 py-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
                          <td className="px-3 py-2 whitespace-nowrap">{formatDay(r.dueDate)}</td>
                          <td className="px-3 py-2 max-w-[240px] truncate" title={r.counterparty ?? r.supplierName ?? r.description}>
                            {r.counterparty || r.supplierName || r.description}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground max-w-[140px] truncate">
                            {r.paymentMethod ?? '—'}
                          </td>
                          <td className="px-3 py-2">{r.costCenter ?? '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground max-w-[180px] truncate">
                            {r.subcategory || '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{formatBRL(r.amountCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Total por centro de custo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {totals.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem dados.</p>
              ) : (
                totals.map((t) => (
                  <div key={t.costCenter} className="flex items-baseline justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{t.costCenter}</div>
                      <div className="text-xs text-muted-foreground">{t.count} lanç.</div>
                    </div>
                    <div className="tabular-nums font-semibold whitespace-nowrap">{formatBRL(t.cents)}</div>
                  </div>
                ))
              )}
              <div className="border-t pt-2 flex justify-between text-sm font-semibold">
                <span>Total saídas</span>
                <span className="tabular-nums">{formatBRL(totalCents)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo gasto</DialogTitle>
            <DialogDescription>Mesmos campos da planilha de controle.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Data</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Razão social</Label>
              <Input
                value={form.counterparty}
                onChange={(e) => setForm((f) => ({ ...f, counterparty: e.target.value }))}
                placeholder="Favorecido / fornecedor"
              />
            </div>
            <div className="space-y-1">
              <Label>Forma de pagamento</Label>
              <Input
                value={form.paymentMethod}
                onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                list="formas-gasto"
              />
              <datalist id="formas-gasto">
                <option value="PIX - Pagamentos Instantâneos" />
                <option value="Boletos de cobrança" />
                <option value="Crédito em conta" />
                <option value="Dinheiro" />
                <option value="Concessionárias" />
                <option value="DARF - Documento de Arrec. de" />
                <option value="Tributos municipais" />
              </datalist>
            </div>
            <div className="space-y-1">
              <Label>Centro de custo</Label>
              <Input
                value={form.costCenter}
                onChange={(e) => setForm((f) => ({ ...f, costCenter: e.target.value }))}
                list="centros-gasto"
              />
              <datalist id="centros-gasto">
                {DEFAULT_COST_CENTERS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label>Subcategoria</Label>
              <Input
                value={form.subcategory}
                onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))}
                placeholder="NF, VT, diarista…"
              />
            </div>
            <div className="space-y-1">
              <Label>Valor (R$)</Label>
              <Input
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0,00"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.markPaid}
                onChange={(e) => setForm((f) => ({ ...f, markPaid: e.target.checked }))}
              />
              Já pago (marca como quitado na data)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>Cancelar</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}

export default GastosControlePage
