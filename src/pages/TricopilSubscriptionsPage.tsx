import { Fragment, useEffect, useMemo, useState } from 'react'
import { Repeat } from 'lucide-react'
import { toast } from 'sonner'

import { AppLayout } from '@/layouts/AppLayout'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatCard } from '@/components/page/StatCard'
import { fetchTricopillSubscriptions, subscriptionAction, subscriptionHistory, type AsaasCharge, type SubscriptionAction, type TricopillSubscription } from '@/services/tricopillSubscriptions'

const brlNum = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const CHARGE_STATUS: Record<string, string> = { RECEIVED: 'Pago', CONFIRMED: 'Pago', PENDING: 'Pendente', OVERDUE: 'Vencido', REFUNDED: 'Estornado', CANCELED: 'Cancelado' }
const STATUS_FILTERS = [
  { v: 'all', label: 'Todas' }, { v: 'active', label: 'Ativas' }, { v: 'paused', label: 'Pausadas' }, { v: 'canceled', label: 'Canceladas' },
] as const

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const CADENCE_LABEL: Record<string, string> = { mensal: 'Mensal', bimestral: 'Bimestral', trimestral: 'Trimestral' }
const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  overdue: 'bg-amber-100 text-amber-800',
  canceled: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  paused: 'bg-sky-100 text-sky-800',
}

// Próximo ciclo que ENVIA produto (mensal envia todo ciclo; trimestral a cada 3).
function nextShipCycle(s: TricopillSubscription): number {
  if (s.cadence === 'trimestral') return (s.lastShippedCycle || 0) + 3
  return (s.paidCycles || 0) + 1
}

