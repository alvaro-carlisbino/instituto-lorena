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

/**
 * Grava o cadastro do cliente em `leads.custom_fields.cadastro` (nome completo, CPF, data de
 * nascimento) e, quando vier, o endereço em `.entrega`. Merge no jsonb: preserva o resto de
 * custom_fields e dos dois objetos (sexo, e-mail, status logístico…).
 *
 * O endereço passou a ser gravado aqui porque a tela de envio coletava CEP/rua/número e jogava
 * fora: só o cadastro ia pro lead. Na compra seguinte o endereço aparecia em branco e a
 * atendente redigitava tudo, mesmo sendo o mesmo cliente do mesmo lead.
 */
export async function saveLeadCadastro(
  leadId: string,
  currentCustomFields: Record<string, unknown> | null | undefined,
  cadastro: { nomeCompleto?: string; cpf?: string; dataNascimento?: string },
  entrega?: {
    cep?: string
    logradouro?: string
    numero?: string
    complemento?: string
    bairro?: string
    cidade?: string
    uf?: string
  },
): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const cf = { ...((currentCustomFields ?? {}) as Record<string, unknown>) }
  const cad = { ...((cf.cadastro ?? {}) as Record<string, unknown>) }
  if (cadastro.nomeCompleto) cad.nomeCompleto = cadastro.nomeCompleto
  if (cadastro.cpf) cad.cpf = cadastro.cpf
  if (cadastro.dataNascimento) cad.dataNascimento = cadastro.dataNascimento
  cf.cadastro = cad
  if (entrega) {
    const ent = { ...((cf.entrega ?? {}) as Record<string, unknown>) }
    for (const [k, v] of Object.entries(entrega)) {
      // Só escreve o que veio preenchido — complemento vazio não apaga o que já existia.
      if (typeof v === 'string' && v.trim()) ent[k] = v.trim()
    }
    cf.entrega = ent
  }
  const { error } = await supabase.from('leads').update({ custom_fields: cf }).eq('id', leadId)
  if (error) throw new Error(error.message)
}
