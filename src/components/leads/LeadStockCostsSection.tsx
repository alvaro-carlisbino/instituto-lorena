import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PackageCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { useTenant } from '@/context/TenantContext'
import {
  type KitCost,
  type StockKit,
  listKitCosts,
  listKits,
} from '@/services/estoqueKits'

const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const KIT_STATUS_STYLE: Record<string, string> = {
  montado: 'bg-sky-500/15 text-sky-600',
  consumido: 'bg-emerald-500/15 text-emerald-600',
  cancelado: 'bg-red-500/15 text-red-600',
}

/**
 * Gasto em materiais do paciente: kits de estoque vinculados a este lead
 * (montados e consumidos) com o custo real da baixa. Fecha a cadeia
 * kit → paciente → Shosp pro controle de gastos por cirurgia.
 * Só polo clínica; sem kits, não polui a ficha.
 */
export function LeadStockCostsSection({ leadId }: { leadId: string }) {
  const { tenant } = useTenant()
  const isClinic = tenant.poloType !== 'sales'
  const [kits, setKits] = useState<StockKit[]>([])
  const [costs, setCosts] = useState<Map<string, KitCost>>(new Map())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!isClinic) return
    let alive = true
    Promise.all([listKits(leadId), listKitCosts(leadId)])
      .then(([ks, cs]) => {
        if (!alive) return
        setKits(ks.filter((k) => k.status !== 'cancelado'))
        setCosts(cs)
        setLoaded(true)
      })
      .catch(() => {
        // Ficha do lead não pode quebrar por causa do estoque — só não mostra a seção.
      })
    return () => {
      alive = false
    }
  }, [leadId, isClinic])

  if (!isClinic || !loaded || kits.length === 0) return null

  const consumed = kits.filter((k) => k.status === 'consumido')
  const totalCents = consumed.reduce((acc, k) => acc + (costs.get(k.id)?.totalCostCents ?? 0), 0)
  const hasPartial = consumed.some((k) => {
    const c = costs.get(k.id)
    return !c || !c.fullyCosted
  })

  return (
    <section
      aria-labelledby="lead-stock-costs-heading"
      className="rounded-md border border-border/80 bg-muted/10 p-3"
    >
      <h2
        id="lead-stock-costs-heading"
        className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground"
      >
        <PackageCheck className="size-3.5" /> Materiais de estoque (kits)
      </h2>

      <div className="space-y-1.5">
        {kits.map((kit) => {
          const cost = costs.get(kit.id)
          return (
            <div
              key={kit.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{kit.name}</span>
                <Badge variant="secondary" className={KIT_STATUS_STYLE[kit.status]}>
                  {kit.status}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                {kit.status === 'consumido'
                  ? cost
                    ? `${formatBRL(cost.totalCostCents)}${cost.fullyCosted ? '' : ' (parcial)'}`
                    : 'sem custo registrado'
                  : 'separado — aguardando consumo'}
              </span>
            </div>
          )
        })}
      </div>

      {consumed.length > 0 ? (
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-xs text-muted-foreground">
            Total em materiais {hasPartial ? '(parcial — há itens sem custo)' : ''}
          </span>
          <span className="font-semibold">{formatBRL(totalCents)}</span>
        </div>
      ) : null}

      <p className="mt-2 text-xs text-muted-foreground">
        A separação e o consumo dos kits acontecem em{' '}
        <Link to="/kits" className="underline underline-offset-2">
          Kits cirúrgicos
        </Link>
        .
      </p>
    </section>
  )
}