export function TricopilSubscriptionsPage() {
  const [rows, setRows] = useState<TricopillSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [history, setHistory] = useState<Record<string, AsaasCharge[]>>({})
  const [historyLoading, setHistoryLoading] = useState<string | null>(null)
  // Assinatura aguardando confirmação de cancelamento (via ConfirmDialog).
  const [cancelTarget, setCancelTarget] = useState<TricopillSubscription | null>(null)

  async function toggleHistory(s: TricopillSubscription) {
    if (expanded === s.id) { setExpanded(null); return }
    setExpanded(s.id)
    if (!history[s.id]) {
      setHistoryLoading(s.id)
      try { const h = await subscriptionHistory(s.id); setHistory((prev) => ({ ...prev, [s.id]: h })) }
      catch (e) { toast.error(e instanceof Error ? e.message : 'Falha ao carregar cobranças.') }
      finally { setHistoryLoading(null) }
    }
  }

  // O cancelamento passa antes pelo ConfirmDialog (setCancelTarget); as demais ações são diretas.
  async function doAction(s: TricopillSubscription, action: SubscriptionAction) {
    const key = `${s.id}:${action}`
    setBusy(key)
    try {
      const r = await subscriptionAction(s.id, action)
      if (r.ok) { toast.success(r.message || 'Feito.'); setReload((k) => k + 1) }
      else toast.error(r.message || 'Falha na ação.')
    } finally { setBusy(null) }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetchTricopillSubscriptions()
      .then((r) => { if (!cancelled) setRows(r) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reload])

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status === 'active')
    const mrr = active.reduce((s, r) => s + r.monthlyValueCents, 0)
    return { total: rows.length, active: active.length, mrr }
  }, [rows])

  const filtered = useMemo(
    () => (statusFilter === 'all' ? rows : rows.filter((r) => (statusFilter === 'canceled' ? r.status === 'canceled' || r.status === 'cancelled' : r.status === statusFilter))),
    [rows, statusFilter],
  )

  return (
    <AppLayout title="Assinaturas (Clube)" subtitle="Assinantes do Tricopill: plano, status, ciclos pagos e envios. Cobrança, Bling, Melhor Envio e rastreio são automáticos.">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Assinaturas ativas" value={stats.active} />
        <StatCard label="Receita recorrente (MRR)" value={brl(stats.mrr)} valueClassName="text-emerald-700" />
        <StatCard label="Total cadastradas" value={stats.total} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button key={f.v} variant={statusFilter === f.v ? 'default' : 'outline'} size="sm" className="h-7 px-2.5 text-xs" onClick={() => setStatusFilter(f.v)}>{f.label}</Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">{loading ? 'Carregando…' : `${filtered.length} assinatura(s)`}</p>
          <Button variant="outline" size="sm" onClick={() => setReload((k) => k + 1)} disabled={loading}>Atualizar</Button>
        </div>
      </div>

      {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">{error}</p> : null}

      {loading && rows.length === 0 ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <div className="rounded-md border border-border bg-muted/20">
          <EmptyState icon={Repeat} title="Nenhuma assinatura ainda" description="Quando um cliente entrar no clube, a assinatura aparece aqui." />
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="rounded-md border border-border">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead>Cliente</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Valor/mês</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ciclos pagos</TableHead>
                <TableHead>Último envio</TableHead>
                <TableHead>Entrega</TableHead>
                <TableHead>Asaas</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => {
                const ent = s.entrega ?? {}
                const cidade = [String(ent.cidade ?? ''), String(ent.uf ?? '')].filter(Boolean).join('/')
                const charges = history[s.id]
                return (
                  <Fragment key={s.id}>
                  <TableRow className="hover:bg-muted/20">
                    <TableCell>
                      <p className="font-medium text-foreground">{s.customerName || '—'}</p>
                      <p className="text-xs text-muted-foreground">{s.phone || ''}{s.email ? ` · ${s.email}` : ''}</p>
                    </TableCell>
                    <TableCell>
                      <p>{CADENCE_LABEL[s.cadence] ?? s.cadence}</p>
                      <p className="text-xs text-muted-foreground">{s.unitsPerShipment}× frasco{s.unitsPerShipment > 1 ? 's' : ''} · {brl(s.unitPriceCents)}/un</p>
                    </TableCell>
                    <TableCell className="font-medium">{brl(s.monthlyValueCents)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status] ?? 'bg-muted text-muted-foreground'}`}>{s.status}</span>
                    </TableCell>
                    <TableCell>
                      {s.paidCycles}{s.minCycles ? <span className="text-xs text-muted-foreground"> / mín. {s.minCycles}</span> : null}
                    </TableCell>
                    <TableCell>
                      <p>ciclo {s.lastShippedCycle || '—'}</p>
                      {s.status === 'active' ? <p className="text-xs text-muted-foreground">próx.: ciclo {nextShipCycle(s)}</p> : null}
                    </TableCell>
                    <TableCell className="text-xs">{cidade || '—'}</TableCell>
                    <TableCell>
                      {s.asaasSubscriptionId ? (
                        <a className="text-xs text-sky-700 underline" href={`https://www.asaas.com/subscriptions/show/${s.asaasSubscriptionId}`} target="_blank" rel="noreferrer" aria-label={`Abrir assinatura de ${s.customerName || 'cliente'} no Asaas (nova aba)`}>abrir</a>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => void toggleHistory(s)}>{expanded === s.id ? 'Fechar' : 'Cobranças'}</Button>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!!busy && busy.startsWith(s.id)} onClick={() => void doAction(s, 'resend_tracking')}>Rastreio</Button>
                        {s.status === 'active' ? (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!!busy && busy.startsWith(s.id)} onClick={() => void doAction(s, 'pause')}>Pausar</Button>
                        ) : s.status === 'paused' ? (
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!!busy && busy.startsWith(s.id)} onClick={() => void doAction(s, 'resume')}>Reativar</Button>
                        ) : null}
                        {s.status !== 'canceled' && s.status !== 'cancelled' ? (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" disabled={!!busy && busy.startsWith(s.id)} onClick={() => setCancelTarget(s)}>Cancelar</Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded === s.id ? (
                    <TableRow className="bg-muted/10 hover:bg-muted/10">
                      <TableCell colSpan={9} className="px-3 py-3">
                        {historyLoading === s.id ? (
                          <p className="text-xs text-muted-foreground">Carregando cobranças…</p>
                        ) : !charges || charges.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Sem cobranças no Asaas.</p>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-foreground">Cobranças (Asaas)</p>
                            {charges.map((c) => (
                              <div key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-medium">{brlNum(c.value)}</span>
                                <span className={c.status === 'RECEIVED' || c.status === 'CONFIRMED' ? 'font-medium text-emerald-700' : 'text-muted-foreground'}>{CHARGE_STATUS[c.status] ?? c.status}</span>
                                <span className="text-muted-foreground">venc {c.dueDate}{c.paymentDate ? ` · pago ${c.paymentDate}` : ''}</span>
                                {c.receiptUrl ? <a className="text-sky-700 underline" href={c.receiptUrl} target="_blank" rel="noreferrer">recibo</a>
                                  : c.invoiceUrl ? <a className="text-sky-700 underline" href={c.invoiceUrl} target="_blank" rel="noreferrer">fatura</a> : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <ConfirmDialog
        open={cancelTarget != null}
        onOpenChange={(open) => { if (!open) setCancelTarget(null) }}
        title="Cancelar assinatura"
        description={`Cancelar a assinatura de ${cancelTarget?.customerName || 'cliente'}? Isso interrompe as cobranças no Asaas.`}
        confirmLabel="Cancelar assinatura"
        cancelLabel="Voltar"
        variant="destructive"
        onConfirm={() => {
          if (cancelTarget) {
            void doAction(cancelTarget, 'cancel')
            setCancelTarget(null)
          }
        }}
      />
    </AppLayout>
  )
}
