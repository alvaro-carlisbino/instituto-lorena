import type { Lead } from '@/mocks/crmMock'

/**
 * Tipo de entrega de um pedido (polo de vendas / Tricopill). Espelha o `delivery_mode`
 * gravado em `custom_fields.entrega` pelo bot/checkout:
 *   retirada_clinica → retirada · entrega_local_maringa → motoboy · envio_externo → correios.
 * Quando o modo não foi gravado (vendas antigas/manuais), tenta inferir pelo CEP (Maringá e
 * região = motoboy); fora isso fica 'desconhecido' (não informado).
 */
export type DeliveryKind = 'retirada' | 'motoboy' | 'correios' | 'desconhecido'

export type DeliveryClassification = {
  kind: DeliveryKind
  label: string
  emoji: string
  /** true = inferido pelo CEP (sem delivery_mode explícito). */
  inferred: boolean
}

const LABELS: Record<DeliveryKind, { label: string; emoji: string }> = {
  retirada: { label: 'Retirada', emoji: '🏠' },
  motoboy: { label: 'Motoboy Maringá', emoji: '🛵' },
  correios: { label: 'Correios', emoji: '📦' },
  desconhecido: { label: 'Não informado', emoji: '—' },
}

/** Rótulos das opções de filtro (ordem de exibição). */
export const DELIVERY_FILTER_OPTIONS: Array<{ value: DeliveryKind; label: string }> = [
  { value: 'motoboy', label: '🛵 Motoboy Maringá' },
  { value: 'retirada', label: '🏠 Retirada na clínica' },
  { value: 'correios', label: '📦 Envio Correios' },
  { value: 'desconhecido', label: '— Não informado' },
]

/**
 * CEPs de Maringá e região (Sarandi, Paiçandu, Marialva) — entrega própria por motoboy.
 * Heurística por prefixo (a classificação oficial do backend é por cidade via ViaCEP);
 * aqui é só para dar uma dica visual quando falta o delivery_mode. Maringá 87000–87114,
 * Sarandi/Paiçandu 871xx, Marialva 86990-xxx.
 */
function isMaringaRegionCep(cepDigits: string): boolean {
  if (cepDigits.length !== 8) return false
  return cepDigits.startsWith('870') || cepDigits.startsWith('871') || cepDigits.startsWith('86990')
}

/**
 * Status logístico do pedido (Fase 2) — gravado em custom_fields.entrega.status. Canônico e
 * único pros 3 tipos de entrega (os rótulos se adaptam ao tipo na UI quando útil):
 *   a_preparar → pronto (separado/etiqueta) → enviado (postado/saiu) → entregue. (+ cancelado)
 */
export type ShipStatus = 'a_preparar' | 'pronto' | 'enviado' | 'entregue' | 'cancelado'

export const SHIP_STATUS_OPTIONS: Array<{ value: ShipStatus; label: string }> = [
  { value: 'a_preparar', label: 'A preparar' },
  { value: 'pronto', label: 'Pronto / separado' },
  { value: 'enviado', label: 'Enviado / saiu' },
  { value: 'entregue', label: 'Entregue' },
  { value: 'cancelado', label: 'Cancelado' },
]

const SHIP_STATUS_SET = new Set<ShipStatus>(['a_preparar', 'pronto', 'enviado', 'entregue', 'cancelado'])

export function shipStatusLabel(s: ShipStatus): string {
  return SHIP_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s
}

/** Lê o status logístico do lead (default 'a_preparar'). */
export function getShipStatus(lead: Pick<Lead, 'customFields'> | null | undefined): ShipStatus {
  const ent = ((lead?.customFields ?? {}) as Record<string, unknown>).entrega as Record<string, unknown> | undefined
  const raw = String(ent?.status ?? '').trim() as ShipStatus
  return SHIP_STATUS_SET.has(raw) ? raw : 'a_preparar'
}

export function classifyDelivery(lead: Pick<Lead, 'customFields'>): DeliveryClassification {
  const cf = (lead.customFields ?? {}) as Record<string, unknown>
  const ent = (cf.entrega ?? {}) as Record<string, unknown>
  const cad = (cf.cadastro ?? {}) as Record<string, unknown>
  const mode = String(ent.delivery_mode ?? '').trim()

  const make = (kind: DeliveryKind, inferred = false): DeliveryClassification => ({
    kind,
    inferred,
    ...LABELS[kind],
  })

  if (mode === 'retirada_clinica') return make('retirada')
  if (mode === 'entrega_local_maringa') return make('motoboy')
  if (mode === 'envio_externo') return make('correios')

  // Sem modo explícito: infere pelo CEP (Maringá → motoboy). Fora isso, não informado.
  const cep = String(ent.cep ?? cad.cep ?? '').replace(/\D/g, '')
  if (isMaringaRegionCep(cep)) return make('motoboy', true)
  return make('desconhecido')
}
