import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { getValidMeToken, melhorEnvioBaseUrl, meUserAgent } from '../_shared/melhorEnvio.ts'

// Relatório de ENVIOS do mês: lista os pedidos da conta Melhor Envio (autenticado).
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
function json(b: Record<string, unknown>, s = 200): Response { return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } }) }
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

const STATUS_PT: Record<string, string> = {
  pending: 'Pendente', paid: 'Pago', generated: 'Etiqueta gerada', released: 'Liberado',
  posted: 'Postado', delivered: 'Entregue', canceled: 'Cancelado', expired: 'Expirado',
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
  let tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  let p: Record<string, unknown> = {}
  try { const raw = await req.text(); p = raw ? JSON.parse(raw) : {} } catch { /* ignore */ }
  const month = String(p.month ?? '').trim() // YYYY-MM (vazio = todos recentes)

  let token = await getValidMeToken(admin, tenantId)
  if (!token && tenantId !== 'tricopill') { tenantId = 'tricopill'; token = await getValidMeToken(admin, tenantId) }
  if (!token) return json({ ok: true, shipments: [], note: 'Melhor Envio não configurado.' })

  const monthOf = (iso: string) => (iso || '').slice(0, 7)
  const shipments: Array<Record<string, unknown>> = []
  let stop = false
  for (let page = 1; page <= 8 && !stop; page++) {
    const r = await fetch(`${melhorEnvioBaseUrl()}/api/v2/me/orders?page=${page}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': meUserAgent() },
    })
    if (!r.ok) break
    const d = await r.json().catch(() => ({}))
    const orders = Array.isArray((d as { data?: unknown }).data) ? (d as { data: Array<Record<string, unknown>> }).data : []
    if (!orders.length) break
    for (const o of orders) {
      const created = String(o.created_at ?? o.paid_at ?? '')
      const posted = o.posted_at ? String(o.posted_at) : null
      const ref = posted || created
      if (month) {
        const mm = monthOf(ref)
        if (mm > month) continue // mais novo que o mês pedido
        if (mm < month) { stop = true; break } // já passou (orders vêm do mais novo p/ o mais antigo)
      }
      const to = (o.to ?? {}) as Record<string, unknown>
      const svc = (o.service ?? {}) as Record<string, unknown>
      const status = String(o.status ?? '')
      shipments.push({
        cliente: String(to.name ?? '').trim() || 'Cliente',
        tracking: o.tracking ? String(o.tracking) : (o.self_tracking ? String(o.self_tracking) : null),
        status: STATUS_PT[status] ?? status,
        service: String(svc.name ?? o.service_id ?? ''),
        postedAt: ref || null,
        cep: digits(to.postal_code),
        cidade: String(to.city ?? '').trim(),
        priceCents: Math.round(Number(o.price ?? 0) * 100),
      })
    }
  }

  return json({ ok: true, shipments })
})
