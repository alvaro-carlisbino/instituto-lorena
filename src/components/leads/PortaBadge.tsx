import { cn } from '@/lib/utils'
import type { Lead } from '@/mocks/crmMock'
import { PORTA_LABEL, portaDoLead } from '@/lib/portaDeEntrada'

const PILL = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider'

/**
 * Selo da PORTA DE ENTRADA no card, hoje só para quem veio da landing `/consulta`.
 *
 * O selo de origem ao lado diz o CANAL (`source`), e o lead da landing nasce
 * `manual` e vira `whatsapp` na primeira resposta — nenhum dos dois conta que ele
 * respondeu a triagem. O que sobrevive é `custom_fields.origem_landing`, a mesma
 * regra do filtro "Porta de entrada" e do relatório (`portaDoLead`). Formulário do
 * anúncio já tem o selo "Form Meta" pela atribuição, então não repete aqui.
 */
export function PortaBadge({ lead, className }: { lead: Pick<Lead, 'source' | 'customFields'>; className?: string }) {
  if (portaDoLead(lead) !== 'landing') return null
  return (
    <span
      className={cn(PILL, 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300', className)}
      title="Respondeu a triagem da landing /consulta"
    >
      {PORTA_LABEL.landing}
    </span>
  )
}
