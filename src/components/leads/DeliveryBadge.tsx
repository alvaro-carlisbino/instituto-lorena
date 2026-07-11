import { cn } from '@/lib/utils'
import { classifyDelivery, type DeliveryKind } from '@/lib/deliveryType'
import type { Lead } from '@/mocks/crmMock'

const PILL = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider'

const STYLE: Record<Exclude<DeliveryKind, 'desconhecido'>, string> = {
  motoboy: 'bg-sky-500/10 text-sky-700 ring-1 ring-sky-500/25 dark:text-sky-300',
  retirada: 'bg-violet-500/10 text-violet-700 ring-1 ring-violet-500/25 dark:text-violet-300',
  correios: 'bg-orange-500/10 text-orange-700 ring-1 ring-orange-500/25 dark:text-orange-300',
}

/**
 * Selo de TIPO DE ENTREGA do pedido (polo de vendas / Tricopill): 🛵 Motoboy Maringá /
 * 🏠 Retirada / 📦 Correios. Sufixo "?" quando o tipo foi inferido pelo CEP (sem delivery_mode).
 * Renderiza `null` quando não dá pra classificar ('desconhecido') — pra não poluir o card.
 */
export function DeliveryBadge({ lead, className }: { lead: Pick<Lead, 'customFields'>; className?: string }) {
  const c = classifyDelivery(lead)
  if (c.kind === 'desconhecido') return null
  return (
    <span
      className={cn(PILL, STYLE[c.kind], className)}
      title={`Entrega: ${c.label}${c.inferred ? ' (inferido pelo CEP, confirmar)' : ''}`}
    >
      {c.label}
      {c.inferred ? '?' : ''}
    </span>
  )
}
