import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { cancelAsaasSubscription, listAsaasSubscriptionPayments, setAsaasSubscriptionStatus } from '../_shared/asaas.ts'
import { getValidMeToken, melhorEnvioBaseUrl, meUserAgent } from '../_shared/melhorEnvio.ts'
import { sendEmail } from '../_shared/resend.ts'
import { trackingEmail } from '../_shared/emails.ts'

// Ações do painel de assinaturas (autenticado): cancelar, pausar, reativar, reenviar rastreio.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
function json(b: Record<string, unknown>, s = 200): Response { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } }) }
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

async function sendWapi(admin: ReturnType<typeof createClient>, tenantId: string, phone: string, text: string): Promise<boolean> {
  const to = digits(phone); if (to.length < 10) return false
  const full = to.startsWith('55') ? to : '55' + to
  try {
    const { data } = await admin.from('whatsapp_channel_instances').select('wapi_instance_id, wapi_token, wapi_base_url').eq('tenant_id', tenantId).eq('channel_provider', 'wapi').eq('active', true).limit(1).maybeSingle()
    const row = data as { wapi_instance_id?: string; wapi_token?: string; wapi_base_url?: string | null } | null
    const inst = row?.wapi_instance_id ? String(row.wapi_instance_id).trim() : ''; const tok = row?.wapi_token ? String(row.wapi_token).trim() : ''
    if (!inst || !tok) return false
    const base = ((row?.wapi_base_url ? String(row.wapi_base_url) : '').trim() || 'https://api.w-api.app/v1').replace(/\/$/, '')
    const res = await fetch(`${base}/message/send-text?instanceId=${encodeURIComponent(inst)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ phone: full, message: text }) })
    return res.ok
  } catch { return false }
}

// Acha o rastreio do último envio do cliente na conta Melhor Envio (por CPF/CEP).
async function findTracking(admin: ReturnType<typeof createClient>, tenantId: string, doc: string, cep: string): Promise<string | null> {
  const token = await getValidMeToken(admin, tenantId); if (!token) return null
  for (const page of [1, 2]) {
    const r = await fetch(`${melhorEnvioBaseUrl()}/api/v2/me/orders?page=${page}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': meUserAgent() } })
    if (!r.ok) break
    const d = await r.json().catch(() => ({}))
    const orders = Array.isArray((d as { data?: unknown }).data) ? (d as { data: Array<Record<string, unknown>> }).data : []
    for (const o of orders) {
      const t = String(o.tracking ?? '').trim(); if (!t) continue
      const to = (o.to ?? {}) as Record<string, unknown>
      if ((doc && digits(to.document) === doc) || (cep && digits(to.postal_code) === cep)) return t
    }
    if (!orders.length) break
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL') ?? ''; const sr = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !sr) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(url, sr)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } })
  const { data: { user }, error: uErr } = await userClient.auth.getUser()
  if (uErr || !user) return json({ error: 'unauthorized' }, 401)
  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  let p: Record<string, unknown> = {}
  try { const raw = await req.text(); p = raw ? JSON.parse(raw) : {} } catch { return json({ error: 'invalid_json' }, 400) }
  const action = String(p.action ?? '')
  const subId = String(p.subId ?? '').trim()
  if (!subId) return json({ error: 'missing_subId' }, 400)

  const { data: subRow } = await admin.from('asaas_subscriptions').select('*').eq('id', subId).eq('tenant_id', tenantId).maybeSingle()
  const s = subRow as Record<string, unknown> | null
  if (!s) return json({ error: 'assinatura_nao_encontrada' }, 404)
  const asaasSubId = String(s.asaas_subscription_id ?? '').trim()

  if (action === 'cancel') {
    if (asaasSubId) { const r = await cancelAsaasSubscription(admin, tenantId, asaasSubId); if (!r.ok) return json({ ok: false, error: r.error }, 502) }
    await admin.from('asaas_subscriptions').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', subId)
    return json({ ok: true, status: 'canceled' })
  }
  if (action === 'pause' || action === 'resume') {
    const asaasStatus = action === 'pause' ? 'INACTIVE' : 'ACTIVE'
    if (asaasSubId) { const r = await setAsaasSubscriptionStatus(admin, tenantId, asaasSubId, asaasStatus); if (!r.ok) return json({ ok: false, error: r.error }, 502) }
    const localStatus = action === 'pause' ? 'paused' : 'active'
    await admin.from('asaas_subscriptions').update({ status: localStatus, updated_at: new Date().toISOString() }).eq('id', subId)
    return json({ ok: true, status: localStatus })
  }
  if (action === 'resend_tracking') {
    const ent = (s.entrega ?? {}) as Record<string, unknown>
    const doc = digits(s.customer_doc); const cep = digits(ent.cep)
    const tracking = (ent.tracking ? String(ent.tracking) : '') || (await findTracking(admin, tenantId, doc, cep)) || ''
    if (!tracking) return json({ ok: false, error: 'sem_rastreio', message: 'Ainda não há rastreio (etiqueta não gerada).' }, 200)
    const nome = String(s.customer_name ?? '').trim(); const fn = nome.split(/\s+/).filter(Boolean)[0] || 'tudo bem'
    const wa = `Oi, ${fn}! 📦 Seu pedido Tricopill foi postado nos Correios!\n\n*Código de rastreio:* ${tracking}\nAcompanhe aqui: https://www.linkcorreios.com.br/?id=${tracking}\n\nQualquer dúvida, é só responder. 💚`
    const sent = await sendWapi(admin, tenantId, String(s.phone ?? ''), wa)
    const email = String(s.email ?? '').trim()
    if (email) { const t = trackingEmail({ nome, tracking }); await sendEmail({ to: email, subject: t.subject, html: t.html }) }
    return json({ ok: true, tracking, whatsapp: sent, email: !!email })
  }
  if (action === 'history') {
    const payments = asaasSubId ? await listAsaasSubscriptionPayments(admin, tenantId, asaasSubId) : []
    return json({ ok: true, payments })
  }
  return json({ error: 'unknown_action' }, 400)
})
