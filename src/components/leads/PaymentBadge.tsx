import { cn } from '@/lib/utils'
import type { LeadPaymentSummary } from '@/services/crmLeadPayments'

const PILL = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider'

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function methodLabel(method: 'pix' | 'card'): string {
  return method === 'pix' ? 'Pix' : 'Cartão'
}

/**
 * Selo de status de pagamento do lead (polo de vendas / Tricopill).
 * `paid` = verde "✓ Pago · R$"; `pending` = âmbar "⏳ Aguardando · R$".
 * Renderiza `null` quando o lead não tem cobrança.
 */
export function PaymentBadge({
  payment,
  className,
}: {
  payment: LeadPaymentSummary | null | undefined
  className?: string
}) {
  if (!payment) return null
  const paid = payment.status === 'paid'
  return (
    <span
      className={cn(
        PILL,
        paid
          ? 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300'
          : 'bg-amber-500/10 text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-300',
        className,
      )}
      title={`${paid ? 'Pago' : 'Aguardando pagamento'} · ${methodLabel(payment.method)} · ${brl(payment.amountCents)}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', paid ? 'bg-emerald-500' : 'bg-amber-500')} aria-hidden />
      {paid ? '✓ Pago' : '⏳ Aguardando'}
      {payment.amountCents > 0 ? ` · ${brl(payment.amountCents)}` : ''}
      {` · ${methodLabel(payment.method)}`}
    </span>
  )
}

/**
 * Selo de Polo (tenant) — usado no modo "Todos os polos" para distinguir de qual
 * negócio é o lead. Renderiza `null` se não houver nome.
 */
export function PoloBadge({ name, className }: { name: string | null | undefined; className?: string }) {
  if (!name) return null
  return (
    <span className={cn(PILL, 'bg-indigo-500/10 text-indigo-700 ring-1 ring-indigo-500/25 dark:text-indigo-300', className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" aria-hidden />
      {name}
    </span>
  )
}
