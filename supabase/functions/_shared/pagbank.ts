import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * PagBank — Checkout / Link de Pagamento (Pix + cartão).
 * Config por polo em `tenant_integrations.pagbank` ({ token?, env?, base_url? }),
 * com fallback aos secrets globais. O link gerado (rel "PAY") é enviado ao cliente
 * no WhatsApp; o webhook crm-pagbank-webhook move o lead para "Pago" quando confirma.
 */

export type PagBankConfig = { token: string; baseUrl: string; env: 'sandbox' | 'prod' }

const PROD_BASE = 'https://api.pagseguro.com'
const SANDBOX_BASE = 'https://sandbox.api.pagseguro.com'

/** Kits do Tricopill. unit_amount em CENTAVOS (preço cheio/cartão; o link aceita Pix e cartão). */
export const PAGBANK_KITS: Record<string, { label: string; amountCents: number; qty: number }> = {
  '1_mes': { label: 'Tricopill — 1 frasco (1 mês)', amountCents: 19900, qty: 1 },
  '3_meses': { label: 'Tricopill — 3 frascos (3 meses) + 1 grátis', amountCents: 59700, qty: 3 },
  '5_meses': { label: 'Tricopill — 5 frascos (5 meses)', amountCents: 99900, qty: 5 },
}

/** Normaliza variações que a IA possa mandar ('3 meses', '3meses', 'kit3') para a chave canônica. */
export function normalizeKitKey(raw: string): string | null {
  const s = String(raw ?? '').toLowerCase().replace(/[^0-9a-z]/g, '')
  if (s.includes('5')) return '5_meses'
  if (s.includes('3')) return '3_meses'
  if (s.includes('1')) return '1_mes'
  return null
}

export async function readPagBankConfig(
  admin: SupabaseClient,
  tenantId: string,
): Promise<PagBankConfig | null> {
  let token = (Deno.env.get('PAGBANK_API_TOKEN') ?? '').trim()
  let env = (Deno.env.get('PAGBANK_ENV') ?? '').trim().toLowerCase()
  let baseUrl = (Deno.env.get('PAGBANK_BASE_URL') ?? '').trim()

  if (tenantId) {
    try {
      const { data } = await admin
        .from('tenant_integrations')
        .select('pagbank')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      const cfg = (data as { pagbank?: Record<string, unknown> } | null)?.pagbank
      if (cfg && typeof cfg === 'object') {
        if (typeof cfg.token === 'string' && cfg.token.trim()) token = cfg.token.trim()
        if (typeof cfg.env === 'string' && cfg.env.trim()) env = cfg.env.trim().toLowerCase()
        if (typeof cfg.base_url === 'string' && cfg.base_url.trim()) baseUrl = cfg.base_url.trim()
      }
    } catch {
      // best-effort; cai nos secrets globais
    }
  }

  if (!token) return null
  const resolvedEnv: 'sandbox' | 'prod' = env === 'prod' ? 'prod' : 'sandbox'
  if (!baseUrl) baseUrl = resolvedEnv === 'prod' ? PROD_BASE : SANDBOX_BASE
  return { token, baseUrl: baseUrl.replace(/\/$/, ''), env: resolvedEnv }
}

type LeadForCheckout = {
  id: string
  patient_name?: string | null
  phone?: string | null
  custom_fields?: Record<string, unknown> | null
}

export type CheckoutResult = {
  checkoutId: string
  payLink: string
  amountCents: number
  label: string
  referenceId: string
}

/**
 * Cria um Checkout/Link de Pagamento no PagBank e registra em pagbank_checkouts.
 * Aceita `kit` (chave dos kits) OU `amountCents`+`description` para valor avulso.
 */
