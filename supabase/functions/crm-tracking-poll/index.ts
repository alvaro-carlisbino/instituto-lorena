import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { getValidMeToken, melhorEnvioBaseUrl, melhorEnvioConfigured, meUserAgent } from '../_shared/melhorEnvio.ts'
import { sendEmail } from '../_shared/resend.ts'
import { trackingEmail } from '../_shared/emails.ts'

// Rastreio 100% AUTOMÁTICO: lista os envios da conta Melhor Envio (/me/orders) e, para cada um
// com RASTREIO, acha o lead (por CPF via pagamento, ou por CEP+nome) e — se for um tracking NOVO —
// grava no lead e avisa o cliente por WhatsApp (+ e-mail se houver). Cobre a finalização feita SÓ
// no painel do ME (sem depender de me_cart_id). Idempotente: só dispara quando o tracking muda.
// Auth: pg_cron com anon Bearer.

const TENANT_ID = 'tricopill'
const ME_STATUS_MAP: Record<string, string> = { released: 'enviado', posted: 'enviado', delivered: 'entregue', canceled: 'cancelado', cancelled: 'cancelado' }
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
function json(b: Record<string, unknown>, s = 200): Response { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } }) }
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const first = (s: string) => s.trim().split(/\s+/).filter(Boolean)[0]?.toLowerCase() ?? ''

async function meOrders(token: string, page: number): Promise<Array<Record<string, unknown>>> {
  const r = await fetch(`${melhorEnvioBaseUrl()}/api/v2/me/orders?page=${page}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': meUserAgent() },
    signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) return []
  const d = await r.json().catch(() => ({}))
  return Array.isArray((d as { data?: unknown }).data) ? (d as { data: Array<Record<string, unknown>> }).data : []
}

async function sendWapiText(admin: SupabaseClient, phone: string, text: string): Promise<boolean> {
  const to = digits(phone); if (to.length < 10) return false
  const full = to.startsWith('55') ? to : '55' + to
  try {
    const { data } = await admin.from('whatsapp_channel_instances').select('wapi_instance_id, wapi_token, wapi_base_url')
      .eq('tenant_id', TENANT_ID).eq('channel_provider', 'wapi').eq('active', true).limit(1).maybeSingle()
    const row = data as { wapi_instance_id?: string; wapi_token?: string; wapi_base_url?: string | null } | null
    const inst = row?.wapi_instance_id ? String(row.wapi_instance_id).trim() : ''
    const tok = row?.wapi_token ? String(row.wapi_token).trim() : ''
    if (!inst || !tok) return false
    const base = ((row?.wapi_base_url ? String(row.wapi_base_url) : '').trim() || 'https://api.w-api.app/v1').replace(/\/$/, '')
    const res = await fetch(`${base}/message/send-text?instanceId=${encodeURIComponent(inst)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ phone: full, message: text }),
    })
    return res.ok
  } catch { return false }
}

// Acha o lead do destinatário: 1) por CPF (via pagamento) — exato e seguro; 2) por CEP + 1º nome.
async function findLead(admin: SupabaseClient, doc: string, cep: string, name: string): Promise<{ id: string; phone: string; cf: Record<string, unknown> } | null> {
  if (doc.length === 11) {
    for (const tbl of ['rede_payments', 'asaas_payments']) {
      const { data } = await admin.from(tbl).select('lead_id').eq('tenant_id', TENANT_ID).eq('customer_doc', doc).not('lead_id', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
      const lid = (data as { lead_id?: string } | null)?.lead_id
      if (lid) { const l = await loadLead(admin, lid); if (l) return l }
    }
  }
  if (cep.length === 8) {
    const { data } = await admin.from('leads').select('id, phone, custom_fields').eq('tenant_id', TENANT_ID).eq('custom_fields->entrega->>cep', cep).limit(10)
    for (const r of (data ?? []) as Array<{ id: string; phone?: string; custom_fields?: Record<string, unknown> }>) {
      if (name && first(String(r.custom_fields?.cadastro && (r.custom_fields.cadastro as Record<string, unknown>).nomeCompleto || '')) === first(name)) {
        return { id: r.id, phone: String(r.phone ?? ''), cf: (r.custom_fields ?? {}) as Record<string, unknown> }
      }
    }
  }
  return null
}
async function loadLead(admin: SupabaseClient, id: string): Promise<{ id: string; phone: string; cf: Record<string, unknown> } | null> {
  const { data } = await admin.from('leads').select('id, phone, custom_fields').eq('id', id).maybeSingle()
  const l = data as { id: string; phone?: string; custom_fields?: Record<string, unknown> } | null
  return l ? { id: l.id, phone: String(l.phone ?? ''), cf: (l.custom_fields ?? {}) as Record<string, unknown> } : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = Deno.env.get('SUPABASE_URL') ?? ''; const sr = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !sr) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(url, sr)
  if (!melhorEnvioConfigured()) return json({ ok: false, error: 'me_nao_configurado' })
  const token = await getValidMeToken(admin, TENANT_ID)
  if (!token) return json({ ok: false, error: 'me_nao_conectado' })

  let scanned = 0, matched = 0, notified = 0
  const errors: Array<{ order: string; error: string }> = []
  for (const page of [1, 2]) {
    const orders = await meOrders(token, page)
    if (!orders.length) break
    for (const o of orders) {
      const tracking = String(o.tracking ?? '').trim()
      const status = String(o.status ?? '').toLowerCase()
      if (!tracking || ['canceled', 'cancelled', 'pending', 'paid'].includes(status)) continue
      scanned += 1
      const to = (o.to ?? {}) as Record<string, unknown>
      const doc = digits(to.document); const cep = digits(to.postal_code); const name = String(to.name ?? '').trim()
      try {
        const lead = await findLead(admin, doc, cep, name)
        if (!lead) continue
        matched += 1
        const ent = { ...((lead.cf.entrega ?? {}) as Record<string, unknown>) }
        if (String(ent.tracking ?? '').trim() === tracking) continue // já avisado
        ent.tracking = tracking
        ent.status = ME_STATUS_MAP[status] ?? ent.status ?? 'enviado'
        ent.me_status_raw = status
        ent.tracking_updated_at = new Date().toISOString()
        await admin.from('leads').update({ custom_fields: { ...lead.cf, entrega: ent } }).eq('id', lead.id)
        const cad = (lead.cf.cadastro ?? {}) as Record<string, unknown>
        const nomeCli = String(cad.nomeCompleto ?? name ?? '').trim()
        const fn = nomeCli.split(/\s+/).filter(Boolean)[0] || 'tudo bem'
        const wa = `Oi, ${fn}! 📦 Seu pedido Tricopill já foi postado nos Correios!\n\n*Código de rastreio:* ${tracking}\nAcompanhe aqui: https://www.linkcorreios.com.br/?id=${tracking}\n\nChega em alguns dias úteis. Qualquer dúvida, é só responder por aqui. 💚`
        const sent = await sendWapiText(admin, lead.phone, wa)
        const email = String(lead.cf.email ?? cad.email ?? '').trim()
        if (email) { const t = trackingEmail({ nome: nomeCli, tracking }); await sendEmail({ to: email, subject: t.subject, html: t.html }) }
        if (sent || email) notified += 1
      } catch (e) { errors.push({ order: tracking, error: e instanceof Error ? e.message : String(e) }) }
    }
  }
  return json({ ok: true, scanned, matched, notified, errors })
})
