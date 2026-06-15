import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from './crm.ts'
import { normalizeKitKey } from './pagbank.ts'
import { incrementCouponUse, quoteCoupon } from './coupons.ts'
import { blingCreateSaleOrder } from './bling.ts'

/**
 * Kits do Tricopill no CARTÃO (e.Rede) — preço CHEIO, sem o desconto de 5% do Pix.
 * Espelha REDE_KIT_AMOUNTS do frontend (PaymentLinksPage). amountCents em centavos.
 */
export const REDE_KITS: Record<string, { label: string; amountCents: number; qty: number }> = {
  '1_mes': { label: 'Tricopill — 1 frasco (1 mês)', amountCents: 19900, qty: 1 },
  '3_meses': { label: 'Tricopill — 3 frascos (3 meses) + 1 grátis', amountCents: 59700, qty: 3 },
  '5_meses': { label: 'Tricopill — 5 frascos (5 meses)', amountCents: 99900, qty: 5 },
}

/**
 * Parcelamento MÁXIMO no cartão por kit (regra Ingrid 15/jun): só parcela ACIMA de 3
 * frascos, em até 3x sem juros. 1 frasco = só à vista (1x) ou Pix. Kits 3_meses (3+1=4
 * frascos) e 5_meses (5) parcelam até 3x. Aplicado no createRedeIntent (a IA não decide).
 */
export const REDE_KIT_MAX_INSTALLMENTS: Record<string, number> = { '1_mes': 1, '3_meses': 3, '5_meses': 3 }

/** Resolve um kit do cartão a partir de uma variação ('3 meses', 'kit3'…). */
export function resolveRedeKit(raw: string): { key: string; label: string; amountCents: number } | null {
  const key = normalizeKitKey(raw)
  const kit = key ? REDE_KITS[key] : undefined
  return kit && key ? { key, label: kit.label, amountCents: kit.amountCents } : null
}

/**
 * e.Rede — transação por CARTÃO (OAuth 2.0 Bearer + v2).
 * Fluxo: o CRM cria uma "cobrança" (rede_payments) e devolve /pagar/<id>; o cliente
 * abre, digita o cartão, e crm-rede-pay autoriza+captura na e.Rede.
 * Config por polo em tenant_integrations.rede: { pv, token, env? } onde
 *   pv    = clientId    (Filiação / PV)
 *   token = clientSecret (Chave de Integração)
 * Auth: clientId+clientSecret -> POST oauth2/token (Basic, grant_type=client_credentials)
 * -> access_token (Bearer, ~24min) -> POST .../v2/transactions com Authorization: Bearer.
 *
 * ATENÇÃO PCI: coletar o cartão na nossa página = escopo PCI. OK para sandbox/teste;
 * para produção com cartão real, migrar para tokenização da Rede (cartão não trafega
 * pelo nosso servidor).
 */

// URLs oficiais e.Rede (confirmadas na doc logada developer.userede.com.br/e-rede).
const REDE_ENDPOINTS = {
  sandbox: {
    token: 'https://rl7-sandbox-api.useredecloud.com.br/oauth2/token',
    tx: 'https://sandbox-erede.useredecloud.com.br/v2/transactions',
  },
  prod: {
    token: 'https://api.userede.com.br/redelabs/oauth2/token',
    tx: 'https://api.userede.com.br/erede/v2/transactions',
  },
} as const

export type RedeConfig = {
  clientId: string
  clientSecret: string
  env: 'sandbox' | 'prod'
  tokenUrl: string
  txUrl: string
}

