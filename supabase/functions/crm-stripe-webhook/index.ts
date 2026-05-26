/**
 * Stripe webhook receiver.
 *
 * Eventos tratados (mínimo viável):
 *  - checkout.session.completed   → marca tenant 'active', salva customer/subscription
 *  - customer.subscription.updated → atualiza status (active/past_due/canceled)
 *  - customer.subscription.deleted → marca canceled
 *  - invoice.payment_failed       → marca past_due
 *
 * Vínculo tenant ↔ customer: usa `client_reference_id` (passado no Checkout) ou
 * `metadata.tenant_id`. Toda mudança gera linha em billing_events para auditoria.
 *
 * Assinatura: valida o cabeçalho `stripe-signature` usando STRIPE_WEBHOOK_SECRET.
 *
 * Secrets necessários no projeto Supabase:
 *  - STRIPE_WEBHOOK_SECRET
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, stripe-signature',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  })
}

/** Verifica assinatura Stripe sem instalar SDK (HMAC-SHA256). */
async function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  if (!header || !secret) return false
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, v] = p.split('=')
      return [k?.trim(), v?.trim()]
    }),
  )
  const t = parts['t']
  const v1 = parts['v1']
  if (!t || !v1) return false

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(t)) > toleranceSec) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`))
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  // timing-safe compare
  if (hex.length !== v1.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
  if (!supabaseUrl || !serviceRole) return jsonResponse({ ok: false, error: 'server_misconfigured' }, 500)

  const rawBody = await req.text()
  const sigHeader = req.headers.get('stripe-signature') ?? ''

  // Em dev local sem secret configurado, permite passar (loga warning).
  if (webhookSecret) {
    const ok = await verifyStripeSignature(rawBody, sigHeader, webhookSecret)
    if (!ok) return jsonResponse({ ok: false, error: 'invalid_signature' }, 400)
  } else {
    console.warn('STRIPE_WEBHOOK_SECRET vazio — pulando verificação. NÃO uso em prod.')
  }

  let event: Record<string, unknown>
  try {
    event = JSON.parse(rawBody)
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRole)
  const eventId = String(event.id ?? '')
  const eventType = String(event.type ?? '')
  const dataObj = (event.data as { object?: Record<string, unknown> } | undefined)?.object ?? {}

  // Idempotência: se já gravamos esse event_id, devolvemos ok sem reprocessar.
  if (eventId) {
    const { data: existing } = await admin
      .from('billing_events')
      .select('id')
      .eq('stripe_event_id', eventId)
      .maybeSingle()
    if (existing) return jsonResponse({ ok: true, duplicate: true })
  }

  // Extrai tenant_id de várias fontes possíveis no payload.
  const tenantId =
    String(
      (dataObj.client_reference_id as string | undefined) ??
        (dataObj.metadata as { tenant_id?: string } | undefined)?.tenant_id ??
        '',
    ).trim() || null

  let updateFields: Record<string, unknown> | null = null

  switch (eventType) {
    case 'checkout.session.completed': {
      updateFields = {
        plan: String((dataObj.metadata as { plan?: string } | undefined)?.plan ?? 'pro'),
        status: 'active',
        stripe_customer_id: String(dataObj.customer ?? '') || null,
        stripe_subscription_id: String(dataObj.subscription ?? '') || null,
      }
      break
    }
    case 'customer.subscription.updated': {
      const stripeStatus = String(dataObj.status ?? '')
      const mapped =
        stripeStatus === 'active' || stripeStatus === 'trialing'
          ? 'active'
          : stripeStatus === 'past_due'
            ? 'past_due'
            : stripeStatus === 'canceled' || stripeStatus === 'unpaid'
              ? 'canceled'
              : null
      if (mapped) {
        const periodEnd = Number(dataObj.current_period_end ?? 0)
        updateFields = {
          status: mapped,
          ...(periodEnd > 0
            ? { current_period_ends_at: new Date(periodEnd * 1000).toISOString() }
            : {}),
        }
      }
      break
    }
    case 'customer.subscription.deleted': {
      updateFields = { status: 'canceled' }
      break
    }
    case 'invoice.payment_failed': {
      updateFields = { status: 'past_due' }
      break
    }
    default:
      // Eventos não tratados ainda são logados em billing_events mas não mudam tenant.
      break
  }

  if (updateFields && tenantId) {
    const { error: upErr } = await admin.from('tenants').update(updateFields).eq('id', tenantId)
    if (upErr) console.error('crm-stripe-webhook update tenant failed:', upErr.message)
  }

  // Registra evento (idempotência via UNIQUE em stripe_event_id).
  if (eventId) {
    await admin
      .from('billing_events')
      .insert({
        stripe_event_id: eventId,
        tenant_id: tenantId,
        event_type: eventType,
        payload: event as unknown as Record<string, unknown>,
      })
      .then(({ error }) => {
        if (error && !error.message.includes('duplicate')) {
          console.warn('billing_events insert failed:', error.message)
        }
      })
  }

  return jsonResponse({ ok: true })
})
