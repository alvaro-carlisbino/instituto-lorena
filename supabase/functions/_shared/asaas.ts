import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction, recordAutoReceipt } from './crm.ts'
import { incrementCouponUse, quoteCoupon } from './coupons.ts'
import { blingCreateSaleOrder } from './bling.ts'
import { autoShipToCart } from './melhorEnvio.ts'
import { sendEmail } from './resend.ts'
import { sendSaleReceiptToGroup } from './saleReceipt.ts'

// Envia texto pelo WhatsApp (w-api) usando a linha ativa do tenant. Best-effort.
async function subSendWapi(admin: SupabaseClient, tenantId: string, phone: string, text: string): Promise<boolean> {
  const to = String(phone || '').replace(/\D/g, ''); if (to.length < 10) return false
  const full = to.startsWith('55') ? to : '55' + to
  try {
    const { data } = await admin.from('whatsapp_channel_instances').select('wapi_instance_id, wapi_token, wapi_base_url').eq('tenant_id', tenantId).eq('channel_provider', 'wapi').eq('active', true).limit(1).maybeSingle()
    const row = data as { wapi_instance_id?: string; wapi_token?: string; wapi_base_url?: string | null } | null
    const inst = row?.wapi_instance_id ? String(row.wapi_instance_id).trim() : ''; const tok = row?.wapi_token ? String(row.wapi_token).trim() : ''
    if (!inst || !tok) return false
    const base = ((row?.wapi_base_url ? String(row.wapi_base_url) : '').trim() || 'https://api.w-api.app/v1').replace(/\/$/, '')
    const res = await fetch(`${base}/message/send-text?instanceId=${encodeURIComponent(inst)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ phone: full, message: text }) })
    return res.ok
  } catch { return false }
}

/**
 * Asaas — gateway único (cartão + Pix). Config por polo em tenant_integrations.asaas:
 *   { apiKey, env: 'sandbox'|'prod', webhookToken?, base_url? }.
 * Auth: header `access_token: <apiKey>`. Docs: https://docs.asaas.com
 *
 * Fluxo (espelha o que existia em Rede/PagBank):
 *  • Cartão: cria uma cobrança LOCAL (asaas_payments, pending) e devolve /pagar/<id>. O cliente
 *    digita o cartão na nossa página; `chargeAsaasCard` cria a cobrança CREDIT_CARD no Asaas
 *    (tokenização no ato) e captura. O downstream (mover p/ Pago, Bling, comprovante, envio) roda
 *    no WEBHOOK do Asaas — fonte única de verdade p/ cartão E Pix.
 *  • Pix: cria a cobrança PIX no Asaas na hora, busca o QR (copia-e-cola + imagem) e manda inline.
 */

/**
 * Parcelamento COM JUROS (cliente paga) — fórmula Price (juros compostos por parcela).
 * 1x sempre à vista (sem juros). De 2x até `max`, o cliente paga o valor financiado.
 * Config por polo em tenant_integrations.asaas.installments:
 *   { max?: 12, monthlyPct?: 1.45, fixedCents?: 29, freeUpTo?: 1 }
 */
export type InstallmentCfg = { max: number; monthlyPct: number; fixedCents: number; freeUpTo: number }
export type AsaasConfig = {
  apiKey: string
  baseUrl: string
  env: 'sandbox' | 'prod'
  webhookToken: string
  installments: InstallmentCfg
}

// Regra da casa: parcelamento travado em até 3x, todas SEM juros (4x+ bloqueado).
// monthlyPct fica só como fallback caso um polo eleve `max` via override no banco.
// Override por polo em tenant_integrations.asaas.installments.
const DEFAULT_INSTALLMENTS: InstallmentCfg = { max: 3, monthlyPct: 1.49, fixedCents: 0, freeUpTo: 3 }

// Idempotência anti-cobrança-dupla: quando o cliente manda 2 mensagens seguidas e o z.ai está
// lento, dois flushes do MESMO lead rodam concorrentes e geram 2 cobranças iguais (caso Debora,
// 18/jun: 2 Pix R$594 com 23s). Antes de criar Pix/cartão, reaproveitamos uma cobrança PENDENTE
// do mesmo lead+método+valor(+parcelas) criada nesta janela.
const DEDUP_WINDOW_MS = 10 * 60 * 1000

/** Total cobrado do cliente p/ `n` parcelas (Price). n ≤ freeUpTo (e 1x) = sem juros. */
export function installmentTotalCents(baseCents: number, n: number, ic: InstallmentCfg): number {
  const parcels = Math.max(1, Math.round(n))
  if (parcels <= 1 || parcels <= ic.freeUpTo) return baseCents
  const i = ic.monthlyPct / 100
  if (!(i > 0)) return baseCents
  const coef = i / (1 - Math.pow(1 + i, -parcels)) // fator Price por parcela
  return Math.round(baseCents * coef * parcels) + Math.max(0, ic.fixedCents)
}

/** Tabela 1..max p/ exibir no checkout: {n, total, valor da parcela}. */
export function installmentPlan(baseCents: number, ic: InstallmentCfg): Array<{ n: number; totalCents: number; perCents: number }> {
  const out: Array<{ n: number; totalCents: number; perCents: number }> = []
  const max = Math.max(1, Math.min(21, Math.round(ic.max)))
  for (let n = 1; n <= max; n++) {
    const totalCents = installmentTotalCents(baseCents, n, ic)
    out.push({ n, totalCents, perCents: Math.round(totalCents / n) })
  }
  return out
}

const ASAAS_BASE = {
  sandbox: 'https://sandbox.asaas.com/api/v3',
  prod: 'https://api.asaas.com/v3',
}

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}
function digits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '')
}
/**
 * Telefone BR p/ o Asaas: SEM o DDI 55. O WhatsApp/W-API manda 55+DDD+número (12 ou 13
 * dígitos) e o Asaas trata o "55" como DDD, virando "(55) 4497-…". Aqui tiramos o 55 quando
 * o que sobra é um telefone local válido (10 ou 11 dígitos), preservando DDDs reais (ex.: 55 = RS).
 */
function brPhone(v: unknown): string {
  const d = digits(v)
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d.slice(2)
  return d
}
function todayBrasilia(): string {
  // YYYY-MM-DD no fuso de Brasília (vencimento da cobrança = hoje).
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(new Date())
}

function parseInstallmentCfg(raw: unknown): InstallmentCfg {
  const o = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown, fb: number) => {
    // Chave AUSENTE/vazia → usa o fallback (DEFAULT_INSTALLMENTS). Antes `v ?? ''` virava ''
    // → Number('')=0 → retornava 0 (não o fallback), e max/freeUpTo desabavam p/ 1 — era a
    // causa do link "sem parcelamento" mesmo com a config null no banco.
    if (v === undefined || v === null || v === '') return fb
    const n = Number(String(v).replace(',', '.'))
    return Number.isFinite(n) && n >= 0 ? n : fb
  }
  return {
    max: Math.max(1, Math.min(21, Math.round(num(o.max, DEFAULT_INSTALLMENTS.max)))),
    monthlyPct: num(o.monthlyPct ?? o.monthly_pct, DEFAULT_INSTALLMENTS.monthlyPct),
    fixedCents: Math.round(num(o.fixedCents ?? o.fixed_cents, DEFAULT_INSTALLMENTS.fixedCents)),
    freeUpTo: Math.max(1, Math.round(num(o.freeUpTo ?? o.free_up_to, DEFAULT_INSTALLMENTS.freeUpTo))),
  }
}

function parseAsaasConfig(cfg: Record<string, unknown>): AsaasConfig | null {
  const apiKey = String(cfg.apiKey ?? cfg.token ?? cfg.api_key ?? '').trim()
  if (!apiKey) return null
  const env: 'sandbox' | 'prod' = cfg.env === 'prod' || cfg.env === 'production' ? 'prod' : 'sandbox'
  const baseUrl = (String(cfg.base_url ?? '').trim() || ASAAS_BASE[env]).replace(/\/$/, '')
  const webhookToken = String(cfg.webhookToken ?? cfg.webhook_token ?? '').trim()
  const installments = parseInstallmentCfg(cfg.installments)
  return { apiKey, baseUrl, env, webhookToken, installments }
}

export async function readAsaasConfig(admin: SupabaseClient, tenantId: string): Promise<AsaasConfig | null> {
  const { data } = await admin.from('tenant_integrations').select('asaas').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { asaas?: Record<string, unknown> } | null)?.asaas ?? {}) as Record<string, unknown>
  return parseAsaasConfig(cfg)
}

type AsaasResponse = { ok: boolean; status: number; body: Record<string, unknown>; text: string }

async function asaasFetch(cfg: AsaasConfig, path: string, init?: RequestInit): Promise<AsaasResponse> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      access_token: cfg.apiKey,
      'User-Agent': 'InstitutoLorenaCRM',
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    body = { raw: text }
  }
  return { ok: res.ok, status: res.status, body, text }
}

/** Erro legível das respostas do Asaas ({ errors: [{ description }] }). */
function asaasError(r: AsaasResponse): string {
  const errs = (r.body?.errors as Array<{ description?: string }> | undefined) ?? []
  const desc = errs.map((e) => e.description).filter(Boolean).join('; ')
  return desc || r.text.slice(0, 200) || `http_${r.status}`
}

/** Cancela (deleta) uma assinatura no Asaas. */
export async function cancelAsaasSubscription(admin: SupabaseClient, tenantId: string, asaasSubId: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = await readAsaasConfig(admin, tenantId)
  if (!cfg) return { ok: false, error: 'asaas_nao_configurado' }
  const r = await asaasFetch(cfg, `/subscriptions/${encodeURIComponent(asaasSubId)}`, { method: 'DELETE' })
  return r.ok ? { ok: true } : { ok: false, error: asaasError(r) }
}

/** Pausa (INACTIVE) ou reativa (ACTIVE) uma assinatura no Asaas. */
export async function setAsaasSubscriptionStatus(admin: SupabaseClient, tenantId: string, asaasSubId: string, status: 'ACTIVE' | 'INACTIVE'): Promise<{ ok: boolean; error?: string }> {
  const cfg = await readAsaasConfig(admin, tenantId)
  if (!cfg) return { ok: false, error: 'asaas_nao_configurado' }
  const r = await asaasFetch(cfg, `/subscriptions/${encodeURIComponent(asaasSubId)}`, { method: 'PUT', body: JSON.stringify({ status }) })
  return r.ok ? { ok: true } : { ok: false, error: asaasError(r) }
}

export type AsaasChargeRow = { id: string; value: number; status: string; billingType: string; dueDate: string; paymentDate: string | null; invoiceUrl: string | null; receiptUrl: string | null }

/** Lista as cobranças (ciclos) de uma assinatura no Asaas. */
export async function listAsaasSubscriptionPayments(admin: SupabaseClient, tenantId: string, asaasSubId: string): Promise<AsaasChargeRow[]> {
  const cfg = await readAsaasConfig(admin, tenantId)
  if (!cfg) return []
  const r = await asaasFetch(cfg, `/payments?subscription=${encodeURIComponent(asaasSubId)}&limit=50`)
  if (!r.ok) return []
  const data = (r.body?.data ?? []) as Array<Record<string, unknown>>
  return data.map((p) => ({
    id: String(p.id ?? ''),
    value: Number(p.value ?? 0),
    status: String(p.status ?? ''),
    billingType: String(p.billingType ?? ''),
    dueDate: String(p.dueDate ?? ''),
    paymentDate: p.paymentDate ? String(p.paymentDate) : p.confirmedDate ? String(p.confirmedDate) : null,
    invoiceUrl: p.invoiceUrl ? String(p.invoiceUrl) : null,
    receiptUrl: p.transactionReceiptUrl ? String(p.transactionReceiptUrl) : null,
  }))
}

/** Testa a credencial (GET /myAccount). Usado no botão "Testar conexão". */
export async function asaasPing(cfg: AsaasConfig): Promise<{ ok: boolean; detail: string }> {
  const r = await asaasFetch(cfg, '/myAccount')
  if (r.ok) {
    const name = String((r.body as { name?: string }).name ?? (r.body as { email?: string }).email ?? 'conta Asaas')
    return { ok: true, detail: `Conectado: ${name} (${cfg.env})` }
  }
  return { ok: false, detail: asaasError(r) }
}

/** Busca por CPF/CNPJ; cria se não existir. Devolve o id do cliente no Asaas. */
export async function findOrCreateAsaasCustomer(
  cfg: AsaasConfig,
  args: { name?: string; cpfCnpj?: string; phone?: string; email?: string },
): Promise<string> {
  const doc = digits(args.cpfCnpj)
  if (doc) {
    const q = await asaasFetch(cfg, `/customers?cpfCnpj=${doc}`)
    const list = (q.body as { data?: Array<{ id?: string }> }).data
    if (Array.isArray(list) && list[0]?.id) return String(list[0].id)
  }
  const phone = brPhone(args.phone)
  const create = await asaasFetch(cfg, '/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: (args.name || 'Cliente').slice(0, 100),
      cpfCnpj: doc || undefined,
      mobilePhone: phone || undefined,
      email: args.email || undefined,
      notificationDisabled: true,
    }),
  })
  const id = (create.body as { id?: string }).id
  if (!create.ok || !id) throw new Error(`asaas_customer_fail: ${asaasError(create)}`)
  return String(id)
}

export type AsaasCustomerInput = { name?: string; cpf?: string; phone?: string; email?: string }

/** Cria a cobrança LOCAL de cartão (pending) e devolve a URL /pagar/<id>. */
export async function createAsaasCardIntent(
  admin: SupabaseClient,
  args: {
    tenantId: string
    amountCents: number
    description: string
    leadId?: string
    installments?: number
    appBaseUrl: string
    couponCode?: string
    freightCents?: number
    kit?: string
    customer?: AsaasCustomerInput
  },
): Promise<{ id: string; url: string; amountCents: number; baseCents: number; discountCents: number; couponCode: string | null; freightCents: number }> {
  const cfg = await readAsaasConfig(admin, args.tenantId)
  if (!cfg) throw new Error('asaas_nao_configurado')
  const baseCents = Math.round(args.amountCents)
  if (!Number.isFinite(baseCents) || baseCents < 500) throw new Error('asaas_valor_invalido')

  const coupon = await quoteCoupon(admin, args.tenantId, args.couponCode, baseCents)
  const freightCents = Math.max(0, Math.round(Number(args.freightCents ?? 0)))
  const amountCents = coupon.finalCents + freightCents
  const baseDesc = String(args.description ?? 'Pagamento').slice(0, 100)
  const description = freightCents > 0 ? `${baseDesc} + frete` : baseDesc
  // Sem `installments` explícito, o link nasce permitindo o MÁXIMO da config (o cliente
  // escolhe de 1x até o máximo no checkout). Default 1 fazia o link sair "sem parcelamento".
  const installments = Math.max(1, Math.min(cfg.installments.max, args.installments ?? cfg.installments.max))

  // Idempotência: reaproveita um link de cartão PENDENTE do mesmo lead+valor+parcelas recente.
  if (args.leadId) {
    const { data: dup } = await admin
      .from('asaas_payments')
      .select('id, discount_cents, coupon_code')
      .eq('lead_id', args.leadId).eq('method', 'card').eq('status', 'pending')
      .eq('amount_cents', amountCents).eq('installments', installments)
      .gte('created_at', new Date(Date.now() - DEDUP_WINDOW_MS).toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const dupRow = dup as { id?: string; discount_cents?: number; coupon_code?: string | null } | null
    if (dupRow?.id) {
      const base = args.appBaseUrl.replace(/\/$/, '')
      return {
        id: dupRow.id,
        url: `${base}/pagar/${dupRow.id}`,
        amountCents,
        baseCents,
        discountCents: dupRow.discount_cents ?? coupon.discountCents,
        couponCode: dupRow.coupon_code ?? (coupon.applied ? coupon.code : null),
        freightCents,
      }
    }
  }

  const id = shortId()
  await admin.from('asaas_payments').insert({
    id,
    tenant_id: args.tenantId,
    lead_id: args.leadId || null,
    method: 'card',
    amount_cents: amountCents,
    description: description.slice(0, 120),
    installments,
    kit: args.kit || null,
    coupon_code: coupon.applied ? coupon.code : null,
    discount_cents: coupon.discountCents,
    customer_name: args.customer?.name?.trim() || null,
    phone: brPhone(args.customer?.phone) || null,
    customer_doc: digits(args.customer?.cpf) || null,
    freight_cents: freightCents,
    status: 'pending',
  })
  const base = args.appBaseUrl.replace(/\/$/, '')
  return {
    id,
    url: `${base}/pagar/${id}`,
    amountCents,
    baseCents,
    discountCents: coupon.discountCents,
    couponCode: coupon.applied ? coupon.code : null,
    freightCents,
  }
}

export type AsaasCard = {
  holderName: string
  number: string
  expiryMonth: string
  expiryYear: string
  ccv: string
}

/** Lê a cobrança LOCAL (usada pelo checkout público /pagar). */
export async function getAsaasIntent(admin: SupabaseClient, id: string): Promise<
  | { id: string; tenantId: string; leadId: string | null; amountCents: number; description: string; installments: number; status: string; kit: string | null; couponCode: string | null; customerName: string | null; phone: string | null; customerDoc: string | null }
  | null
> {
  const { data } = await admin.from('asaas_payments').select('*').eq('id', id).maybeSingle()
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    leadId: r.lead_id != null ? String(r.lead_id) : null,
    amountCents: Number(r.amount_cents ?? 0),
    description: String(r.description ?? 'Pagamento'),
    installments: Number(r.installments ?? 1),
    status: String(r.status ?? 'pending'),
    kit: r.kit != null ? String(r.kit) : null,
    couponCode: r.coupon_code != null ? String(r.coupon_code) : null,
    customerName: r.customer_name != null ? String(r.customer_name) : null,
    phone: r.phone != null ? String(r.phone) : null,
    customerDoc: r.customer_doc != null ? String(r.customer_doc) : null,
  }
}

export type AsaasPayResult = { status: 'paid' | 'failed'; detail: string; asaasPaymentId: string | null }

/**
 * Cobra o cartão no Asaas (cria a cobrança CREDIT_CARD com os dados do cartão + holder + IP).
 * Captura na hora. O downstream (Pago/Bling/comprovante/envio) roda no webhook do Asaas.
 */
export async function chargeAsaasCard(
  admin: SupabaseClient,
  args: { id: string; card: AsaasCard; installments?: number; holderInfo?: { cpf?: string; postalCode?: string; addressNumber?: string; phone?: string; email?: string }; remoteIp?: string },
): Promise<AsaasPayResult> {
  const intent = await getAsaasIntent(admin, args.id)
  if (!intent) throw new Error('cobranca_nao_encontrada')
  if (intent.status === 'paid') return { status: 'paid', detail: 'Já pago', asaasPaymentId: null }
  const cfg = await readAsaasConfig(admin, intent.tenantId)
  if (!cfg) throw new Error('asaas_nao_configurado')

  // Holder info (CPF/CEP/número/e-mail) — o antifraude do Asaas exige no cartão. Prioriza o que
  // veio do checkout; completa com o cadastro/entrega do lead capturado na conversa.
  let leadCad: Record<string, string> = {}
  let leadEnt: Record<string, string> = {}
  if (intent.leadId) {
    const { data: lead } = await admin.from('leads').select('custom_fields').eq('id', intent.leadId).maybeSingle()
    const cf = ((lead as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>
    leadCad = (cf.cadastro ?? {}) as Record<string, string>
    leadEnt = (cf.entrega ?? {}) as Record<string, string>
  }
  const cpf = digits(args.holderInfo?.cpf || intent.customerDoc || leadCad.cpf)
  const phone = brPhone(args.holderInfo?.phone || intent.phone || '')
  const email = args.holderInfo?.email || leadCad.email || 'cliente@tricopill.com.br'
  const postalCode = digits(args.holderInfo?.postalCode || leadEnt.cep)
  const addressNumber = String(args.holderInfo?.addressNumber || leadEnt.numero || 'S/N').slice(0, 20)
  const customerId = await findOrCreateAsaasCustomer(cfg, {
    name: intent.customerName || args.card.holderName,
    cpfCnpj: cpf,
    phone,
    email,
  })
  const ic = cfg.installments
  const installments = Math.max(1, Math.min(ic.max, args.installments ?? intent.installments ?? 1))
  // COM JUROS (cliente paga): de 2x até o teto, o valor cobrado é o financiado (Price).
  const chargeCents = installmentTotalCents(intent.amountCents, installments, ic)
  const value = chargeCents / 100
  const payload: Record<string, unknown> = {
    customer: customerId,
    billingType: 'CREDIT_CARD',
    value,
    dueDate: todayBrasilia(),
    description: intent.description.slice(0, 500),
    externalReference: `asaas_payment:${intent.id}`,
    creditCard: {
      holderName: args.card.holderName.slice(0, 100),
      number: digits(args.card.number),
      expiryMonth: String(args.card.expiryMonth).padStart(2, '0'),
      expiryYear: String(args.card.expiryYear).length === 2 ? `20${args.card.expiryYear}` : String(args.card.expiryYear),
      ccv: digits(args.card.ccv),
    },
    creditCardHolderInfo: {
      name: (intent.customerName || args.card.holderName).slice(0, 100),
      email,
      cpfCnpj: cpf || undefined,
      postalCode: postalCode || undefined,
      addressNumber,
      phone: phone || undefined,
      mobilePhone: phone || undefined,
    },
    ...(installments > 1 ? { installmentCount: installments, totalValue: value } : {}),
    ...(args.remoteIp ? { remoteIp: args.remoteIp } : {}),
  }

  const r = await asaasFetch(cfg, '/payments', { method: 'POST', body: JSON.stringify(payload) })
  const asaasId = (r.body as { id?: string }).id ? String((r.body as { id?: string }).id) : null
  const apiStatus = String((r.body as { status?: string }).status ?? '')
  const approved = r.ok && (apiStatus === 'CONFIRMED' || apiStatus === 'RECEIVED' || apiStatus === 'RECEIVED_IN_CASH')

  // Grava IDs/retorno do Asaas. NÃO marca 'paid' aqui: a transição pending→paid (cupom,
  // comprovante, downstream) acontece UMA vez em finalizeAsaasPaid, evitando dupla contagem.
  await admin
    .from('asaas_payments')
    .update({
      asaas_customer_id: customerId,
      asaas_payment_id: asaasId,
      return_code: approved ? apiStatus : asaasError(r).slice(0, 200),
      ...(approved ? {} : { status: 'failed' }),
    })
    .eq('id', intent.id)

  // Cartão aprovado: roda o downstream JÁ (não dependemos do webhook chegar) — idempotente.
  if (approved) {
    await finalizeAsaasPaid(admin, intent.id)
  }
  return { status: approved ? 'paid' : 'failed', detail: approved ? 'ok' : asaasError(r), asaasPaymentId: asaasId }
}

/** Cria a cobrança PIX no Asaas, busca o QR (copia-e-cola + imagem) e grava a linha. */
export async function createAsaasPix(
  admin: SupabaseClient,
  args: {
    tenantId: string
    amountCents: number
    description: string
    leadId?: string
    couponCode?: string
    freightCents?: number
    kit?: string
    customer?: AsaasCustomerInput
  },
): Promise<{ id: string; asaasPaymentId: string; qrText: string; qrImageUrl: string; amountCents: number; baseCents: number; discountCents: number; couponCode: string | null }> {
  const cfg = await readAsaasConfig(admin, args.tenantId)
  if (!cfg) throw new Error('asaas_nao_configurado')
  const baseCents = Math.round(args.amountCents)
  if (!Number.isFinite(baseCents) || baseCents < 500) throw new Error('asaas_valor_invalido')

  const coupon = await quoteCoupon(admin, args.tenantId, args.couponCode, baseCents)
  const freightCents = Math.max(0, Math.round(Number(args.freightCents ?? 0)))
  const amountCents = coupon.finalCents + freightCents
  const baseDesc = String(args.description ?? 'Pagamento').slice(0, 100)
  const description = freightCents > 0 ? `${baseDesc} + frete` : baseDesc

  // Idempotência: reaproveita uma cobrança Pix PENDENTE do mesmo lead+valor recente (re-busca o
  // QR no Asaas). Evita 2ª cobrança quando o bot dispara 2x. Não precisa de CPF (a cobrança já existe).
  if (args.leadId) {
    const { data: dup } = await admin
      .from('asaas_payments')
      .select('id, asaas_payment_id, pix_payload, discount_cents, coupon_code')
      .eq('lead_id', args.leadId).eq('method', 'pix').eq('status', 'pending')
      .eq('amount_cents', amountCents)
      .gte('created_at', new Date(Date.now() - DEDUP_WINDOW_MS).toISOString())
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const dupRow = dup as { id?: string; asaas_payment_id?: string; pix_payload?: string | null; discount_cents?: number; coupon_code?: string | null } | null
    if (dupRow?.id && dupRow.asaas_payment_id) {
      const qr = await asaasFetch(cfg, `/payments/${dupRow.asaas_payment_id}/pixQrCode`)
      const qrText = String(dupRow.pix_payload || (qr.body as { payload?: string }).payload || '')
      const encoded = String((qr.body as { encodedImage?: string }).encodedImage ?? '')
      return {
        id: dupRow.id,
        asaasPaymentId: String(dupRow.asaas_payment_id),
        qrText,
        qrImageUrl: encoded ? `data:image/png;base64,${encoded}` : '',
        amountCents,
        baseCents,
        discountCents: dupRow.discount_cents ?? coupon.discountCents,
        couponCode: dupRow.coupon_code ?? (coupon.applied ? coupon.code : null),
      }
    }
  }

  // Asaas EXIGE CPF/CNPJ na cobrança Pix. Se o caller não mandou (ex.: painel sem digitar),
  // completa com o cadastro do lead (nome/CPF/telefone/e-mail) — espelha o chargeAsaasCard.
  let leadCad: Record<string, string> = {}
  if (args.leadId) {
    const { data: lead } = await admin.from('leads').select('custom_fields, patient_name, phone').eq('id', args.leadId).maybeSingle()
    const l = lead as { custom_fields?: Record<string, unknown>; patient_name?: string; phone?: string } | null
    leadCad = ((l?.custom_fields?.cadastro ?? {}) as Record<string, string>)
    if (!leadCad.nomeCompleto && l?.patient_name) leadCad.nomeCompleto = l.patient_name
    if (!leadCad.telefone && l?.phone) leadCad.telefone = l.phone
  }
  const pixCpf = digits(args.customer?.cpf || leadCad.cpf)
  if (!pixCpf) throw new Error('asaas_pix_fail: informe o CPF ou CNPJ do cliente (o Asaas exige na cobrança Pix).')
  const customerId = await findOrCreateAsaasCustomer(cfg, {
    name: args.customer?.name || leadCad.nomeCompleto,
    cpfCnpj: pixCpf,
    phone: digits(args.customer?.phone || leadCad.telefone),
    email: args.customer?.email || leadCad.email,
  })
  const id = shortId()
  const create = await asaasFetch(cfg, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: customerId,
      billingType: 'PIX',
      value: amountCents / 100,
      dueDate: todayBrasilia(),
      description: description.slice(0, 500),
      externalReference: `asaas_payment:${id}`,
    }),
  })
  const asaasId = (create.body as { id?: string }).id
  if (!create.ok || !asaasId) throw new Error(`asaas_pix_fail: ${asaasError(create)}`)

  const qr = await asaasFetch(cfg, `/payments/${asaasId}/pixQrCode`)
  const qrText = String((qr.body as { payload?: string }).payload ?? '')
  const encoded = String((qr.body as { encodedImage?: string }).encodedImage ?? '')
  const qrImageUrl = encoded ? `data:image/png;base64,${encoded}` : ''

  await admin.from('asaas_payments').insert({
    id,
    tenant_id: args.tenantId,
    lead_id: args.leadId || null,
    method: 'pix',
    amount_cents: amountCents,
    description: description.slice(0, 120),
    installments: 1,
    kit: args.kit || null,
    coupon_code: coupon.applied ? coupon.code : null,
    discount_cents: coupon.discountCents,
    customer_name: (args.customer?.name?.trim() || leadCad.nomeCompleto || null),
    phone: brPhone(args.customer?.phone || leadCad.telefone) || null,
    customer_doc: pixCpf || null,
    asaas_customer_id: customerId,
    asaas_payment_id: String(asaasId),
    pix_payload: qrText || null,
    freight_cents: freightCents,
    status: 'pending',
  })

  return {
    id,
    asaasPaymentId: String(asaasId),
    qrText,
    qrImageUrl,
    amountCents,
    baseCents,
    discountCents: coupon.discountCents,
    couponCode: coupon.applied ? coupon.code : null,
  }
}

export type AsaasWebhookEvent = { event: string; asaasPaymentId: string | null; externalRef: string | null; subscriptionId: string | null; paid: boolean }

/** Normaliza o corpo do webhook do Asaas. Eventos de pagamento: PAYMENT_CONFIRMED/RECEIVED. */
export function parseAsaasWebhook(payload: Record<string, unknown>): AsaasWebhookEvent {
  const event = String(payload.event ?? '').toUpperCase()
  const payment = (payload.payment ?? {}) as Record<string, unknown>
  const asaasPaymentId = payment.id ? String(payment.id) : null
  const externalRef = payment.externalReference ? String(payment.externalReference) : null
  // Pagamento gerado por uma ASSINATURA carrega o id da assinatura (sub_*).
  const subscriptionId = payment.subscription ? String(payment.subscription) : null
  const status = String(payment.status ?? '').toUpperCase()
  const paid =
    event === 'PAYMENT_CONFIRMED' ||
    event === 'PAYMENT_RECEIVED' ||
    status === 'CONFIRMED' ||
    status === 'RECEIVED' ||
    status === 'RECEIVED_IN_CASH'
  return { event, asaasPaymentId, externalRef, subscriptionId, paid }
}

/**
 * Downstream de um CICLO de ASSINATURA pago (idempotente — chamado 1x por pagamento do ciclo).
 * Incrementa paid_cycles, grava comprovante, e — se for ciclo de ENVIO conforme a cadência —
 * cria o pedido no Bling (qtd exata de frascos) e monta o envio no Melhor Envio.
 *  • mensal     -> envia todo ciclo (1 frasco).
 *  • trimestral -> envia nos ciclos 1, 4, 7… (3 frascos).
 * `localSubId` = asaas_subscriptions.id; `asaasPaymentId` = id do pagamento do ciclo (Asaas).
 */
export async function finalizeSubscriptionCycle(admin: SupabaseClient, localSubId: string, asaasPaymentId: string | null): Promise<void> {
  const { data } = await admin.from('asaas_subscriptions').select('*').eq('id', localSubId).maybeSingle()
  if (!data) return
  const s = data as Record<string, unknown>
  const tenantId = String(s.tenant_id ?? 'tricopill')
  const cadence = String(s.cadence ?? 'mensal')
  const unitsPerShipment = Number(s.units_per_shipment ?? 1) || 1
  const unitPriceCents = Number(s.unit_price_cents ?? 15000) || 15000
  const monthlyValueCents = Number(s.monthly_value_cents ?? 0)
  const leadId = s.lead_id != null ? String(s.lead_id) : ''
  const entrega = (s.entrega ?? {}) as Record<string, unknown>
  const cycle = (Number(s.paid_cycles ?? 0) || 0) + 1

  // Marca o ciclo como pago + reativa a assinatura se estava em atraso.
  await admin.from('asaas_subscriptions').update({ paid_cycles: cycle, status: 'active', updated_at: new Date().toISOString() }).eq('id', localSubId)

  // Comprovante automático do ciclo (idempotente pelo payment_id).
  await recordAutoReceipt(admin, {
    tenantId,
    paymentId: asaasPaymentId || `${localSubId}:cycle:${cycle}`,
    paymentMethod: 'card',
    amountCents: monthlyValueCents,
    customerName: s.customer_name != null ? String(s.customer_name) : undefined,
    note: `Assinatura Tricopill — ciclo ${cycle} (${cadence}).`,
    autoData: { gateway: 'asaas', subscription_local_id: localSubId, asaas_subscription_id: s.asaas_subscription_id ?? null, cycle, cadence },
  })

  // Comprovante do ciclo no grupo do financeiro (best-effort).
  await sendSaleReceiptToGroup(admin, {
    tenantId: 'tricopill',
    paymentId: asaasPaymentId || `${localSubId}:cycle:${cycle}`,
    gateway: 'Asaas',
    method: 'card',
    amountCents: monthlyValueCents,
    produto: `Assinatura Tricopill (${unitsPerShipment} frasco${unitsPerShipment > 1 ? 's' : ''}/envio, ${cadence})`,
    transactionId: asaasPaymentId,
    buyer: {
      name: s.customer_name != null ? String(s.customer_name) : null,
      cpf: s.customer_doc != null ? String(s.customer_doc) : null,
      phone: s.phone != null ? String(s.phone) : null,
      email: s.email != null ? String(s.email) : null,
      entrega: { ...entrega, delivery_mode: 'envio_externo' },
    },
    origem: `Assinatura — ciclo ${cycle} (${cadence})`,
  })

  // Lead sintético a partir da assinatura (garante endereço p/ Bling + Melhor Envio mesmo sem lead real).
  const synthLead = {
    id: leadId || `sub-${localSubId}`,
    patient_name: s.customer_name != null ? String(s.customer_name) : 'Assinante Tricopill',
    phone: s.phone != null ? String(s.phone) : null,
    custom_fields: {
      cadastro: { nomeCompleto: s.customer_name ?? 'Assinante Tricopill', cpf: s.customer_doc ?? undefined, email: s.email ?? undefined },
      entrega: { ...entrega, delivery_mode: 'envio_externo' },
    },
  }

  if (leadId) {
    await insertInteraction(admin, {
      leadId, patientName: String(synthLead.patient_name), channel: 'system', direction: 'system', author: 'Asaas',
      content: `🔁 Assinatura — ciclo ${cycle} pago (${(monthlyValueCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`,
      tenantId,
    }).catch(() => {})
  }

  // Decide se ESTE ciclo envia produto.
  const ships = cadence === 'trimestral' ? ((cycle - 1) % 3 === 0) : true

  // Confirmação ao cliente (WhatsApp + e-mail) — renovação paga + status do envio. Best-effort.
  try {
    const nome = String(s.customer_name ?? '').trim().split(/\s+/).filter(Boolean)[0] || 'tudo bem'
    const valorBRL = (monthlyValueCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    const un = Number(s.units_per_shipment ?? 1) || 1
    const envioTxt = ships
      ? `📦 Seu novo envio (${un} frasco${un > 1 ? 's' : ''}) já está sendo preparado — você recebe o código de rastreio em breve.`
      : 'Seu próximo envio é no próximo ciclo. 💚'
    await subSendWapi(admin, tenantId, String(s.phone ?? ''), `Olá ${nome}! ✅ Renovação da sua *assinatura Tricopill* confirmada (${valorBRL}).\n\n${envioTxt}\n\nObrigado por fazer parte do clube! Qualquer dúvida, é só responder. 💚`)
    const email = String(s.email ?? '').trim()
    if (email) {
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1e1e1e;line-height:1.5"><h2 style="color:#14362E">Assinatura renovada ✅</h2><p>Olá ${nome}!</p><p>Recebemos a renovação da sua assinatura Tricopill — <b>${valorBRL}</b>.</p><p>${ships ? `Seu novo envio (${un} frasco${un > 1 ? 's' : ''}) está sendo preparado; o código de rastreio chega em breve.` : 'Seu próximo envio é no próximo ciclo.'}</p><p>Obrigado por fazer parte do clube! 💚</p></div>`
      await sendEmail({ to: email, subject: 'Assinatura Tricopill renovada', html })
    }
  } catch { /* best-effort: notificação nunca derruba o ciclo */ }

  if (!ships) return

  const shipUnits = unitsPerShipment
  const shipFreightCents = Math.max(0, Math.round(Number(s.freight_cents) || 0))
  const shipProductCents = shipUnits * unitPriceCents
  const shipValueCents = shipProductCents + shipFreightCents // total (produto + frete); blingCreateSaleOrder põe o frete em transporte.frete
  const blingTenant = 'tricopill'
  try {
    const out = await blingCreateSaleOrder(admin, blingTenant, {
      kit: '',
      bottlesOverride: shipUnits,
      amountCents: shipValueCents,
      freightCents: shipFreightCents,
      description: `Assinatura Tricopill (${shipUnits} ${shipUnits === 1 ? 'frasco' : 'frascos'}) — ciclo ${cycle}`,
      customerName: s.customer_name != null ? String(s.customer_name) : undefined,
      phone: s.phone != null ? String(s.phone) : undefined,
      cpf: s.customer_doc != null ? String(s.customer_doc) : undefined,
      email: s.email != null ? String(s.email) : undefined,
      entrega: { ...entrega, delivery_mode: 'envio_externo' } as Record<string, string>,
    })
    if (leadId) {
      await insertInteraction(admin, {
        leadId, patientName: String(synthLead.patient_name), channel: 'system', direction: 'system', author: 'Bling',
        content: `📦 Assinatura: pedido criado no Bling (#${out.orderId ?? '?'}, ${out.bottles} frascos) — ciclo ${cycle}.`,
        tenantId: blingTenant,
      }).catch(() => {})
    }
  } catch (e) {
    if (leadId) {
      await insertInteraction(admin, {
        leadId, patientName: String(synthLead.patient_name), channel: 'system', direction: 'system', author: 'Bling',
        content: `⚠️ Assinatura: não criou o pedido no Bling automaticamente (ciclo ${cycle}): ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`,
        tenantId: blingTenant,
      }).catch(() => {})
    }
  }

  // Envio automático no Melhor Envio (best-effort).
  try {
    await autoShipToCart(admin, blingTenant, {
      lead: synthLead,
      kit: null,
      productName: `Tricopill assinatura (${shipUnits}x)`,
      productValueCents: shipValueCents,
    })
  } catch { /* best-effort */ }

  await admin.from('asaas_subscriptions').update({ last_shipped_cycle: cycle, updated_at: new Date().toISOString() }).eq('id', localSubId)
}

/**
 * Downstream de venda paga (idempotente): marca a linha paid, conta cupom, comprovante
 * automático, move o lead p/ "Pago", cria pedido no Bling e monta o envio no Melhor Envio.
 * Chamado pelo webhook (Pix e cartão) e direto no cartão aprovado. `localId` = asaas_payments.id.
 */
export async function finalizeAsaasPaid(admin: SupabaseClient, localId: string): Promise<void> {
  const { data } = await admin.from('asaas_payments').select('*').eq('id', localId).maybeSingle()
  if (!data) return
  const p = data as Record<string, unknown>
  const tenantId = String(p.tenant_id ?? '')
  const method = String(p.method ?? 'card') === 'pix' ? 'pix' : 'card'
  const amountCents = Number(p.amount_cents ?? 0)
  const leadId = p.lead_id != null ? String(p.lead_id) : ''
  const kit = p.kit != null ? String(p.kit) : ''
  // wasPaid = já transitou antes (webhook repetido / cartão já finalizado): downstream NÃO repete.
  const wasPaid = String(p.status) === 'paid'

  // Transição pending→paid: marca pago + conta cupom (UMA vez).
  if (!wasPaid) {
    await admin.from('asaas_payments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', localId)
    if (p.coupon_code) await incrementCouponUse(admin, tenantId, String(p.coupon_code))
  }

  // Comprovante automático (idempotente pelo índice parcial — pode rodar em repetições).
  await recordAutoReceipt(admin, {
    tenantId,
    paymentId: localId,
    paymentMethod: method as 'card' | 'pix',
    amountCents,
    customerName: p.customer_name != null ? String(p.customer_name) : undefined,
    note: `Comprovante automático Asaas (${method === 'pix' ? 'Pix' : 'cartão'}).`,
    autoData: {
      gateway: 'asaas',
      asaas_payment_id: p.asaas_payment_id ?? null,
      return_code: p.return_code ?? null,
      installments: Number(p.installments ?? 1),
      paid_at: new Date().toISOString(),
    },
  })

  if (!leadId) {
    // Comprovante no grupo do financeiro só na TRANSIÇÃO p/ pago (webhook repetido não duplica).
    if (!wasPaid) {
      await sendSaleReceiptToGroup(admin, {
        tenantId: kit ? 'tricopill' : tenantId,
        paymentId: localId,
        gateway: 'Asaas',
        method: method as 'card' | 'pix',
        installments: method === 'card' ? Number(p.installments ?? 1) : undefined,
        amountCents,
        freightCents: Math.max(0, Math.round(Number(p.freight_cents ?? 0))),
        discountCents: Math.max(0, Math.round(Number(p.discount_cents ?? 0))),
        couponCode: p.coupon_code != null ? String(p.coupon_code) : null,
        produto: p.description != null ? String(p.description) : (kit ? `Tricopill (${kit})` : null),
        blingOrderId: p.bling_order_id != null ? String(p.bling_order_id) : null,
        transactionId: p.asaas_payment_id != null ? String(p.asaas_payment_id) : null,
        buyer: {
          name: p.customer_name != null ? String(p.customer_name) : null,
          cpf: p.customer_doc != null ? String(p.customer_doc) : null,
          phone: p.phone != null ? String(p.phone) : null,
        },
        origem: 'Cobrança avulsa (sem lead)',
      })
    }
    return
  }
  const { data: lead } = await admin
    .from('leads')
    .select('id, patient_name, pipeline_id, tenant_id, phone, custom_fields')
    .eq('id', leadId)
    .maybeSingle()
  const l = lead as {
    id: string; patient_name?: string; pipeline_id?: string; tenant_id?: string; phone?: string
    custom_fields?: { cadastro?: Record<string, string> }
  } | null
  if (!l) return

  // Move p/ a etapa "Pago" do pipeline do lead (sem chutar etapa fixa).
  let pagoStageId: string | null = null
  if (l.pipeline_id) {
    const { data: stage } = await admin
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', l.pipeline_id)
      .ilike('name', 'pago%')
      .maybeSingle()
    if (stage?.id) pagoStageId = String(stage.id)
  }
  const leadUpdate: Record<string, unknown> = { temperature: 'hot', updated_at: new Date().toISOString() }
  if (pagoStageId) leadUpdate.stage_id = pagoStageId
  await admin.from('leads').update(leadUpdate).eq('id', l.id)

  // Downstream (interação de confirmação + Bling + envio) roda só na TRANSIÇÃO para pago.
  // Confirmações repetidas do Asaas (PAYMENT_CONFIRMED depois PAYMENT_RECEIVED) não duplicam.
  if (wasPaid) return

  await insertInteraction(admin, {
    leadId: l.id,
    patientName: String(l.patient_name ?? 'Cliente'),
    channel: 'system',
    direction: 'system',
    author: 'Asaas',
    content: `💳 Pagamento ${method === 'pix' ? 'Pix' : 'no cartão'} confirmado (Asaas). ${(amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
    tenantId: String(l.tenant_id ?? tenantId),
  })

  // KIT = produto Tricopill → Bling/ME vivem no tenant 'tricopill'.
  const blingTenant = kit ? 'tricopill' : String(l.tenant_id ?? tenantId)
  // Cria pedido no Bling para KITS Tricopill E para vendas avulsas/carrinho do tenant 'tricopill'.
  // (Antes só criava quando havia `kit`; compras pelo carrinho salvam kit=null e nunca iam pro Bling.)
  const shouldCreateBlingOrder = !!kit || blingTenant === 'tricopill'
  let receiptBlingId = p.bling_order_id != null ? String(p.bling_order_id) : null
  if (shouldCreateBlingOrder) {
    try {
      const { data: blingRow } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', blingTenant).maybeSingle()
      const blingCfg = ((blingRow as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
      if (blingCfg.auto_order_enabled === true) {
        const cad = (l.custom_fields?.cadastro ?? {}) as Record<string, string>
        const out = await blingCreateSaleOrder(admin, blingTenant, {
          kit,
          amountCents,
          // Venda avulsa/carrinho (sem kit): descrição livre p/ o pedido sair como 1 item pelo valor cheio.
          description: kit ? undefined : String(p.description ?? l.patient_name ?? 'Pedido Tricopill').trim(),
          customerName: String(cad.nomeCompleto || p.customer_name || l.patient_name || 'Cliente Tricopill').trim(),
          phone: l.phone ? String(l.phone) : (p.phone != null ? String(p.phone) : undefined),
          cpf: cad.cpf || (p.customer_doc != null ? String(p.customer_doc) : undefined),
          email: cad.email,
          dataNascimento: cad.dataNascimento,
          sexo: cad.sexo,
          entrega: ((l.custom_fields as Record<string, unknown> | undefined)?.entrega as {
            cep?: string; numero?: string; complemento?: string; bairro?: string; logradouro?: string; cidade?: string; uf?: string; delivery_mode?: string
          }) ?? undefined,
          saleDateISO: (p.paid_at != null ? String(p.paid_at) : (p.created_at != null ? String(p.created_at) : undefined)),
        })
        await admin.from('asaas_payments').update({ bling_order_id: out.orderId ?? null }).eq('id', localId)
        receiptBlingId = out.orderId ?? null
        const nfeNote = out.nfe
          ? (out.nfe.transmitted
              ? ` · NF-e ${out.nfe.numero ? '#' + out.nfe.numero + ' ' : ''}transmitida ✅`
              : out.nfe.nfeId ? ` · NF-e gerada (rascunho${out.nfe.error ? ': ' + out.nfe.error : ''})` : ` · NF-e não emitida${out.nfe.error ? ': ' + out.nfe.error : ''}`)
          : ''
        const fbNote = out.contatoFallback
          ? ` · ⚠️ saiu no contato GENÉRICO (não foi possível registrar ${String(cad.nomeCompleto || p.customer_name || l.patient_name || 'o cliente').trim()} no Bling) — corrigir o cadastro/contato do pedido manualmente`
          : ''
        await insertInteraction(admin, {
          leadId: l.id, patientName: String(l.patient_name ?? 'Cliente'), channel: 'system', direction: 'system', author: 'Bling',
          content: `📦 Pedido criado no Bling (#${out.orderId ?? '?'}, ${out.bottles} frascos).${nfeNote}${fbNote}`, tenantId: blingTenant,
        })
      }
    } catch (e) {
      await insertInteraction(admin, {
        leadId: l.id, patientName: String(l.patient_name ?? 'Cliente'), channel: 'system', direction: 'system', author: 'Bling',
        content: `⚠️ Não foi possível criar o pedido no Bling automaticamente: ${(e instanceof Error ? e.message : String(e)).slice(0, 180)}`, tenantId: blingTenant,
      })
    }
  }

  // Comprovante da venda no grupo do financeiro (best-effort, só na transição p/ pago).
  {
    const cadR = (l.custom_fields?.cadastro ?? {}) as Record<string, string>
    const entR = ((l.custom_fields as Record<string, unknown> | undefined)?.entrega ?? {}) as Record<string, unknown>
    await sendSaleReceiptToGroup(admin, {
      tenantId: blingTenant,
      paymentId: localId,
      gateway: 'Asaas',
      method: method as 'card' | 'pix',
      installments: method === 'card' ? Number(p.installments ?? 1) : undefined,
      amountCents,
      freightCents: Math.max(0, Math.round(Number(p.freight_cents ?? 0))),
      discountCents: Math.max(0, Math.round(Number(p.discount_cents ?? 0))),
      couponCode: p.coupon_code != null ? String(p.coupon_code) : null,
      produto: p.description != null ? String(p.description) : (kit ? `Tricopill (${kit})` : null),
      blingOrderId: receiptBlingId,
      transactionId: p.asaas_payment_id != null ? String(p.asaas_payment_id) : null,
      buyer: {
        name: cadR.nomeCompleto || (p.customer_name != null ? String(p.customer_name) : null) || l.patient_name,
        cpf: cadR.cpf || (p.customer_doc != null ? String(p.customer_doc) : null),
        phone: l.phone || (p.phone != null ? String(p.phone) : null),
        email: cadR.email,
        entrega: entR,
      },
    })
  }

  // Envio automático no Melhor Envio (carrinho; best-effort).
  try {
    const ship = await autoShipToCart(admin, blingTenant, {
      lead: { id: l.id, patient_name: l.patient_name, phone: l.phone, custom_fields: l.custom_fields },
      kit: kit || null,
      productName: kit ? `Tricopill (${kit})` : 'Tricopill',
      productValueCents: amountCents,
    })
    if (ship.ok || ship.skipped || ship.reason) {
      const ent = ((l.custom_fields as Record<string, unknown> | undefined)?.entrega ?? {}) as Record<string, unknown>
      const ster = (v: unknown) => String(v ?? '').trim()
      const endLinha = [
        [ster(ent.logradouro), ster(ent.numero)].filter(Boolean).join(', '),
        ster(ent.complemento), ster(ent.bairro), [ster(ent.cidade), ster(ent.uf)].filter(Boolean).join('/'),
      ].filter(Boolean).join(' - ')
      let content = ''
      let author = 'Melhor Envio'
      // Persiste o id do pedido ME no pagamento (base p/ rastreio automático futuro).
      if (ship.ok && ship.cartId) {
        await admin.from('asaas_payments').update({ me_order_id: ship.cartId }).eq('id', localId).then(() => {}, () => {})
      }
      if (ship.ok) content = `📦 Envio no carrinho do Melhor Envio (#${ship.cartId}). Finalize a compra no painel.`
      else if (ship.reason === 'entrega_local_maringa') { author = 'Logística'; content = `🛵 ENTREGA LOCAL (equipe) — entregar em: ${endLinha || 'endereço a confirmar'}.` }
      else if (ship.reason === 'retirada_clinica') { author = 'Logística'; content = `🏥 RETIRADA NA CLÍNICA — cliente vai buscar.` }
      else content = `📦 Envio NÃO gerado automaticamente (${ship.reason}).`
      await insertInteraction(admin, { leadId: l.id, patientName: String(l.patient_name ?? 'Cliente'), channel: 'system', direction: 'system', author, content, tenantId: blingTenant })
    }
  } catch {
    // best-effort
  }
}
