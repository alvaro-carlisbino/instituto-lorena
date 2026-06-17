import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction, recordAutoReceipt } from './crm.ts'
import { incrementCouponUse, quoteCoupon } from './coupons.ts'
import { blingCreateSaleOrder } from './bling.ts'
import { autoShipToCart } from './melhorEnvio.ts'

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

export type AsaasConfig = { apiKey: string; baseUrl: string; env: 'sandbox' | 'prod'; webhookToken: string }

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
function todayBrasilia(): string {
  // YYYY-MM-DD no fuso de Brasília (vencimento da cobrança = hoje).
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(new Date())
}

function parseAsaasConfig(cfg: Record<string, unknown>): AsaasConfig | null {
  const apiKey = String(cfg.apiKey ?? cfg.token ?? cfg.api_key ?? '').trim()
  if (!apiKey) return null
  const env: 'sandbox' | 'prod' = cfg.env === 'prod' || cfg.env === 'production' ? 'prod' : 'sandbox'
  const baseUrl = (String(cfg.base_url ?? '').trim() || ASAAS_BASE[env]).replace(/\/$/, '')
  const webhookToken = String(cfg.webhookToken ?? cfg.webhook_token ?? '').trim()
  return { apiKey, baseUrl, env, webhookToken }
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
  const phone = digits(args.phone)
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
  const installments = Math.max(1, Math.min(12, args.installments ?? 1))

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
    phone: digits(args.customer?.phone) || null,
    customer_doc: digits(args.customer?.cpf) || null,
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
  const phone = digits(args.holderInfo?.phone || intent.phone || '')
  const email = args.holderInfo?.email || leadCad.email || 'cliente@tricopill.com.br'
  const postalCode = digits(args.holderInfo?.postalCode || leadEnt.cep)
  const addressNumber = String(args.holderInfo?.addressNumber || leadEnt.numero || 'S/N').slice(0, 20)
  const customerId = await findOrCreateAsaasCustomer(cfg, {
    name: intent.customerName || args.card.holderName,
    cpfCnpj: cpf,
    phone,
    email,
  })
  const installments = Math.max(1, Math.min(12, args.installments ?? intent.installments ?? 1))
  const value = intent.amountCents / 100
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

  const customerId = await findOrCreateAsaasCustomer(cfg, {
    name: args.customer?.name,
    cpfCnpj: args.customer?.cpf,
    phone: args.customer?.phone,
    email: args.customer?.email,
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
    customer_name: args.customer?.name?.trim() || null,
    phone: digits(args.customer?.phone) || null,
    customer_doc: digits(args.customer?.cpf) || null,
    asaas_customer_id: customerId,
    asaas_payment_id: String(asaasId),
    pix_payload: qrText || null,
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

export type AsaasWebhookEvent = { event: string; asaasPaymentId: string | null; externalRef: string | null; paid: boolean }

/** Normaliza o corpo do webhook do Asaas. Eventos de pagamento: PAYMENT_CONFIRMED/RECEIVED. */
export function parseAsaasWebhook(payload: Record<string, unknown>): AsaasWebhookEvent {
  const event = String(payload.event ?? '').toUpperCase()
  const payment = (payload.payment ?? {}) as Record<string, unknown>
  const asaasPaymentId = payment.id ? String(payment.id) : null
  const externalRef = payment.externalReference ? String(payment.externalReference) : null
  const status = String(payment.status ?? '').toUpperCase()
  const paid =
    event === 'PAYMENT_CONFIRMED' ||
    event === 'PAYMENT_RECEIVED' ||
    status === 'CONFIRMED' ||
    status === 'RECEIVED' ||
    status === 'RECEIVED_IN_CASH'
  return { event, asaasPaymentId, externalRef, paid }
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
    note: `Comprovante automático Asaas (${method === 'pix' ? 'Pix' : 'cartão'}).`,
    autoData: {
      gateway: 'asaas',
      asaas_payment_id: p.asaas_payment_id ?? null,
      return_code: p.return_code ?? null,
      installments: Number(p.installments ?? 1),
      paid_at: new Date().toISOString(),
    },
  })

  if (!leadId) return
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
  if (kit) {
    try {
      const { data: blingRow } = await admin.from('tenant_integrations').select('bling').eq('tenant_id', blingTenant).maybeSingle()
      const blingCfg = ((blingRow as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
      if (blingCfg.auto_order_enabled === true) {
        const cad = (l.custom_fields?.cadastro ?? {}) as Record<string, string>
        const out = await blingCreateSaleOrder(admin, blingTenant, {
          kit,
          amountCents,
          customerName: String(cad.nomeCompleto || p.customer_name || l.patient_name || 'Cliente Tricopill').trim(),
          phone: l.phone ? String(l.phone) : (p.phone != null ? String(p.phone) : undefined),
          cpf: cad.cpf || (p.customer_doc != null ? String(p.customer_doc) : undefined),
          email: cad.email,
          dataNascimento: cad.dataNascimento,
          sexo: cad.sexo,
          entrega: ((l.custom_fields as Record<string, unknown> | undefined)?.entrega as {
            cep?: string; numero?: string; complemento?: string; bairro?: string; logradouro?: string; cidade?: string; uf?: string; delivery_mode?: string
          }) ?? undefined,
        })
        await admin.from('asaas_payments').update({ bling_order_id: out.orderId ?? null }).eq('id', localId)
        const nfeNote = out.nfe
          ? (out.nfe.transmitted
              ? ` · NF-e ${out.nfe.numero ? '#' + out.nfe.numero + ' ' : ''}transmitida ✅`
              : out.nfe.nfeId ? ` · NF-e gerada (rascunho${out.nfe.error ? ': ' + out.nfe.error : ''})` : ` · NF-e não emitida${out.nfe.error ? ': ' + out.nfe.error : ''}`)
          : ''
        await insertInteraction(admin, {
          leadId: l.id, patientName: String(l.patient_name ?? 'Cliente'), channel: 'system', direction: 'system', author: 'Bling',
          content: `📦 Pedido criado no Bling (#${out.orderId ?? '?'}, ${out.bottles} frascos).${nfeNote}`, tenantId: blingTenant,
        })
      }
    } catch (e) {
      await insertInteraction(admin, {
        leadId: l.id, patientName: String(l.patient_name ?? 'Cliente'), channel: 'system', direction: 'system', author: 'Bling',
        content: `⚠️ Não foi possível criar o pedido no Bling automaticamente: ${(e instanceof Error ? e.message : String(e)).slice(0, 180)}`, tenantId: blingTenant,
      })
    }
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