export async function createPagBankCheckout(
  admin: SupabaseClient,
  args: {
    tenantId: string
    lead: LeadForCheckout
    kit?: string
    amountCents?: number
    description?: string
    supabaseUrl: string
  },
): Promise<CheckoutResult> {
  const cfg = await readPagBankConfig(admin, args.tenantId)
  if (!cfg) throw new Error('pagbank_not_configured')

  // Resolve item (kit ou valor avulso).
  let amountCents = 0
  let label = ''
  let kitKey = ''
  if (args.kit) {
    const key = normalizeKitKey(args.kit)
    const kit = key ? PAGBANK_KITS[key] : undefined
    if (!kit) throw new Error('pagbank_invalid_kit')
    amountCents = kit.amountCents
    label = kit.label
    kitKey = key as string
  } else {
    amountCents = Math.round(Number(args.amountCents ?? 0))
    label = String(args.description ?? 'Tricopill').slice(0, 100) || 'Tricopill'
  }
  if (!Number.isFinite(amountCents) || amountCents < 100) throw new Error('pagbank_invalid_amount')

  const referenceId = `lead:${args.lead.id}`
  const cad = ((args.lead.custom_fields?.cadastro as Record<string, string>) ?? {})
  const customerName = String(cad.nomeCompleto || args.lead.patient_name || 'Cliente Tricopill').slice(0, 60)
  const phoneDigits = String(args.lead.phone ?? '').replace(/\D/g, '')
  const webhookUrl = `${args.supabaseUrl.replace(/\/$/, '')}/functions/v1/crm-pagbank-webhook`

  // Expira em 3 dias (formato ISO com offset -03:00).
  const exp = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  const expIso = exp.toISOString().replace('Z', '-03:00')

  const body: Record<string, unknown> = {
    reference_id: referenceId,
    customer_modifiable: true,
    customer: { name: customerName },
    items: [{ reference_id: kitKey || 'avulso', name: label, quantity: 1, unit_amount: amountCents }],
    payment_methods: [{ type: 'PIX' }, { type: 'CREDIT_CARD' }],
    soft_descriptor: 'TRICOPILL',
    expiration_date: expIso,
    notification_urls: [webhookUrl],
    payment_notification_urls: [webhookUrl],
  }

  const res = await fetch(`${cfg.baseUrl}/checkouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }
  if (!res.ok) {
    throw new Error(`pagbank_${res.status}: ${text.slice(0, 300)}`)
  }

  const links = (parsed.links as Array<{ rel?: string; href?: string }> | undefined) ?? []
  const payLink = links.find((l) => String(l.rel ?? '').toUpperCase() === 'PAY')?.href
  const checkoutId = String(parsed.id ?? '')
  if (!payLink) throw new Error('pagbank_no_pay_link')

  // Audita + mapeia para o webhook (best-effort; não bloqueia a venda).
  try {
    await admin.from('pagbank_checkouts').insert({
      checkout_id: checkoutId || referenceId,
      tenant_id: args.tenantId,
      lead_id: args.lead.id,
      reference_id: referenceId,
      amount_cents: amountCents,
      kit: kitKey || null,
      pay_link: payLink,
      status: 'created',
    })
  } catch {
    // ignore
  }

  return { checkoutId, payLink, amountCents, label, referenceId }
}

/** Extrai (leadId, paid?) de um payload de notificação do PagBank, de forma tolerante. */
export function parsePagBankNotification(payload: unknown): {
  referenceId: string | null
  leadId: string | null
  paid: boolean
  status: string | null
  ids: string[]
} {
  const ids: string[] = []
  const found: { referenceId: string | null; status: string | null; paid: boolean } = {
    referenceId: null,
    status: null,
    paid: false,
  }

  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    const obj = node as Record<string, unknown>
    if (typeof obj.reference_id === 'string' && obj.reference_id) found.referenceId = obj.reference_id
    if (typeof obj.id === 'string' && obj.id) ids.push(obj.id)
    const st = typeof obj.status === 'string' ? obj.status.toUpperCase() : ''
    if (st) {
      found.status = st
      if (['PAID', 'AVAILABLE', 'COMPLETED', 'APPROVED'].includes(st)) found.paid = true
    }
    for (const v of Object.values(obj)) visit(v)
  }
  visit(payload)

  const refStr = found.referenceId
  const leadId = refStr && refStr.startsWith('lead:') ? refStr.slice('lead:'.length) : null
  return { referenceId: refStr, leadId, paid: found.paid, status: found.status, ids }
}
