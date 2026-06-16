/**
 * crm-frete-quote — cotação de frete (Melhor Envio: Correios PAC/SEDEX) por CEP.
 *
 * Uso principal: a cotação real já é injetada no snapshot pelo crm-ai-assistant
 * (snapshot.frete) durante a conversa de vendas. Esta função é um endpoint avulso
 * para TESTAR a credencial/caixa e para futuros usos no painel ("cotar frete").
 *
 * Secrets/env (ver _shared/melhorEnvio.ts): MELHOR_ENVIO_TOKEN, MELHOR_ENVIO_SANDBOX,
 *   MELHOR_ENVIO_FROM_CEP, MELHOR_ENVIO_USER_AGENT, FRETE_BOX_WEIGHT_KG/LENGTH_CM/WIDTH_CM/HEIGHT_CM.
 *
 * Body: { "toCep": "01002901", "insuranceCents"?: 0, "services"?: "1,2" }
 * Deploy: supabase functions deploy crm-frete-quote
 */
import { quoteFreteMelhorEnvio } from '../_shared/melhorEnvio.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-crm-ai-internal-secret',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  // Gate opcional: quando CRM_AI_INTERNAL_SECRET está setado, exige o header
  // x-crm-ai-internal-secret (chamadas internas). Sem o secret, fica aberto p/ teste.
  const internalSecret = (Deno.env.get('CRM_AI_INTERNAL_SECRET') ?? '').trim()
  if (internalSecret.length >= 16) {
    const got = (req.headers.get('x-crm-ai-internal-secret') ?? '').trim()
    if (got !== internalSecret) return json({ ok: false, error: 'unauthorized' }, 401)
  }

  let body: { toCep?: unknown; insuranceCents?: unknown; services?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }

  const toCep = String(body.toCep ?? '').replace(/\D/g, '')
  if (toCep.length !== 8) return json({ ok: false, error: 'invalid_to_cep', hint: 'envie toCep com 8 dígitos' }, 400)

  const insuranceCents =
    body.insuranceCents != null && Number.isFinite(Number(body.insuranceCents))
      ? Math.max(0, Math.round(Number(body.insuranceCents)))
      : undefined
  const servicesCsv = body.services != null ? String(body.services) : undefined

  const q = await quoteFreteMelhorEnvio(toCep, { insuranceCents, servicesCsv })
  return json({
    ok: q.ok,
    from_cep: q.fromCep,
    to_cep: q.toCep,
    options: q.options.map((o) => ({
      service: o.service,
      company: o.company,
      price_reais: o.priceCents / 100,
      price_cents: o.priceCents,
      delivery_days: o.deliveryDays,
    })),
    debug: q.debug,
  }, q.ok ? 200 : 502)
})
