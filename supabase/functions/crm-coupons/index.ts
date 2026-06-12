import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { normalizeCouponCode } from '../_shared/coupons.ts'

// Cupons de desconto — CRUD autenticado do CRM (escopo por tenant via current_tenant_id).
//   list       -> { coupons: [...] }
//   upsert     -> grava/atualiza um cupom { code, kind, value, active?, valid_from?, valid_until?, max_uses?, min_amount_cents?, note? }
//   set_active -> liga/desliga { code, active }
//   delete     -> remove { code }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? n : null
}
function toIsoOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  let payload: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  const action = String(payload.action ?? '')

  if (action === 'list') {
    const { data, error } = await admin
      .from('coupons')
      .select('code, kind, value, active, valid_from, valid_until, max_uses, uses, min_amount_cents, note, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true, coupons: data ?? [] })
  }

  if (action === 'upsert') {
    const code = normalizeCouponCode(String(payload.code ?? ''))
    if (!code || code.length < 3) return json({ ok: false, error: 'invalid_code', message: 'Código precisa de ao menos 3 caracteres (A-Z, 0-9, - ou _).' }, 400)
    const kind = String(payload.kind ?? 'percent').toLowerCase() === 'fixed' ? 'fixed' : 'percent'
    const valueRaw = Math.round(Number(payload.value ?? 0))
    if (!Number.isFinite(valueRaw) || valueRaw <= 0) return json({ ok: false, error: 'invalid_value' }, 400)
    if (kind === 'percent' && valueRaw > 100) return json({ ok: false, error: 'percent_max_100' }, 400)

    const row = {
      tenant_id: tenantId,
      code,
      kind,
      value: valueRaw, // percent: 1..100 | fixed: centavos
      active: payload.active === undefined ? true : Boolean(payload.active),
      valid_from: toIsoOrNull(payload.valid_from),
      valid_until: toIsoOrNull(payload.valid_until),
      max_uses: toIntOrNull(payload.max_uses),
      min_amount_cents: Math.max(0, toIntOrNull(payload.min_amount_cents) ?? 0),
      note: payload.note != null ? String(payload.note).slice(0, 200) : null,
      updated_at: new Date().toISOString(),
    }
    // upsert preservando `uses` (não está no row → não é zerado num update).
    const { error } = await admin.from('coupons').upsert(row, { onConflict: 'tenant_id,code' })
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true, code })
  }

  if (action === 'set_active') {
    const code = normalizeCouponCode(String(payload.code ?? ''))
    if (!code) return json({ ok: false, error: 'invalid_code' }, 400)
    const { error } = await admin
      .from('coupons')
      .update({ active: Boolean(payload.active), updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('code', code)
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true })
  }

  if (action === 'delete') {
    const code = normalizeCouponCode(String(payload.code ?? ''))
    if (!code) return json({ ok: false, error: 'invalid_code' }, 400)
    const { error } = await admin.from('coupons').delete().eq('tenant_id', tenantId).eq('code', code)
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true })
  }

  return json({ error: 'unknown_action' }, 400)
})
