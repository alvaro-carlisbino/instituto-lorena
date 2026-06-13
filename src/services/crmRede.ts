import { supabase } from '@/lib/supabaseClient'

async function invoke(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    // FunctionsHttpError: o corpo real vem no Response em error.context.
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

// === Config (autenticado, no CRM) ===
export type RedeConfigStatus = { configured: boolean; env: string }

export async function getRedeConfig(): Promise<RedeConfigStatus> {
  const p = await invoke('crm-rede-link', { action: 'get_config' })
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha'))
  return { configured: p.configured === true, env: String(p.env ?? 'sandbox') }
}

export async function setRedeConfig(patch: { pv?: string; token?: string; env?: string }): Promise<void> {
  const body: Record<string, unknown> = { action: 'set_config' }
  if (patch.pv !== undefined) body.pv = patch.pv
  if (patch.token !== undefined) body.token = patch.token
  if (patch.env !== undefined) body.env = patch.env
  const p = await invoke('crm-rede-link', body)
  if (p.ok !== true) throw new Error(String(p.message || p.error || 'Falha ao salvar Rede'))
}

/** Cria a cobrança e devolve a URL do checkout (/pagar/<id>). */
export async function generateRedeLink(args: {
  amountCents: number
  description: string
  leadId?: string
  installments?: number
  freightCents?: number
  couponCode?: string
}): Promise<{ payLink: string; amountCents: number }> {
  const p = await invoke('crm-rede-link', {
    action: 'generate_link',
    amountCents: args.amountCents,
    description: args.description,
    appBaseUrl: window.location.origin,
    ...(args.leadId ? { leadId: args.leadId } : {}),
    ...(args.installments ? { installments: args.installments } : {}),
    ...(args.freightCents && args.freightCents > 0 ? { freightCents: args.freightCents } : {}),
    ...(args.couponCode?.trim() ? { couponCode: args.couponCode.trim() } : {}),
  })
  if (p.ok !== true) {
    const m = String(p.message || p.error || '')
    if (m.includes('rede_nao_configurado')) {
      throw new Error('Rede não configurada neste polo. Preencha PV e Token (e.Rede) em Integrações.')
    }
    if (m.includes('rede_valor')) throw new Error('Informe um valor válido (mínimo R$ 1,00).')
    throw new Error(m || 'Falha ao gerar cobrança')
  }
  return { payLink: String(p.payLink ?? ''), amountCents: Number(p.amountCents ?? 0) }
}

/** Dispara uma autorização de teste (sandbox) para validar PV/token salvos. */
export async function testRedeTx(): Promise<{ ok: boolean; returnCode: string; message: string }> {
  try {
    const p = await invoke('crm-rede-link', { action: 'test_tx' })
    return { ok: p.ok === true, returnCode: String(p.returnCode ?? ''), message: String(p.message ?? '') }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (m.includes('rede_nao_configurado')) throw new Error('Rede não configurada. Preencha e salve PV e Token primeiro.')
    if (m.includes('teste_so_em_sandbox')) throw new Error('O teste de transação só roda no ambiente Sandbox.')
    throw new Error(m || 'Falha no teste de transação')
  }
}

// === Checkout público (cliente, sem login) ===
export type RedeIntentView = { amountCents: number; description: string; installments: number; status: string }

export async function fetchRedeIntent(id: string): Promise<RedeIntentView> {
  const p = await invoke('crm-rede-pay', { action: 'get_intent', id })
  if (p.ok !== true) throw new Error(String(p.error || 'Cobrança não encontrada'))
  return {
    amountCents: Number(p.amountCents ?? 0),
    description: String(p.description ?? ''),
    installments: Number(p.installments ?? 1),
    status: String(p.status ?? 'pending'),
  }
}

export type RedeCardInput = {
  cardholderName: string
  cardNumber: string
  expirationMonth: number
  expirationYear: number
  securityCode: string
}

export async function payRedeIntent(id: string, card: RedeCardInput, installments?: number): Promise<{ status: string; message: string }> {
  const p = await invoke('crm-rede-pay', { action: 'pay', id, card, ...(installments ? { installments } : {}) })
  return { status: String(p.status ?? (p.ok ? 'paid' : 'failed')), message: String(p.message ?? p.error ?? '') }
}
