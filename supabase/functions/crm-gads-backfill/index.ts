/**
 * crm-gads-backfill — sobe conversões PASSADAS pro Google Ads (uploadClickConversions) e
 * serve de diagnóstico do setup. Server-side: usa o gclid que já guardamos no lead.
 *
 * Auth: header x-reship-secret == env RESHIP_SECRET (verify_jwt=false no config.toml).
 *
 * Ações:
 *  {"action":"status"}                     -> quais secrets GOOGLE_ADS_* estão setados + testa
 *                                             o access token (sem revelar valores).
 *  {"action":"backfill","from":"YYYY-MM-DD","to":"YYYY-MM-DD","limit":50}
 *                                          -> sobe cada venda paga do site com gclid no período.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { uploadGoogleAdsConversion } from '../_shared/conversions.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reship-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
const has = (k: string) => (Deno.env.get(k) ?? '').trim().length > 0

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const secret = (Deno.env.get('RESHIP_SECRET') ?? '').trim()
  if (!secret || (req.headers.get('x-reship-secret') ?? '').trim() !== secret) return json({ error: 'unauthorized' }, 401)

  let p: Record<string, unknown> = {}
  try { const raw = await req.text(); p = raw ? JSON.parse(raw) : {} } catch { return json({ error: 'invalid_json' }, 400) }
  const action = String(p.action ?? 'status')

  if (action === 'status') {
    const secrets = {
      GOOGLE_ADS_DEVELOPER_TOKEN: has('GOOGLE_ADS_DEVELOPER_TOKEN'),
      GOOGLE_ADS_CLIENT_ID: has('GOOGLE_ADS_CLIENT_ID'),
      GOOGLE_ADS_CLIENT_SECRET: has('GOOGLE_ADS_CLIENT_SECRET'),
      GOOGLE_ADS_REFRESH_TOKEN: has('GOOGLE_ADS_REFRESH_TOKEN'),
      GOOGLE_ADS_CUSTOMER_ID: has('GOOGLE_ADS_CUSTOMER_ID'),
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: has('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
      GOOGLE_ADS_CONVERSION_ACTION_ID: has('GOOGLE_ADS_CONVERSION_ACTION_ID'),
    }
    // Testa o OAuth (troca refresh->access) sem subir nada.
    let accessTokenOk = false
    let accessTokenError: string | undefined
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: Deno.env.get('GOOGLE_ADS_CLIENT_ID') ?? '',
          client_secret: Deno.env.get('GOOGLE_ADS_CLIENT_SECRET') ?? '',
          refresh_token: Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN') ?? '',
          grant_type: 'refresh_token',
        }),
      })
      accessTokenOk = res.ok
      if (!res.ok) accessTokenError = (await res.text()).slice(0, 200)
    } catch (e) { accessTokenError = e instanceof Error ? e.message : String(e) }
    return json({ ok: true, secrets, accessTokenOk, accessTokenError })
  }

  if (action === 'backfill') {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
    const admin = createClient(supabaseUrl, serviceRole)

    const from = String(p.from ?? '').trim()
    const to = String(p.to ?? '').trim()
    const limit = Math.min(Number(p.limit ?? 100) || 100, 500)
    const startIso = /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00-03:00` : ''
    const endIso = /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59-03:00` : ''

    let q = admin
      .from('rede_payments')
      .select('id, lead_id, amount_cents, paid_at')
      .eq('tenant_id', 'tricopill').eq('status', 'paid')
      .order('paid_at', { ascending: false }).limit(limit)
    if (startIso) q = q.gte('paid_at', startIso)
    if (endIso) q = q.lte('paid_at', endIso)
    const { data: pays } = await q
    const rows = (pays ?? []) as Array<{ id: string; lead_id?: string; amount_cents?: number; paid_at?: string }>

    const results: Array<{ orderId: string; name?: string; hasGclid: boolean; ok: boolean; error?: string }> = []
    let uploaded = 0
    for (const r of rows) {
      if (!r.lead_id) { results.push({ orderId: r.id, hasGclid: false, ok: false, error: 'sem_lead' }); continue }
      const { data: l } = await admin.from('leads').select('patient_name, custom_fields').eq('id', r.lead_id).maybeSingle()
      const cf = (((l as { custom_fields?: Record<string, unknown> } | null)?.custom_fields) ?? {}) as Record<string, unknown>
      if (String(cf.origin ?? '') !== 'site') { results.push({ orderId: r.id, hasGclid: false, ok: false, error: 'nao_site' }); continue }
      const attr = (cf.attribution ?? {}) as Record<string, unknown>
      const first = (attr.first ?? {}) as Record<string, unknown>
      const gclid = String(first.gclid ?? (attr as Record<string, unknown>).gclid ?? '').trim()
      const name = String((l as { patient_name?: string } | null)?.patient_name ?? '')
      if (!gclid) { results.push({ orderId: r.id, name, hasGclid: false, ok: false, error: 'sem_gclid' }); continue }
      const when = r.paid_at ? new Date(r.paid_at) : new Date()
      const out = await uploadGoogleAdsConversion({ gclid, valueReais: Math.round(Number(r.amount_cents) || 0) / 100, orderId: r.id, when })
      if (out.ok) uploaded += 1
      results.push({ orderId: r.id, name, hasGclid: true, ok: out.ok, error: out.error })
    }
    return json({ ok: true, considered: rows.length, uploaded, results })
  }

  return json({ error: 'unknown_action' }, 400)
})
