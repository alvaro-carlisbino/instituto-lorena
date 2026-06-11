import { supabase } from '@/lib/supabaseClient'

async function invokeRede(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.functions.invoke('crm-rede-link', { body })
  if (error) {
    const ctx = (error as { context?: { body?: unknown } }).context
    const msg = ctx && typeof ctx.body === 'string' ? ctx.body : error.message
    throw new Error(String(msg || 'Falha na operação Rede'))
  }
  const p = (data ?? {}) as Record<string, unknown>
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha na operação Rede'))
  return p
}

export type RedeConfigStatus = { configured: boolean; env: string }

export async function getRedeConfig(): Promise<RedeConfigStatus> {
  const p = await invokeRede({ action: 'get_config' })
  return { configured: p.configured === true, env: String(p.env ?? 'sandbox') }
}

export async function setRedeConfig(patch: {
  clientId?: string
  clientSecret?: string
  companyNumber?: string
  createdBy?: string
  env?: string
}): Promise<void> {
  const body: Record<string, unknown> = { action: 'set_config' }
  if (patch.clientId !== undefined) body.client_id = patch.clientId
  if (patch.clientSecret !== undefined) body.client_secret = patch.clientSecret
  if (patch.companyNumber !== undefined) body.company_number = patch.companyNumber
  if (patch.createdBy !== undefined) body.created_by = patch.createdBy
  if (patch.env !== undefined) body.env = patch.env
  await invokeRede(body)
}

export async function generateRedeLink(args: {
  amountCents: number
  description: string
  leadId?: string
}): Promise<{ payLink: string; amountCents: number }> {
  const p = await invokeRede({
    action: 'generate_link',
    amountCents: args.amountCents,
    description: args.description,
    ...(args.leadId ? { leadId: args.leadId } : {}),
  })
  return { payLink: String(p.payLink ?? ''), amountCents: Number(p.amountCents ?? 0) }
}
