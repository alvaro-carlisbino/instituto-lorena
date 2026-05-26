/**
 * Cria uma Stripe Checkout Session pro tenant atual assinar um plano.
 *
 * Frontend chama:
 *   supabase.functions.invoke('crm-stripe-checkout', { body: { plan: 'starter'|'pro'|'scale' } })
 *
 * Resposta: { ok: true, url: 'https://checkout.stripe.com/...' }
 * O cliente é redirecionado pra `url`. Após confirmação, Stripe dispara
 * `checkout.session.completed` no webhook crm-stripe-webhook que atualiza
 * tenants.plan/status.
 *
 * Vínculo tenant ↔ checkout: passamos `client_reference_id` = tenant_id e
 * `metadata.plan` pra que o webhook saiba qual tenant atualizar e pra qual plano.
 *
 * Secrets necessários no Supabase:
 *   - STRIPE_SECRET_KEY        (sk_test_... ou sk_live_...)
 *   - STRIPE_PRICE_STARTER     (price_... do plano Starter)
 *   - STRIPE_PRICE_PRO         (price_... do plano Pro)
 *   - STRIPE_PRICE_SCALE       (price_... do plano Scale)
 *   - CRM_PUBLIC_URL           (ex.: https://crm.suaempresa.com.br — usado em success/cancel)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  })
}

const PLAN_TO_ENV: Record<string, string> = {
  starter: 'STRIPE_PRICE_STARTER',
  pro: 'STRIPE_PRICE_PRO',
  scale: 'STRIPE_PRICE_SCALE',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
  const publicUrl = (Deno.env.get('CRM_PUBLIC_URL') ?? '').replace(/\/$/, '')

  if (!supabaseUrl || !anonKey) return json({ ok: false, error: 'server_misconfigured' }, 500)
  if (!stripeKey) {
    return json({
      ok: false,
      error: 'stripe_not_configured',
      message: 'Defina STRIPE_SECRET_KEY nos secrets pra ativar o checkout.',
    }, 503)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ ok: false, error: 'unauthorized' }, 401)

  const dbClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await dbClient.auth.getUser()
  if (userErr || !user) return json({ ok: false, error: 'unauthorized' }, 401)

  let body: { plan?: string } = {}
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }
  const plan = String(body.plan ?? '').trim().toLowerCase()
  const priceEnv = PLAN_TO_ENV[plan]
  if (!priceEnv) return json({ ok: false, error: 'invalid_plan' }, 400)

  const priceId = (Deno.env.get(priceEnv) ?? '').trim()
  if (!priceId) {
    return json({
      ok: false,
      error: 'price_not_configured',
      message: `Defina o secret ${priceEnv} com o price_... criado no Stripe Dashboard.`,
    }, 503)
  }

  // Resolve tenant + email do usuário pra passar pro Checkout.
  const { data: tidData } = await dbClient.rpc('current_tenant_id')
  const tenantId = typeof tidData === 'string' ? tidData : ''
  if (!tenantId) return json({ ok: false, error: 'no_tenant' }, 400)

  const { data: tenantRow } = await dbClient
    .from('tenants')
    .select('stripe_customer_id, name')
    .eq('id', tenantId)
    .maybeSingle()
  const existingCustomerId = String(
    (tenantRow as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? '',
  )

  const successUrl = `${publicUrl || 'https://example.com'}/configuracoes?billing=success`
  const cancelUrl = `${publicUrl || 'https://example.com'}/configuracoes?billing=cancel`

  // Chama Stripe Checkout Sessions via HTTP nativo (sem SDK).
  const form = new URLSearchParams()
  form.set('mode', 'subscription')
  form.set('success_url', successUrl)
  form.set('cancel_url', cancelUrl)
  form.set('line_items[0][price]', priceId)
  form.set('line_items[0][quantity]', '1')
  form.set('client_reference_id', tenantId)
  form.set('metadata[tenant_id]', tenantId)
  form.set('metadata[plan]', plan)
  form.set('subscription_data[metadata][tenant_id]', tenantId)
  form.set('subscription_data[metadata][plan]', plan)
  if (existingCustomerId) {
    form.set('customer', existingCustomerId)
  } else if (user.email) {
    form.set('customer_email', user.email)
  }
  form.set('allow_promotion_codes', 'true')
  form.set('billing_address_collection', 'auto')
  form.set('locale', 'pt-BR')

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  const session = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('crm-stripe-checkout error from Stripe:', session)
    return json({
      ok: false,
      error: 'stripe_error',
      message: session?.error?.message ?? 'Falha ao criar checkout session.',
    }, 502)
  }

  return json({ ok: true, url: String(session.url ?? ''), session_id: String(session.id ?? '') })
})
