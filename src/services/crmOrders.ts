import { supabase } from '@/lib/supabaseClient'
import type { ShipStatus } from '@/lib/deliveryType'

/**
 * Grava o status logístico do pedido em `leads.custom_fields.entrega.status` (Fase 2 da frente
 * de vendas). Merge no jsonb: preserva o resto de custom_fields e do objeto entrega. Recebe o
 * custom_fields atual do lead (já em memória no front) pra não precisar reler.
 */
export async function setShipStatus(
  leadId: string,
  currentCustomFields: Record<string, unknown> | null | undefined,
  status: ShipStatus,
): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const cf = { ...((currentCustomFields ?? {}) as Record<string, unknown>) }
  const ent = { ...((cf.entrega ?? {}) as Record<string, unknown>) }
  ent.status = status
  ent.status_updated_at = new Date().toISOString()
  cf.entrega = ent
  const { error } = await supabase.from('leads').update({ custom_fields: cf }).eq('id', leadId)
  if (error) throw new Error(error.message)
}
