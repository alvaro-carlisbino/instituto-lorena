/**
 * crm-frete-quote — cotação de frete (Melhor Envio: Correios PAC/SEDEX) por CEP.
 *
 * Endpoint COMPARTILHADO: consumido pelo CRM (painel/bot) e pelo site oficial do Tricopill
 * (mesmo Supabase). Usa o token OAuth conectado em tenant_integrations.melhorenvio (via
 * service-role internamente) — então o caller só precisa do anon key (verify_jwt).
 *
 * Body: {
 *   "toCep": "01002901",
 *   "tenantId"?: "tricopill",          // polo dono da conta ME (default tricopill)
 *   "weight"?: 0.3, "length"?: 20, "width"?: 20, "height"?: 12,   // caixa por carrinho (cm/kg)
 *   "insuranceCents"?: 0, "services"?: "1,2"
 * }
 * Conectar a conta: edge crm-frete-oauth. Caixa padrão/segredos: ver _shared/melhorEnvio.ts.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { quoteFreteMelhorEnvio } from '../_shared/melhorEnvio.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function num(v: unknown): number | undefined {
  if (v == null) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ ok: false, error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }

  const toCep = String(body.toCep ?? '').replace(/\D/g, '')
  if (toCep.length !== 8) return json({ ok: false, error: 'invalid_to_cep', hint: 'envie toCep com 8 dígitos' }, 400)

  const tenantId = String(body.tenantId ?? 'tricopill').trim() || 'tricopill'
  const insuranceCents =
    body.insuranceCents != null && Number.isFinite(Number(body.insuranceCents))
      ? Math.max(0, Math.round(Number(body.insuranceCents)))
      : undefined
  const servicesCsv = body.services != null ? String(body.services) : undefined
  const box = {
    weightKg: num(body.weight),
    lengthCm: num(body.length),
    widthCm: num(body.width),
    heightCm: num(body.height),
  }

  let q = await quoteFreteMelhorEnvio(admin, tenantId, toCep, { insuranceCents, servicesCsv, box })
  // A conta Melhor Envio é ÚNICA (tenant 'tricopill') e a origem é a clínica em Maringá. Se o
  // tenant pedido não tem conexão própria (ex.: polo Clínica), recota pela conta do Tricopill —
  // assim o painel coteia frete de qualquer polo. (Maringá já resolve como entrega interna antes.)
  const FRETE_FALLBACK_TENANT = 'tricopill'
  if (!q.ok && q.debug === 'not_connected' && tenantId !== FRETE_FALLBACK_TENANT) {
    q = await quoteFreteMelhorEnvio(admin, FRETE_FALLBACK_TENANT, toCep, { insuranceCents, servicesCsv, box })
  }
  return json({
    ok: q.ok,
    tenant_id: tenantId,
    from_cep: q.fromCep,
    to_cep: q.toCep,
    options: q.options.map((o) => ({
      service: o.service,
      service_id: o.serviceId,
      company: o.company,
      price_reais: o.priceCents / 100,
      price_cents: o.priceCents,
      delivery_days: o.deliveryDays,
      internal: o.internal ?? false,
    })),
    debug: q.debug,
  }, 200)
})
