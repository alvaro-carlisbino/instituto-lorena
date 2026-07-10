import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { quoteCoupon } from './coupons.ts'

/**
 * PagBank — Checkout / Link de Pagamento (Pix + cartão).
 * Config por polo em `tenant_integrations.pagbank` ({ token?, env?, base_url? }),
 * com fallback aos secrets globais. O link gerado (rel "PAY") é enviado ao cliente
 * no WhatsApp; o webhook crm-pagbank-webhook move o lead para "Pago" quando confirma.
 */

export type PagBankConfig = { token: string; baseUrl: string; env: 'sandbox' | 'prod'; pixOnly: boolean }

const PROD_BASE = 'https://api.pagseguro.com'
const SANDBOX_BASE = 'https://sandbox.api.pagseguro.com'

/** Kits do Tricopill no PIX (unit_amount em CENTAVOS). Valores oficiais: 1 frasco
 * R$199 (preço único), promo 3+1 = 4 frascos R$567 no Pix. */
export const PAGBANK_KITS: Record<string, { label: string; amountCents: number; qty: number }> = {
  // PIX = cartão −5%. Cartão: 3m=59700, 5m=99500 → PIX: 3m=56715, 5m=94525.
  '1_mes': { label: 'Tricopill — 1 frasco (1 mês)', amountCents: 19900, qty: 1 },
  '3_meses': { label: 'Tricopill — compra 3 + 1 grátis (4 frascos)', amountCents: 56715, qty: 4 },
  '5_meses': { label: 'Tricopill — compra 5 + 1 grátis (6 frascos)', amountCents: 94525, qty: 6 },
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
  let pixOnly = (Deno.env.get('PAGBANK_PIX_ONLY') ?? '').trim().toLowerCase() === 'true'

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
        if (typeof cfg.pix_only === 'boolean') pixOnly = cfg.pix_only
      }
    } catch {
      // best-effort; cai nos secrets globais
    }
  }

  if (!token) return null
  const resolvedEnv: 'sandbox' | 'prod' = env === 'prod' ? 'prod' : 'sandbox'
  if (!baseUrl) baseUrl = resolvedEnv === 'prod' ? PROD_BASE : SANDBOX_BASE
  return { token, baseUrl: baseUrl.replace(/\/$/, ''), env: resolvedEnv, pixOnly }
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
  /** Valor cheio do produto antes do cupom. */
  baseCents: number
  discountCents: number
  couponCode: string | null
  /** Frete cobrado à parte (incluído em amountCents como item separado). */
  freightCents: number
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
    couponCode?: string
    freightCents?: number
    supabaseUrl: string
  },
): Promise<CheckoutResult> {
  const cfg = await readPagBankConfig(admin, args.tenantId)
  if (!cfg) throw new Error('pagbank_not_configured')

  // Resolve item (kit ou valor avulso).
  let baseCents = 0
  let label = ''
  let kitKey = ''
  if (args.kit) {
    const key = normalizeKitKey(args.kit)
    const kit = key ? PAGBANK_KITS[key] : undefined
    if (!kit) throw new Error('pagbank_invalid_kit')
    baseCents = kit.amountCents
    label = kit.label
    kitKey = key as string
  } else {
    baseCents = Math.round(Number(args.amountCents ?? 0))
    label = String(args.description ?? 'Tricopill').slice(0, 100) || 'Tricopill'
  }
  if (!Number.isFinite(baseCents) || baseCents < 100) throw new Error('pagbank_invalid_amount')

  // Cupom (best-effort): se válido, cobra o valor com desconto. Inválido → valor cheio.
  const coupon = await quoteCoupon(admin, args.tenantId, args.couponCode, baseCents)
  const productCents = coupon.finalCents
  // Frete cobrado à parte (item separado no checkout). Total = produto + frete.
  const freightCents = Math.max(0, Math.round(Number(args.freightCents ?? 0)))
  const amountCents = productCents + freightCents

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
    items: freightCents > 0
      ? [
          { reference_id: kitKey || 'avulso', name: label, quantity: 1, unit_amount: productCents },
          { reference_id: 'frete', name: 'Frete / entrega', quantity: 1, unit_amount: freightCents },
        ]
      : [{ reference_id: kitKey || 'avulso', name: label, quantity: 1, unit_amount: productCents }],
    payment_methods: cfg.pixOnly ? [{ type: 'PIX' }] : [{ type: 'PIX' }, { type: 'CREDIT_CARD' }],
    soft_descriptor: 'TRICOPILL',
    expiration_date: expIso,
    notification_urls: [webhookUrl],
    payment_notification_urls: [webhookUrl],
  }

  // Tenta a base configurada (produção) e, em caso de erro, cai para a sandbox.
  const bases = [cfg.baseUrl]
  if (!cfg.baseUrl.includes('sandbox')) bases.push(SANDBOX_BASE)
  let text = ''
  let parsed: Record<string, unknown> = {}
  let ok = false
  let lastErr = 'pagbank_failed'
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/checkouts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      })
      text = await res.text()
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      } catch {
        parsed = {}
      }
      if (res.ok) {
        ok = true
        break
      }
      lastErr = `pagbank_${res.status}: ${text.slice(0, 300)}`
    } catch (e) {
      lastErr = `pagbank_fetch_error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`
    }
  }
  if (!ok) {
    throw new Error(lastErr)
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
      coupon_code: coupon.applied ? coupon.code : null,
      discount_cents: coupon.discountCents,
      customer_name: customerName || null,
      phone: phoneDigits || null,
      customer_doc: String(cad.cpf || '').replace(/\D/g, '') || null,
    })
  } catch {
    // ignore
  }

  return {
    checkoutId,
    payLink,
    amountCents,
    label,
    referenceId,
    baseCents,
    discountCents: coupon.discountCents,
    couponCode: coupon.applied ? coupon.code : null,
    freightCents,
  }
}

