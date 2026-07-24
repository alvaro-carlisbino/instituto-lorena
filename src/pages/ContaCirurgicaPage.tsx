import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FilePlus2, Plus, Printer, Trash2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PatientSearchField, type PatientPick } from '@/components/PatientSearchField'
import { estoqueTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import {
  SURGERY_LINE_KINDS,
  type SurgeryAccount,
  type SurgeryLineKind,
  addSurgeryLine,
  createSurgeryAccount,
  listSurgeryAccounts,
  printSurgeryAccountPdf,
  setSurgeryAccountStatus,
  surgeryAccountTotals,
} from '@/services/contaCirurgica'

type DraftLine = {
  kind: SurgeryLineKind
  description: string
  qty: string
  unit: string
  stockItemId: string
}

const EMPTY: DraftLine = { kind: 'mat_med', description: '', qty: '1', unit: '', stockItemId: '' }

const formatBRL = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function ContaCirurgicaPage() {
  const { tenant } = useTenant()
  const [accounts, setAccounts] = useState<SurgeryAccount[]>([])
  const [items, setItems] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<PatientPick | null>(null)
  const [procedure, setProcedure] = useState('')
  const [date, setDate] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY }])
  const [saving, setSaving] = useState(false)

  const itemName = useMemo(() => new Map(items.map((i) => [i.id, i.name] as const)), [items])

  const load = async () => {
    setLoading(true)
    try {
      const [acc, it] = await Promise.all([listSurgeryAccounts(), listStockItems()])
      setAccounts(acc)
      setItems(it)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar contas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const create = async () => {
    if (!picked) {
      toast.error('Selecione o paciente.')
      return
    }
    const payloadLines = lines
      .map((l) => {
        const abs = Math.round((Number(l.unit.replace(',', '.')) || 0) * 100)
        const signed = l.kind === 'desconto' || l.kind === 'pagamento' ? -Math.abs(abs) : abs
        return {
          kind: l.kind,
          description: l.description.trim() || (l.stockItemId ? itemName.get(l.stockItemId) ?? '' : ''),
          qty: Number(l.qty.replace(',', '.')) || 1,
          unitCents: signed,
          stockItemId: l.stockItemId || null,
        }
      })
      .filter((l) => l.description)
    setSaving(true)
    try {
      await createSurgeryAccount({
        leadId: picked.id,
        patientName: picked.name,
        procedureLabel: procedure,
        surgeryDate: date || null,
        lines: payloadLines,
      })
      toast.success('Conta do centro cirúrgico criada.')
      setPicked(null)
      setProcedure('')
      setDate('')
      setLines([{ ...EMPTY }])
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar conta')
    } finally {
      setSaving(false)
    }
  }

  const quickAdd = async (account: SurgeryAccount, kind: SurgeryLineKind) => {
    const desc =
      kind === 'hora_sala'
        ? 'Hora sala'
        : kind === 'anestesia'
          ? 'Anestesia'
          : kind === 'consumo'
            ? 'Material de consumo'
            : 'Acréscimo'
    const unit = window.prompt(`Valor unitário (R$) para ${desc}:`, '0')
    if (unit == null) return
    const cents = Math.round((Number(unit.replace(',', '.')) || 0) * 100)
    try {
      await addSurgeryLine(account.id, {
        kind,
        description: desc,
        qty: 1,
        unitCents: kind === 'desconto' || kind === 'pagamento' ? -Math.abs(cents) : cents,
      })
      toast.success('Linha adicionada.')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao adicionar')
    }
  }

  return (
    <AppLayout
      title="Conta do centro cirúrgico"
      subtitle="Mat/Med, hora sala, anestesia, consumo, acréscimos e pagamentos — imprima a conta do paciente."
    >
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,440px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FilePlus2 className="size-4 text-primary" /> Nova conta
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Paciente</Label>
              <PatientSearchField
                picked={picked}
                onPick={setPicked}
                onClear={() => setPicked(null)}
                size="lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Procedimento</Label>
                <Input value={procedure} onChange={(e) => setProcedure(e.target.value)} placeholder="Ex.: FUE" />
              </div>
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Itens da conta</Label>
              {lines.map((line, i) => (
                <div key={i} className="space-y-1.5 rounded-md border border-border p-2.5">
                  <Select
                    value={line.kind}
                    onValueChange={(v) =>
                      setLines((prev) => prev.map((r, j) => (j === i ? { ...r, kind: (v as SurgeryLineKind) ?? 'outro' } : r)))
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SURGERY_LINE_KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={line.stockItemId || 'livre'}
                    onValueChange={(v) => {
                      const id = !v || v === 'livre' ? '' : v
                      const name = id ? itemName.get(id) ?? '' : ''
                      setLines((prev) =>
                        prev.map((r, j) =>
                          j === i ? { ...r, stockItemId: id, description: r.description || name } : r,
                        ),
                      )
                    }}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Item de estoque (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="livre">Sem vínculo de estoque</SelectItem>
                      {items.map((it) => (
                        <SelectItem key={it.id} value={it.id}>
                          {it.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="h-8"
                    value={line.description}
                    onChange={(e) => setLines((prev) => prev.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))}
                    placeholder="Descrição"
                  />
                  <div className="flex gap-2">
                    <Input
                      className="h-8"
                      value={line.qty}
                      onChange={(e) => setLines((prev) => prev.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)))}
                      placeholder="Qtd"
                      inputMode="decimal"
                    />
                    <Input
                      className="h-8"
                      value={line.unit}
                      onChange={(e) => setLines((prev) => prev.map((r, j) => (j === i ? { ...r, unit: e.target.value } : r)))}
                      placeholder="R$ unit."
                      inputMode="decimal"
                    />
                    {lines.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setLines((p) => [...p, { ...EMPTY }])}>
                <Plus className="size-3.5" /> Linha
              </Button>
            </div>
            <Button className="w-full" onClick={() => void create()} disabled={saving}>
              {saving ? 'Salvando…' : 'Abrir conta'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Contas ({accounts.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {accounts.length === 0 ? (
              <EmptyState
                icon={FilePlus2}
                title={loading ? 'Carregando…' : 'Nenhuma conta'}
                description="Abra a conta do paciente com Mat/Med, sala, anestesia e consumo."
              />
            ) : (
              accounts.map((acc) => {
                const t = surgeryAccountTotals(acc)
                return (
                  <div key={acc.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold">{acc.patientName}</div>
                        <div className="text-xs text-muted-foreground">
                          {[acc.procedureLabel, acc.surgeryDate].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          acc.status === 'fechada'
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : acc.status === 'cancelada'
                              ? 'bg-red-500/15 text-red-600'
                              : 'bg-sky-500/15 text-sky-600'
                        }
                      >
                        {acc.status}
                      </Badge>
                    </div>
                    <ul className="mt-2 space-y-0.5 text-sm">
                      {acc.lines.map((l) => (
                        <li key={l.id} className="flex justify-between gap-2">
                          <span className="min-w-0 truncate">
                            <span className="text-xs text-muted-foreground">{l.kind}</span> · {l.qty}× {l.description}
                          </span>
                          <span className="shrink-0">{formatBRL(Math.round(l.qty * l.unitCents))}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 text-sm">
                      Cobranças {formatBRL(t.chargesCents)} · Pagos {formatBRL(t.paymentsCents)} ·{' '}
                      <strong>Saldo {formatBRL(t.balanceCents)}</strong>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => printSurgeryAccountPdf(acc, { itemNames: itemName })}>
                        <Printer className="size-3.5" /> PDF / imprimir
                      </Button>
                      {acc.status === 'aberta' ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => void quickAdd(acc, 'hora_sala')}>
                            + Hora sala
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void quickAdd(acc, 'anestesia')}>
                            + Anestesia
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void quickAdd(acc, 'consumo')}>
                            + Consumo
                          </Button>
                          <Button size="sm" onClick={() => void setSurgeryAccountStatus(acc.id, 'fechada').then(load)}>
                            Fechar
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
