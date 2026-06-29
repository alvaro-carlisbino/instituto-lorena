import { useEffect, useMemo, useState } from 'react'

import { AppLayout } from '@/layouts/AppLayout'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { fetchTricopillSubscriptions, type TricopillSubscription } from '@/services/tricopillSubscriptions'

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

  return (
    <AppLayout title="Assinaturas Tricopill">
      <PageHeader title="Assinaturas (Clube)" description="Assinantes do Tricopill — plano, status, ciclos pagos e envios. Cobrança, Bling, Melhor Envio e rastreio são automáticos." />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Assinaturas ativas</p>
          <p className="text-2xl font-bold text-foreground">{stats.active}</p>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Receita recorrente (MRR)</p>
          <p className="text-2xl font-bold text-emerald-700">{brl(stats.mrr)}</p>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total cadastradas</p>
          <p className="text-2xl font-bold text-foreground">{stats.total}</p>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{loading ? 'Carregando…' : `${rows.length} assinatura(s)`}</p>
        <Button variant="outline" size="sm" onClick={() => setReload((k) => k + 1)} disabled={loading}>Atualizar</Button>
      </div>

      {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">{error}</p> : null}

      {!loading && !error && rows.length === 0 ? (
        <p className="rounded-md border border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma assinatura ainda.</p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Cliente</th>
                <th className="px-3 py-2 font-medium">Plano</th>
                <th className="px-3 py-2 font-medium">Valor/mês</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Ciclos pagos</th>
                <th className="px-3 py-2 font-medium">Último envio</th>
                <th className="px-3 py-2 font-medium">Entrega</th>
                <th className="px-3 py-2 font-medium">Asaas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const ent = s.entrega ?? {}
                const cidade = [String(ent.cidade ?? ''), String(ent.uf ?? '')].filter(Boolean).join('/')
                return (
                  <tr key={s.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <p className="font-medium text-foreground">{s.customerName || '—'}</p>
                      <p className="text-xs text-muted-foreground">{s.phone || ''}{s.email ? ` · ${s.email}` : ''}</p>
                    </td>
                    <td className="px-3 py-2">
                      <p>{CADENCE_LABEL[s.cadence] ?? s.cadence}</p>
                      <p className="text-xs text-muted-foreground">{s.unitsPerShipment}× frasco{s.unitsPerShipment > 1 ? 's' : ''} · {brl(s.unitPriceCents)}/un</p>
                    </td>
                    <td className="px-3 py-2 font-medium">{brl(s.monthlyValueCents)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status] ?? 'bg-muted text-muted-foreground'}`}>{s.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      {s.paidCycles}{s.minCycles ? <span className="text-xs text-muted-foreground"> / mín. {s.minCycles}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <p>ciclo {s.lastShippedCycle || '—'}</p>
                      {s.status === 'active' ? <p className="text-xs text-muted-foreground">próx.: ciclo {nextShipCycle(s)}</p> : null}
                    </td>
                    <td className="px-3 py-2 text-xs">{cidade || '—'}</td>
                    <td className="px-3 py-2">
                      {s.asaasSubscriptionId ? (
                        <a className="text-xs text-sky-700 underline" href={`https://www.asaas.com/subscriptions/show/${s.asaasSubscriptionId}`} target="_blank" rel="noreferrer">abrir</a>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </AppLayout>
  )
}
