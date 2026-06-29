import { supabase } from '@/lib/supabaseClient'

export type TricopillSubscription = {
  id: string
  customerName: string
  phone: string
  customerDoc: string
  email: string
  cadence: string
  unitsPerShipment: number
  unitPriceCents: number
  freightCents: number
  monthlyValueCents: number
  paidCycles: number
  lastShippedCycle: number
  minCycles: number
  status: string
  asaasSubscriptionId: string | null
  entrega: Record<string, unknown>
  createdAt: string
}

/** Assinaturas (clube) do Tricopill — fonte: asaas_subscriptions. */
export async function fetchTricopillSubscriptions(): Promise<TricopillSubscription[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('asaas_subscriptions')
    .select('id, customer_name, phone, customer_doc, email, cadence, units_per_shipment, unit_price_cents, freight_cents, monthly_value_cents, paid_cycles, last_shipped_cycle, min_cycles, status, asaas_subscription_id, entrega, created_at')
    .eq('tenant_id', 'tricopill')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    customerName: String(r.customer_name ?? ''),
    phone: String(r.phone ?? ''),
    customerDoc: String(r.customer_doc ?? ''),
    email: String(r.email ?? ''),
    cadence: String(r.cadence ?? ''),
    unitsPerShipment: Number(r.units_per_shipment ?? 0),
    unitPriceCents: Number(r.unit_price_cents ?? 0),
    freightCents: Number(r.freight_cents ?? 0),
    monthlyValueCents: Number(r.monthly_value_cents ?? 0),
    paidCycles: Number(r.paid_cycles ?? 0),
    lastShippedCycle: Number(r.last_shipped_cycle ?? 0),
    minCycles: Number(r.min_cycles ?? 0),
    status: String(r.status ?? ''),
    asaasSubscriptionId: r.asaas_subscription_id != null ? String(r.asaas_subscription_id) : null,
    entrega: (r.entrega ?? {}) as Record<string, unknown>,
    createdAt: String(r.created_at ?? ''),
  }))
}
