import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { getRedeIntent, payRedeIntent } from '../_shared/rede.ts'

// Checkout público (cliente) — sem login.
//  get_intent -> { id } -> dados da cobrança (valor, descrição, status)
//  pay        -> { id, card{...}, installments? } -> autoriza+captura na e.Rede

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
    const intent = await getRedeIntent(admin, id)
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
      cardholderName: String(c.cardholderName ?? '').trim(),
      cardNumber: String(c.cardNumber ?? '').replace(/\D/g, ''),
      expirationMonth: Number(c.expirationMonth ?? 0),
      expirationYear: Number(c.expirationYear ?? 0),
      securityCode: String(c.securityCode ?? '').replace(/\D/g, ''),
    }
    if (
      card.cardNumber.length < 13 ||
      !card.cardholderName ||
      !card.expirationMonth ||
      !card.expirationYear ||
      card.securityCode.length < 3
    ) {
      return json({ ok: false, error: 'dados_cartao_invalidos', message: 'Confira os dados do cartão (preencha o CVV).' }, 400)
    }
    try {
      const out = await payRedeIntent(admin, { id, card, installments: payload.installments != null ? Number(payload.installments) : undefined })
      return json({ ok: out.status === 'paid', status: out.status, returnCode: out.returnCode, message: out.message })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      try {
        await admin.from('webhook_jobs').insert({ source: 'rede-debug', status: 'error', note: msg.slice(0, 490) })
      } catch { /* ignore */ }
      return json({ ok: false, error: 'rede_pay_failed', message: msg }, 502)
    }
  }

  return json({ error: 'unknown_action' }, 400)
})
