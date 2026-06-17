import { supabase } from '@/lib/supabaseClient'

// Asaas — gateway único (cartão + Pix). Substitui crmRede + crmPagbank na geração de links.

async function invoke(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    let msg = error.message
    const ctx = (error as { context?: unknown }).context as { json?: () => Promise<unknown>; clone?: () => Response } | undefined
    try {
      if (ctx && typeof ctx.json === 'function') {
        const b = (await (ctx.clone ? ctx.clone() : (ctx as unknown as Response)).json()) as { message?: string; error?: string }
        msg = b?.message || b?.error || msg
      }
    } catch {
      // ignore
    }
    throw new Error(String(msg || 'Falha na operação'))
  }
  return (data ?? {}) as Record<string, unknown>
}

// === Config (autenticado, em Integrações) ===
export type AsaasConfigStatus = { configured: boolean; env: string }

export async function getAsaasConfig(): Promise<AsaasConfigStatus> {
  const p = await invoke('crm-asaas', { action: 'get_config' })
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha'))
  return { configured: p.configured === true, env: String(p.env ?? 'sandbox') }
}

export async function setAsaasConfig(patch: { apiKey?: string; env?: string; webhookToken?: string }): Promise<void> {
  const body: Record<string, unknown> = { action: 'set_config' }
  if (patch.apiKey !== undefined) body.apiKey = patch.apiKey
  if (patch.env !== undefined) body.env = patch.env
  if (patch.webhookToken !== undefined) body.webhookToken = patch.webhookToken
  const p = await invoke('crm-asaas', body)
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha ao salvar Asaas'))
}

export async function testAsaas(): Promise<{ ok: boolean; message: string; env: string }> {
  const p = await invoke('crm-asaas', { action: 'test' })
  return { ok: p.ok === true, message: String(p.message ?? p.error ?? ''), env: String(p.env ?? '') }
}

// === Geração de links (autenticado) ===
export async function generateAsaasCardLink(args: {
  amountCents: number
  description: string
  leadId?: string
  installments?: number
  freightCents?: number
  couponCode?: string
  customerName?: string
  cpf?: string
}): Promise<{ payLink: string; amountCents: number }> {
  const p = await invoke('crm-asaas', {
    action: 'generate_card',
    amountCents: args.amountCents,
    description: args.description,
    appBaseUrl: window.location.origin,
    ...(args.leadId ? { leadId: args.leadId } : {}),
    ...(args.installments ? { installments: args.installments } : {}),
    ...(args.freightCents && args.freightCents > 0 ? { freightCents: args.freightCents } : {}),
    ...(args.couponCode?.trim() ? { couponCode: args.couponCode.trim() } : {}),
    ...(args.customerName?.trim() ? { customerName: args.customerName.trim() } : {}),
    ...(args.cpf?.replace(/\D/g, '') ? { cpf: args.cpf.replace(/\D/g, '') } : {}),
  })
  if (p.ok !== true) {
    const m = String(p.message || p.error || '')
    if (m.includes('asaas_nao_configurado')) throw new Error('Asaas não configurado neste polo. Preencha a API Key em Integrações.')
    if (m.includes('asaas_valor')) throw new Error('Informe um valor válido (mínimo R$ 5,00).')
    throw new Error(m || 'Falha ao gerar cobrança de cartão')
  }
  return { payLink: String(p.payLink ?? ''), amountCents: Number(p.amountCents ?? 0) }
}

export async function generateAsaasPix(args: {
  amountCents: number
  description: string
  leadId?: string
  freightCents?: number
  couponCode?: string
  customerName?: string
  cpf?: string
}): Promise<{ qrText: string; qrImageUrl: string; amountCents: number }> {
  const p = await invoke('crm-asaas', {
    action: 'generate_pix',
    amountCents: args.amountCents,
    description: args.description,
    ...(args.leadId ? { leadId: args.leadId } : {}),
    ...(args.freightCents && args.freightCents > 0 ? { freightCents: args.freightCents } : {}),
    ...(args.couponCode?.trim() ? { couponCode: args.couponCode.trim() } : {}),
    ...(args.customerName?.trim() ? { customerName: args.customerName.trim() } : {}),
    ...(args.cpf?.replace(/\D/g, '') ? { cpf: args.cpf.replace(/\D/g, '') } : {}),
  })
  if (p.ok !== true) {
    const m = String(p.message || p.error || '')
    if (m.includes('asaas_nao_configurado')) throw new Error('Asaas não configurado neste polo. Preencha a API Key em Integrações.')
    throw new Error(m || 'Falha ao gerar Pix')
  }
  return { qrText: String(p.qrText ?? ''), qrImageUrl: String(p.qrImageUrl ?? ''), amountCents: Number(p.amountCents ?? 0) }
}

// === Checkout público (cliente, sem login) ===
export type AsaasIntentView = { amountCents: number; description: string; installments: number; status: string }

export async function fetchAsaasIntent(id: string): Promise<AsaasIntentView> {
  const p = await invoke('crm-asaas-pay', { action: 'get_intent', id })
  if (p.ok !== true) throw new Error(String(p.error || 'Cobrança não encontrada'))
  return {
    amountCents: Number(p.amountCents ?? 0),
    description: String(p.description ?? ''),
    installments: Number(p.installments ?? 1),
    status: String(p.status ?? 'pending'),
  }
}

export type AsaasCardInput = {
  cardholderName: string
  cardNumber: string
  expirationMonth: number
  expirationYear: number
  securityCode: string
}
export type AsaasHolderInput = { cpf?: string; postalCode?: string; addressNumber?: string; phone?: string; email?: string }

export async function payAsaasCard(
  id: string,
  card: AsaasCardInput,
  holder: AsaasHolderInput,
  installments?: number,
): Promise<{ status: string; message: string }> {
  const p = await invoke('crm-asaas-pay', {
    action: 'pay',
    id,
    card,
    holder,
    ...(installments ? { installments } : {}),
  })
  return { status: String(p.status ?? (p.ok ? 'paid' : 'failed')), message: String(p.message ?? p.error ?? '') }
}