export async function readRedeConfig(admin: SupabaseClient, tenantId: string): Promise<RedeConfig | null> {
  if (!tenantId) return null
  const { data } = await admin.from('tenant_integrations').select('rede').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { rede?: Record<string, unknown> } | null)?.rede ?? {}) as Record<string, unknown>
  // pv = clientId (Filiação) ; token = clientSecret (Chave de Integração)
  const clientId = typeof cfg.pv === 'string' ? cfg.pv.trim() : ''
  const clientSecret = typeof cfg.token === 'string' ? cfg.token.trim() : ''
  if (!clientId || !clientSecret) return null
  const env: 'sandbox' | 'prod' = cfg.env === 'prod' ? 'prod' : 'sandbox'
  const ep = REDE_ENDPOINTS[env]
  const tokenUrl = (typeof cfg.token_url === 'string' && cfg.token_url.trim() ? cfg.token_url.trim() : ep.token).replace(/\/$/, '')
  const txUrl = (typeof cfg.tx_url === 'string' && cfg.tx_url.trim() ? cfg.tx_url.trim() : ep.tx).replace(/\/$/, '')
  return { clientId, clientSecret, env, tokenUrl, txUrl }
}

// Cache do access_token por (env+clientId), reusado enquanto o isolate estiver quente.
const redeTokenCache = new Map<string, { token: string; expiresAt: number }>()

/** Gera (ou reusa) o access_token OAuth 2.0 (client_credentials). */
async function getRedeAccessToken(cfg: RedeConfig): Promise<string> {
  const key = `${cfg.env}:${cfg.clientId}`
  const now = Date.now()
  const cached = redeTokenCache.get(key)
  if (cached && cached.expiresAt - 60_000 > now) return cached.token

  const basic = btoa(`${cfg.clientId}:${cfg.clientSecret}`)
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }
  const token = typeof parsed.access_token === 'string' ? parsed.access_token : ''
  if (!res.ok || !token) {
    const detail = String(parsed.error_description ?? parsed.error ?? text.slice(0, 140))
    throw new Error(`rede_oauth_falhou:${res.status}:${detail}`)
  }
  const expiresInSec = Number(parsed.expires_in) > 0 ? Number(parsed.expires_in) : 1440 // ~24min
  redeTokenCache.set(key, { token, expiresAt: now + expiresInSec * 1000 })
  return token
}

export type RedeIntent = {
  id: string
  tenantId: string
  leadId: string | null
  amountCents: number
  description: string
  installments: number
  status: string
  couponCode: string | null
  kit: string | null
  blingOrderId: string | null
}

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

