import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { chargeAsaasCard, getAsaasIntent } from '../_shared/asaas.ts'

// Checkout público (cliente) — sem login. Cartão via Asaas.
//  get_intent -> { id } -> dados da cobrança (valor, descrição, status)
//  pay        -> { id, card{...}, installments?, holder{cpf,postalCode,addressNumber,phone,email}? }
//                -> cria a cobrança CREDIT_CARD no Asaas (tokeniza no ato) e captura.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  let payload: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const action = String(payload.action ?? '')
  const id = String(payload.id ?? '').trim()
  if (!id) return json({ error: 'missing_id' }, 400)

  if (action === 'get_intent') {
    const intent = await getAsaasIntent(admin, id)
    if (!intent) return json({ ok: false, error: 'nao_encontrada' }, 404)
    return json({
      ok: true,
      amountCents: intent.amountCents,
      description: intent.description,
      installments: intent.installments,
      status: intent.status,
    })
  }

  if (action === 'pay') {
    const c = (payload.card ?? {}) as Record<string, unknown>
    const card = {
      holderName: String(c.cardholderName ?? c.holderName ?? '').trim(),
      number: String(c.cardNumber ?? c.number ?? '').replace(/\D/g, ''),
      expiryMonth: String(c.expirationMonth ?? c.expiryMonth ?? '').trim(),
      expiryYear: String(c.expirationYear ?? c.expiryYear ?? '').trim(),
      ccv: String(c.securityCode ?? c.ccv ?? '').replace(/\D/g, ''),
    }
    if (card.number.length < 13 || !card.holderName || !card.expiryMonth || !card.expiryYear || card.ccv.length < 3) {
      return json({ ok: false, error: 'dados_cartao_invalidos', message: 'Confira os dados do cartão (preencha o CVV).' }, 400)
    }
    const h = (payload.holder ?? {}) as Record<string, unknown>
    const holderInfo = {
      cpf: h.cpf != null ? String(h.cpf) : undefined,
      postalCode: h.postalCode != null ? String(h.postalCode) : undefined,
      addressNumber: h.addressNumber != null ? String(h.addressNumber) : undefined,
      phone: h.phone != null ? String(h.phone) : undefined,
      email: h.email != null ? String(h.email) : undefined,
    }
    // IP real do pagador (exigido pelo antifraude do Asaas em cobranças com cartão).
    const remoteIp =
      (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      undefined
    try {
      const out = await chargeAsaasCard(admin, {
        id,
        card,
        installments: payload.installments != null ? Number(payload.installments) : undefined,
        holderInfo,
        remoteIp: remoteIp || undefined,
      })
      return json({ ok: out.status === 'paid', status: out.status, message: out.detail })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      try {
        await admin.from('webhook_jobs').insert({ source: 'asaas-debug', status: 'error', note: msg.slice(0, 490) })
      } catch { /* ignore */ }
      return json({ ok: false, error: 'asaas_pay_failed', message: msg }, 502)
    }
  }

  return json({ error: 'unknown_action' }, 400)
})
