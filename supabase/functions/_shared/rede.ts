import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from './crm.ts'

/**
 * e.Rede — transação por CARTÃO (POST /v1/transactions, Basic auth PV:Token).
 * Fluxo: o CRM cria uma "cobrança" (rede_payments) e devolve /pagar/<id>; o cliente
 * abre, digita o cartão, e crm-rede-pay autoriza+captura na e.Rede.
 * Config por polo em tenant_integrations.rede: { pv, token, env?, base_url? }.
 *
 * ATENÇÃO PCI: coletar o cartão na nossa página = escopo PCI. OK para sandbox/teste;
 * para produção com cartão real, migrar para tokenização da Rede (cartão não trafega
 * pelo nosso servidor).
 */

const SANDBOX_BASE = 'https://sandbox-erede.useredecloud.com.br'
const PROD_BASE = 'https://erede.useredecloud.com.br'

export type RedeConfig = { pv: string; token: string; baseUrl: string; env: 'sandbox' | 'prod' }

export async function readRedeConfig(admin: SupabaseClient, tenantId: string): Promise<RedeConfig | null> {
  if (!tenantId) return null
  const { data } = await admin.from('tenant_integrations').select('rede').eq('tenant_id', tenantId).maybeSingle()
  const cfg = ((data as { rede?: Record<string, unknown> } | null)?.rede ?? {}) as Record<string, unknown>
  const pv = typeof cfg.pv === 'string' ? cfg.pv.trim() : ''
  const token = typeof cfg.token === 'string' ? cfg.token.trim() : ''
  if (!pv || !token) return null
  const env: 'sandbox' | 'prod' = cfg.env === 'prod' ? 'prod' : 'sandbox'
  const baseUrl = (typeof cfg.base_url === 'string' && cfg.base_url.trim()
    ? cfg.base_url.trim()
    : env === 'prod' ? PROD_BASE : SANDBOX_BASE).replace(/\/$/, '')
  return { pv, token, baseUrl, env }
}

export type RedeIntent = {
  id: string
  tenantId: string
  leadId: string | null
  amountCents: number
  description: string
  installments: number
  status: string
}

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

/** Cria uma cobrança e devolve a URL do checkout (/pagar/<id>). */
export async function createRedeIntent(
  admin: SupabaseClient,
  args: { tenantId: string; amountCents: number; description: string; leadId?: string; installments?: number; appBaseUrl: string },
): Promise<{ id: string; url: string }> {
  const cfg = await readRedeConfig(admin, args.tenantId)
  if (!cfg) throw new Error('rede_nao_configurado')
  const amountCents = Math.round(args.amountCents)
  if (!Number.isFinite(amountCents) || amountCents < 100) throw new Error('rede_valor_invalido')
  const id = shortId()
  await admin.from('rede_payments').insert({
    id,
    tenant_id: args.tenantId,
    lead_id: args.leadId || null,
    amount_cents: amountCents,
    description: String(args.description ?? 'Pagamento').slice(0, 120),
    installments: Math.max(1, Math.min(12, args.installments ?? 1)),
    status: 'pending',
  })
  const base = args.appBaseUrl.replace(/\/$/, '')
  return { id, url: `${base}/pagar/${id}` }
}

export async function getRedeIntent(admin: SupabaseClient, id: string): Promise<RedeIntent | null> {
  const { data } = await admin
    .from('rede_payments')
    .select('id, tenant_id, lead_id, amount_cents, description, installments, status')
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

  const basic = btoa(`${cfg.pv}:${cfg.token}`)
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
    softDescriptor: 'PAGAMENTO',
    subscription: false,
  }
  const res = await fetch(`${cfg.baseUrl}/v1/transactions`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
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

  if (approved && intent.leadId) {
    try {
      const { data: lead } = await admin
        .from('leads')
        .select('id, patient_name, pipeline_id, tenant_id')
        .eq('id', intent.leadId)
        .maybeSingle()
      const l = lead as { id: string; patient_name?: string; pipeline_id?: string; tenant_id?: string } | null
      if (l) {
        let pagoStageId = 'tricopill__vd-pago'
        if (l.pipeline_id) {
          const { data: stage } = await admin
            .from('pipeline_stages')
            .select('id')
            .eq('pipeline_id', l.pipeline_id)
            .ilike('name', 'pago%')
            .maybeSingle()
          if (stage?.id) pagoStageId = String(stage.id)
        }
        await admin.from('leads').update({ stage_id: pagoStageId, temperature: 'hot', updated_at: new Date().toISOString() }).eq('id', l.id)
        await insertInteraction(admin, {
          leadId: l.id,
          patientName: String(l.patient_name ?? 'Cliente'),
          channel: 'system',
          direction: 'system',
          author: 'Rede',
          content: `💳 Pagamento no cartão confirmado (Rede). ${(intent.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
          tenantId: String(l.tenant_id ?? intent.tenantId),
        })
      }
    } catch {
      // best-effort
    }
  }

  return { status: approved ? 'paid' : 'failed', returnCode, message, tid }
}