/** Cria uma cobrança e devolve a URL do checkout (/pagar/<id>). */
export async function createRedeIntent(
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
  },
): Promise<{ id: string; url: string; amountCents: number; baseCents: number; discountCents: number; couponCode: string | null; freightCents: number }> {
  const cfg = await readRedeConfig(admin, args.tenantId)
  if (!cfg) throw new Error('rede_nao_configurado')
  const baseCents = Math.round(args.amountCents)
  if (!Number.isFinite(baseCents) || baseCents < 100) throw new Error('rede_valor_invalido')

  // Cupom (best-effort): inválido → valor cheio.
  const coupon = await quoteCoupon(admin, args.tenantId, args.couponCode, baseCents)
  const productCents = coupon.finalCents
  // Frete cobrado à parte, somado ao total (a Rede cobra um único valor).
  const freightCents = Math.max(0, Math.round(Number(args.freightCents ?? 0)))
  const amountCents = productCents + freightCents
  const baseDesc = String(args.description ?? 'Pagamento').slice(0, 100)
  const description = freightCents > 0 ? `${baseDesc} + frete` : baseDesc

  // Parcelas: respeita a regra por kit (1 frasco = 1x; 3+ frascos = até 3x). O kit limita
  // o máximo independentemente do que a IA/UI pedir — a regra de negócio mora aqui.
  let installments = Math.max(1, Math.min(12, args.installments ?? 1))
  const kitCap = args.kit ? REDE_KIT_MAX_INSTALLMENTS[args.kit] : undefined
  if (kitCap) installments = Math.min(installments, kitCap)

  const id = shortId()
  await admin.from('rede_payments').insert({
    id,
    tenant_id: args.tenantId,
    lead_id: args.leadId || null,
    amount_cents: amountCents,
    description: description.slice(0, 120),
    installments,
    status: 'pending',
    coupon_code: coupon.applied ? coupon.code : null,
    discount_cents: coupon.discountCents,
    kit: args.kit || null,
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

export async function getRedeIntent(admin: SupabaseClient, id: string): Promise<RedeIntent | null> {
  const { data } = await admin
    .from('rede_payments')
    .select('id, tenant_id, lead_id, amount_cents, description, installments, status, coupon_code, kit, bling_order_id')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    leadId: r.lead_id != null ? String(r.lead_id) : null,
    amountCents: Number(r.amount_cents ?? 0),
    description: String(r.description ?? ''),
    installments: Number(r.installments ?? 1),
    status: String(r.status ?? 'pending'),
    couponCode: r.coupon_code != null ? String(r.coupon_code) : null,
    kit: r.kit != null ? String(r.kit) : null,
    blingOrderId: r.bling_order_id != null ? String(r.bling_order_id) : null,
  }
}

export type RedeCard = {
  cardholderName: string
  cardNumber: string
  expirationMonth: number
  expirationYear: number
  securityCode: string
}

export type RedePayResult = { status: 'paid' | 'failed'; returnCode: string; message: string; tid: string | null }

/** Autoriza+captura a cobrança na e.Rede com os dados do cartão. */
export async function payRedeIntent(
  admin: SupabaseClient,
  args: { id: string; card: RedeCard; installments?: number },
): Promise<RedePayResult> {
  const intent = await getRedeIntent(admin, args.id)
  if (!intent) throw new Error('cobranca_nao_encontrada')
  if (intent.status === 'paid') return { status: 'paid', returnCode: '00', message: 'Já pago', tid: null }

  const cfg = await readRedeConfig(admin, intent.tenantId)
  if (!cfg) throw new Error('rede_nao_configurado')

  const accessToken = await getRedeAccessToken(cfg)
  const body = {
    capture: true,
    kind: 'credit',
    reference: intent.id,
    amount: intent.amountCents, // centavos
    installments: Math.max(1, Math.min(12, args.installments ?? intent.installments ?? 1)),
    cardholderName: args.card.cardholderName.slice(0, 50),
    cardNumber: args.card.cardNumber.replace(/\D/g, ''),
    expirationMonth: args.card.expirationMonth,
    expirationYear: args.card.expirationYear,
    securityCode: args.card.securityCode.replace(/\D/g, ''),
    // softDescriptor omitido de propósito: o serviço está DESATIVADO na conta e.Rede.
    // Enviar o campo sem o serviço contratado pode fazer a Rede recusar a transação.
    subscription: false,
  }
  const res = await fetch(cfg.txUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }
  const returnCode = String(parsed.returnCode ?? `http_${res.status}`)
  const tid = typeof parsed.tid === 'string' ? parsed.tid : null
  const message = String(parsed.returnMessage ?? parsed.message ?? (res.ok ? 'ok' : text.slice(0, 160)))
  // e.Rede: returnCode "00" = aprovado.
  const approved = returnCode === '00'

  await admin
    .from('rede_payments')
    .update({ status: approved ? 'paid' : 'failed', tid, return_code: returnCode, paid_at: approved ? new Date().toISOString() : null })
    .eq('id', intent.id)

  // Pagamento aprovado: conta o uso do cupom (só agora, não na geração do link).
  if (approved) {
    await incrementCouponUse(admin, intent.tenantId, intent.couponCode)
  }

  if (approved && intent.leadId) {
    try {
      const { data: lead } = await admin
        .from('leads')
        .select('id, patient_name, pipeline_id, tenant_id, phone')
        .eq('id', intent.leadId)
        .maybeSingle()
      const l = lead as { id: string; patient_name?: string; pipeline_id?: string; tenant_id?: string; phone?: string } | null
      if (l) {
        // Procura a etapa "Pago" do PRÓPRIO pipeline do lead — nunca chuta uma etapa fixa
        // (senão um lead do Instituto cairia na etapa de "Pago" do Tricopill).
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
        // Só move de etapa se achou a "Pago" no pipeline certo; senão mantém a etapa atual.
        const leadUpdate: Record<string, unknown> = { temperature: 'hot', updated_at: new Date().toISOString() }
        if (pagoStageId) leadUpdate.stage_id = pagoStageId
        await admin.from('leads').update(leadUpdate).eq('id', l.id)
        await insertInteraction(admin, {
          leadId: l.id,
          patientName: String(l.patient_name ?? 'Cliente'),
          channel: 'system',
          direction: 'system',
          author: 'Rede',
          content: `💳 Pagamento no cartão confirmado (Rede). ${(intent.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
          tenantId: String(l.tenant_id ?? intent.tenantId),
        })

        // Pedido automático no Bling (best-effort): só se auto_order_enabled, o pagamento
        // tem kit, e ainda não há pedido (idempotente). Espelha o caminho do Pix/PagBank.
        const blingTenant = String(l.tenant_id ?? intent.tenantId)
        if (intent.kit && !intent.blingOrderId) {
          try {
            const { data: blingRow } = await admin
              .from('tenant_integrations')
              .select('bling')
              .eq('tenant_id', blingTenant)
              .maybeSingle()
            const blingCfg = ((blingRow as { bling?: Record<string, unknown> } | null)?.bling ?? {}) as Record<string, unknown>
            if (blingCfg.auto_order_enabled === true) {
              const out = await blingCreateSaleOrder(admin, blingTenant, {
                kit: intent.kit,
                amountCents: intent.amountCents,
                customerName: String(l.patient_name ?? 'Cliente Tricopill'),
                phone: l.phone ? String(l.phone) : undefined,
              })
              await admin.from('rede_payments').update({ bling_order_id: out.orderId ?? null }).eq('id', intent.id)
              await insertInteraction(admin, {
                leadId: l.id,
                patientName: String(l.patient_name ?? 'Cliente'),
                channel: 'system',
                direction: 'system',
                author: 'Bling',
                content: `📦 Pedido criado no Bling (#${out.orderId ?? '?'}, ${out.bottles} frascos).`,
                tenantId: blingTenant,
              })
            }
          } catch (e) {
            await insertInteraction(admin, {
              leadId: l.id,
              patientName: String(l.patient_name ?? 'Cliente'),
              channel: 'system',
              direction: 'system',
              author: 'Bling',
              content: `⚠️ Não foi possível criar o pedido no Bling automaticamente: ${(e instanceof Error ? e.message : String(e)).slice(0, 180)}`,
              tenantId: blingTenant,
            })
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  return { status: approved ? 'paid' : 'failed', returnCode, message, tid }
}

/**
 * Teste de credenciais/conectividade e.Rede: faz uma AUTORIZAÇÃO (capture:false)
 * de R$20,00 com o cartão oficial de teste e descarta. Serve para validar PV/token
 * num clique, sem criar cobrança nem mexer em leads. Só permitido em sandbox.
 */
export async function testRedeTransaction(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ ok: boolean; returnCode: string; message: string; tid: string | null; env: 'sandbox' | 'prod' }> {
  const cfg = await readRedeConfig(admin, tenantId)
  if (!cfg) throw new Error('rede_nao_configurado')
  if (cfg.env !== 'sandbox') throw new Error('teste_so_em_sandbox')

  const accessToken = await getRedeAccessToken(cfg)
  const body = {
    capture: false, // só autoriza; não captura nada
    kind: 'credit',
    reference: `test${shortId().slice(0, 12)}`,
    amount: 2000, // R$ 20,00 (mesmo valor do exemplo aprovado na collection oficial)
    installments: 1,
    cardholderName: 'TESTE TRICOPILL',
    cardNumber: '5448280000000007', // cartão de teste oficial e.Rede
    expirationMonth: 1,
    expirationYear: 2028,
    securityCode: '123',
    // softDescriptor omitido: serviço desativado na conta e.Rede (ver payRedeIntent).
    subscription: false,
  }
  const res = await fetch(cfg.txUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = {}
  }
  const returnCode = String(parsed.returnCode ?? `http_${res.status}`)
  const tid = typeof parsed.tid === 'string' ? parsed.tid : null
  const message = String(parsed.returnMessage ?? parsed.message ?? (res.ok ? 'ok' : text.slice(0, 160)))
  // e.Rede: returnCode "00" = aprovado.
  return { ok: returnCode === '00', returnCode, message, tid, env: cfg.env }
}