export type PixOrderResult = {
  orderId: string
  /** Pix copia-e-cola (payload EMV) — vai no texto da mensagem. */
  qrText: string
  /** URL do PNG do QR Code (hospedado no PagBank) — enviado como imagem. */
  qrImageUrl: string
  amountCents: number
  label: string
  referenceId: string
  baseCents: number
  discountCents: number
  couponCode: string | null
  freightCents: number
  env: 'sandbox' | 'prod'
}

/**
 * Gera o QR do Pix (a partir do copia-e-cola) como **data URI PNG base64**.
 * O W-API só aceita imagem em base64 OU URL terminando em .png/.jpg — então o link
 * hospedado do PagBank não serve para enviar como imagem. Best-effort: '' se falhar.
 */
export async function buildQrPngDataUri(text: string): Promise<string> {
  if (!text) return ''
  try {
    const enc = encodeURIComponent(text)
    const res = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=12&format=png&data=${enc}`)
    if (!res.ok) return ''
    const bytes = new Uint8Array(await res.arrayBuffer())
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return `data:image/png;base64,${btoa(binary)}`
  } catch {
    return ''
  }
}

/**
 * Cria uma ORDER no PagBank com Pix dinâmico (qr_codes) e devolve o copia-e-cola + PNG
 * do QR — melhor que o link do checkout para fechar na conversa. Registra em
 * pagbank_checkouts (reference_id `lead:<id>`) para o webhook marcar "Pago".
 */
export async function createPagBankPixOrder(
  admin: SupabaseClient,
  args: {
    tenantId: string
    lead: LeadForCheckout
    kit?: string
    amountCents?: number
    description?: string
    couponCode?: string
    freightCents?: number
    supabaseUrl: string
  },
): Promise<PixOrderResult> {
  const cfg = await readPagBankConfig(admin, args.tenantId)
  if (!cfg) throw new Error('pagbank_not_configured')
  // TRAVA DE SEGURANÇA: em SANDBOX o Pix gerado NÃO é pagável — o bot jamais pode enviar
  // isso a um cliente. Só gera Pix com o PagBank em PRODUÇÃO. NÃO remover sem trocar env.
  if (cfg.env !== 'prod') throw new Error('pix_indisponivel_sandbox')

  // Item (kit ou avulso) — mesma resolução do checkout.
  let baseCents = 0
  let label = ''
  let kitKey = ''
  if (args.kit) {
    const key = normalizeKitKey(args.kit)
    const kit = key ? PAGBANK_KITS[key] : undefined
    if (!kit) throw new Error('pagbank_invalid_kit')
    baseCents = kit.amountCents
    label = kit.label
    kitKey = key as string
  } else {
    baseCents = Math.round(Number(args.amountCents ?? 0))
    label = String(args.description ?? 'Tricopill').slice(0, 100) || 'Tricopill'
  }
  if (!Number.isFinite(baseCents) || baseCents < 100) throw new Error('pagbank_invalid_amount')

  const coupon = await quoteCoupon(admin, args.tenantId, args.couponCode, baseCents)
  const productCents = coupon.finalCents
  const freightCents = Math.max(0, Math.round(Number(args.freightCents ?? 0)))
  const amountCents = productCents + freightCents

  const referenceId = `lead:${args.lead.id}`
  const cad = ((args.lead.custom_fields?.cadastro as Record<string, string>) ?? {})
  const customerName = String(cad.nomeCompleto || args.lead.patient_name || 'Cliente Tricopill').slice(0, 60)
  const webhookUrl = `${args.supabaseUrl.replace(/\/$/, '')}/functions/v1/crm-pagbank-webhook`

  // Pix expira em ~1h (mantém o formato de offset usado no checkout).
  const exp = new Date(Date.now() + 60 * 60 * 1000)
  const expIso = exp.toISOString().replace('Z', '-03:00')

  const items = freightCents > 0
    ? [
        { reference_id: kitKey || 'avulso', name: label.slice(0, 100), quantity: 1, unit_amount: productCents },
        { reference_id: 'frete', name: 'Frete / entrega', quantity: 1, unit_amount: freightCents },
      ]
    : [{ reference_id: kitKey || 'avulso', name: label.slice(0, 100), quantity: 1, unit_amount: productCents }]

  // Cliente: PagBank Orders aceita email/tax_id/phones; em sandbox usamos fallback de teste.
  const customer: Record<string, unknown> = { name: customerName }
  customer.email = String(cad.email || 'cliente@tricopill.com.br').slice(0, 60)
  const taxId = String(cad.cpf || cad.taxId || '').replace(/\D/g, '')
  if (taxId.length === 11) customer.tax_id = taxId
  // (o Pix só roda em produção — trava acima; o CPF real vem do cadastro do cliente)
  let local = String(args.lead.phone ?? '').replace(/\D/g, '')
  if ((local.length === 12 || local.length === 13) && local.startsWith('55')) local = local.slice(2)
  if (local.length === 10 || local.length === 11) {
    customer.phones = [{ country: '55', area: local.slice(0, 2), number: local.slice(2), type: 'MOBILE' }]
  }

  const body = {
    reference_id: referenceId,
    customer,
    items,
    qr_codes: [{ amount: { value: amountCents }, expiration_date: expIso }],
    notification_urls: [webhookUrl],
  }

  const bases = [cfg.baseUrl]
  if (!cfg.baseUrl.includes('sandbox')) bases.push(SANDBOX_BASE)
  let parsed: Record<string, unknown> = {}
  let ok = false
  let lastErr = 'pagbank_failed'
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      } catch {
        parsed = {}
      }
      if (res.ok) { ok = true; break }
      lastErr = `pagbank_${res.status}: ${text.slice(0, 300)}`
    } catch (e) {
      lastErr = `pagbank_fetch_error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`
    }
  }
  if (!ok) throw new Error(lastErr)

  const qrCodes = (parsed.qr_codes as Array<Record<string, unknown>> | undefined) ?? []
  const qr0 = (qrCodes[0] ?? {}) as Record<string, unknown>
  const qrText = String(qr0.text ?? '')
  const qrLinks = (qr0.links as Array<{ rel?: string; href?: string; media?: string }> | undefined) ?? []
  const pagbankPng =
    qrLinks.find((l) => String(l.rel ?? '').toUpperCase().includes('PNG'))?.href ??
    qrLinks.find((l) => String(l.media ?? '').includes('image'))?.href ??
    ''
  const orderId = String(parsed.id ?? '')
  if (!qrText) throw new Error('pagbank_no_pix_qr')

  // QR como data URI base64 (gerado do copia-e-cola): é o formato que o W-API aceita
  // para enviar como imagem. O link PNG do PagBank fica só na auditoria (pay_link).
  const qrImageUrl = await buildQrPngDataUri(qrText)

  try {
    await admin.from('pagbank_checkouts').insert({
      checkout_id: orderId || referenceId,
      tenant_id: args.tenantId,
      lead_id: args.lead.id,
      reference_id: referenceId,
      amount_cents: amountCents,
      kit: kitKey || null,
      pay_link: pagbankPng || `pix:${orderId || referenceId}`,
      status: 'created',
      coupon_code: coupon.applied ? coupon.code : null,
      discount_cents: coupon.discountCents,
      customer_name: customerName || null,
      phone: String(args.lead.phone ?? '').replace(/\D/g, '') || null,
      customer_doc: taxId || null,
    })
  } catch {
    // ignore (auditoria best-effort)
  }

  return {
    orderId,
    qrText,
    qrImageUrl,
    amountCents,
    label,
    referenceId,
    baseCents,
    discountCents: coupon.discountCents,
    couponCode: coupon.applied ? coupon.code : null,
    freightCents,
    env: cfg.env,
  }
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
