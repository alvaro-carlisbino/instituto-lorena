import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { meOrderStatus } from '../_shared/melhorEnvio.ts'
import { sendEmail } from '../_shared/resend.ts'
import { trackingEmail } from '../_shared/emails.ts'

// Poller de RASTREIO do Melhor Envio: como a etiqueta costuma ser finalizada no painel do ME
// (sem hook no nosso código), este cron consulta o status/rastreio dos envios pendentes e,
// quando o RASTREIO aparece pela 1ª vez, manda o e-mail de "pedido enviado" ao cliente.
// Idempotente: só dispara e-mail quando o tracking muda. Auth: pg_cron com anon Bearer.

const TENANT_ID = 'tricopill'
const ME_STATUS_MAP: Record<string, string> = {
  pending: 'pronto', released: 'pronto', generated: 'pronto',
  posted: 'enviado', delivered: 'entregue', canceled: 'cancelado', cancelled: 'cancelado',
}
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  // Envios com pedido/carrinho ME, ainda não entregues/cancelados.
  const { data, error } = await admin
    .from('leads')
    .select('id, patient_name, custom_fields')
    .eq('tenant_id', TENANT_ID)
    .not('custom_fields->entrega->>me_cart_id', 'is', null)
    .limit(80)
  if (error) return json({ ok: false, error: error.message }, 500)

  let scanned = 0, updated = 0, emailed = 0
  const errors: Array<{ id: string; error: string }> = []
  for (const row of (data ?? []) as Array<{ id: string; patient_name?: string; custom_fields?: Record<string, unknown> }>) {
    const cf = (row.custom_fields ?? {}) as Record<string, unknown>
    const ent = { ...((cf.entrega ?? {}) as Record<string, unknown>) }
    const status = String(ent.status ?? '')
    if (status === 'entregue' || status === 'cancelado') continue
    const orderId = String(ent.me_cart_id ?? ent.me_order_id ?? '').trim()
    if (!orderId) continue
    scanned += 1
    try {
      const st = await meOrderStatus(admin, TENANT_ID, orderId)
      if (!st.ok) continue
      const prevTracking = String(ent.tracking ?? '').trim()
      const mapped = st.status ? ME_STATUS_MAP[st.status.toLowerCase()] : undefined
      let changed = false
      if (mapped && mapped !== ent.status) { ent.status = mapped; changed = true }
      if (st.tracking && st.tracking !== prevTracking) { ent.tracking = st.tracking; changed = true }
      if (st.status) ent.me_status_raw = st.status
      if (changed) {
        ent.tracking_updated_at = new Date().toISOString()
        await admin.from('leads').update({ custom_fields: { ...cf, entrega: ent } }).eq('id', row.id)
        updated += 1
      }
      // Rastreio NOVO → e-mail "pedido enviado" ao cliente (best-effort).
      if (st.tracking && st.tracking !== prevTracking) {
        const cad = (cf.cadastro ?? {}) as Record<string, unknown>
        const email = String(cf.email ?? cad.email ?? '').trim()
        if (email) {
          const t = trackingEmail({ nome: String(cad.nomeCompleto ?? row.patient_name ?? ''), tracking: st.tracking })
          const r = await sendEmail({ to: email, subject: t.subject, html: t.html })
          if (r.ok) emailed += 1
        }
      }
    } catch (e) {
      errors.push({ id: row.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return json({ ok: true, scanned, updated, emailed, errors })
})
