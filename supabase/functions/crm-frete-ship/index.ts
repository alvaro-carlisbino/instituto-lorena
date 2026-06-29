/**
 * crm-frete-ship — gera o envio no Melhor Envio (carrinho → compra → etiqueta → impressão).
 *
 * Autenticado (painel): exige Authorization do usuário + resolve o polo via current_tenant_id.
 * Usa a conta ME conectada do polo (tenant_integrations.melhorenvio) por service-role.
 *
 * Ações (body.action):
 *   get_config   -> { connected, sandbox, sender, senderMissing[] }   (remetente salvo + status)
 *   set_sender   -> grava o remetente do polo { sender: {...} }
 *   create       -> emite o envio. Body:
 *      { leadId?, serviceId, to:{...}, products:[{name,quantity,unitaryValueCents}],
 *        box?:{weightKg,lengthCm,widthCm,heightCm}, insuranceCents?, finalize?, nonCommercial? }
 *      finalize=false (default) só adiciona ao carrinho; true compra + gera + imprime.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from '../_shared/crm.ts'
import { sendEmail } from '../_shared/resend.ts'
import { trackingEmail } from '../_shared/emails.ts'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import {
  createMeShipment,
  getMeSender,
  meConnectionStatus,
  meOrderStatus,
  melhorEnvioSandbox,
  meSenderMissing,
  setMeSender,
  type MeAddress,
  type MeProduct,
} from '../_shared/melhorEnvio.ts'

// Status do Melhor Envio → status logístico do CRM (custom_fields.entrega.status).
const ME_STATUS_MAP: Record<string, string> = {
  pending: 'pronto', released: 'pronto', generated: 'pronto',
  posted: 'enviado', delivered: 'entregue',
  canceled: 'cancelado', cancelled: 'cancelado',
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function readAddress(raw: unknown): MeAddress {
  const a = (raw ?? {}) as Record<string, unknown>
  const s = (k: string) => (a[k] != null ? String(a[k]).trim() : undefined)
  return {
    name: s('name'),
    phone: s('phone'),
    email: s('email'),
    document: s('document'),
    companyDocument: s('companyDocument'),
    stateRegister: s('stateRegister'),
    address: s('address'),
    number: s('number'),
    complement: s('complement'),
    district: s('district'),
    city: s('city'),
    stateAbbr: s('stateAbbr'),
    postalCode: s('postalCode'),
    note: s('note'),
  }
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
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  let p: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    p = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  const action = String(p.action ?? '')

  // ── get_config: status da conexão + remetente salvo ──
  if (action === 'get_config') {
    const { data } = await admin.from('tenant_integrations').select('melhorenvio').eq('tenant_id', tenantId).maybeSingle()
    const cfg = (data as { melhorenvio?: Record<string, unknown> } | null)?.melhorenvio ?? null
    const status = meConnectionStatus(cfg)
    const sender = await getMeSender(admin, tenantId)
    return json({ ok: true, connected: status.connected, sandbox: status.sandbox ?? melhorEnvioSandbox(), sender, senderMissing: meSenderMissing(sender) })
  }

  // ── set_sender: grava remetente do polo ──
  if (action === 'set_sender') {
    const sender = readAddress(p.sender)
    await setMeSender(admin, tenantId, sender)
    const saved = await getMeSender(admin, tenantId)
    return json({ ok: true, sender: saved, senderMissing: meSenderMissing(saved) })
  }

  // ── create: emite o envio ──
  if (action === 'create') {
    const serviceId = Math.round(Number(p.serviceId ?? 0))
    if (!Number.isFinite(serviceId) || serviceId <= 0) return json({ error: 'invalid_service' }, 400)

    const to = readAddress(p.to)
    const toMissing = meSenderMissing(to).filter((m) => m !== 'CPF ou CNPJ') // CPF do destinatário é opcional
    if (toMissing.length) return json({ error: 'destinatario_incompleto', missing: toMissing }, 400)

    const products: MeProduct[] = Array.isArray(p.products)
      ? (p.products as Array<Record<string, unknown>>).map((it) => ({
          name: String(it.name ?? 'Produto'),
          quantity: Math.max(1, Math.round(Number(it.quantity ?? 1))),
          unitaryValueCents: Math.max(0, Math.round(Number(it.unitaryValueCents ?? 0))),
        }))
      : []
    if (products.length === 0) return json({ error: 'sem_produtos' }, 400)

    const box = p.box && typeof p.box === 'object'
      ? {
          weightKg: Number((p.box as Record<string, unknown>).weightKg) || undefined,
          lengthCm: Number((p.box as Record<string, unknown>).lengthCm) || undefined,
          widthCm: Number((p.box as Record<string, unknown>).widthCm) || undefined,
          heightCm: Number((p.box as Record<string, unknown>).heightCm) || undefined,
        }
      : undefined
    const insuranceCents = p.insuranceCents != null ? Math.max(0, Math.round(Number(p.insuranceCents))) : undefined
    const finalize = p.finalize === true
    const nonCommercial = p.nonCommercial !== false

    const res = await createMeShipment(admin, tenantId, { to, serviceId, products, box, insuranceCents, finalize, nonCommercial })

    if (!res.ok) {
      return json({ ok: false, error: 'shipment_failed', stage: res.stage, message: res.error ?? 'falha', cartId: res.cartId }, 502)
    }

    // Registra na timeline do lead (se veio leadId) e notifica o time.
    const leadId = String(p.leadId ?? '').trim()
    if (leadId) {
      const recipient = to.name || 'Cliente'
      const note = res.finalized
        ? `🏷️ Etiqueta Melhor Envio gerada para ${recipient}.${res.tracking ? ` Rastreio: ${res.tracking}.` : ''}${res.printUrl ? ` Imprimir: ${res.printUrl}` : ''}`
        : `📦 Envio adicionado ao carrinho Melhor Envio (${recipient}). Finalize a compra no painel ME (carrinho #${res.cartId}).`
      try {
        await insertInteraction(admin, {
          leadId, patientName: recipient, channel: 'system', direction: 'system', author: 'Melhor Envio', content: note, tenantId,
        })
      } catch { /* ignore */ }
      try {
        await notifyAgents(admin, {
          leadId, kind: 'info', title: res.finalized ? 'Etiqueta gerada 🏷️' : 'Frete no carrinho 📦',
          body: note.slice(0, 180), includeOwner: false, tenantId,
        })
      } catch { /* ignore */ }
    }

    // E-mail de rastreio ao cliente quando a etiqueta foi GERADA pelo sistema (best-effort).
    if (res.finalized && res.tracking) {
      try {
        const custEmail = String(to.email ?? '').trim()
        if (custEmail) {
          const t = trackingEmail({ nome: to.name, tracking: res.tracking })
          await sendEmail({ to: custEmail, subject: t.subject, html: t.html })
        }
      } catch { /* ignore */ }
    }

    return json({
      ok: true, finalized: res.finalized, cartId: res.cartId, tracking: res.tracking,
      protocol: res.protocol, printUrl: res.printUrl, stage: res.stage,
    })
  }

  // ── refresh_tracking: lê o status/rastreio no Melhor Envio e atualiza o status logístico ──
  if (action === 'refresh_tracking') {
    const leadId = String(p.leadId ?? '').trim()
    if (!leadId) return json({ error: 'missing_lead' }, 400)
    // Pega o pedido ME mais recente desse lead.
    const { data: pay } = await admin
      .from('asaas_payments')
      .select('me_order_id')
      .eq('lead_id', leadId)
      .not('me_order_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const orderId = (pay as { me_order_id?: string } | null)?.me_order_id
    if (!orderId) return json({ ok: false, error: 'sem_envio_me' }, 200)

    const st = await meOrderStatus(admin, tenantId, orderId)
    if (!st.ok) return json({ ok: false, error: st.error ?? 'falha', me_order_id: orderId }, 200)

    const mapped = st.status ? ME_STATUS_MAP[st.status.toLowerCase()] : undefined
    // Atualiza custom_fields.entrega (status + rastreio), preservando o resto.
    const { data: lead } = await admin.from('leads').select('custom_fields').eq('id', leadId).maybeSingle()
    const cf = { ...(((lead as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>) }
    const ent = { ...((cf.entrega ?? {}) as Record<string, unknown>) }
    const prevTracking = String(ent.tracking ?? '').trim()
    if (mapped) ent.status = mapped
    if (st.tracking) ent.tracking = st.tracking
    ent.me_status_raw = st.status
    ent.tracking_updated_at = new Date().toISOString()
    cf.entrega = ent
    await admin.from('leads').update({ custom_fields: cf }).eq('id', leadId)

    // Rastreio NOVO (apareceu agora) → e-mail ao cliente (best-effort).
    if (st.tracking && st.tracking !== prevTracking) {
      try {
        const cad = (cf.cadastro ?? {}) as Record<string, unknown>
        const email = String(cad.email ?? '').trim()
        if (email) {
          const t = trackingEmail({ nome: String(cad.nomeCompleto ?? ''), tracking: st.tracking })
          await sendEmail({ to: email, subject: t.subject, html: t.html })
        }
      } catch { /* ignore */ }
    }

    return json({ ok: true, me_status: st.status, mapped: mapped ?? null, tracking: st.tracking })
  }

  return json({ error: 'unknown_action' }, 400)
})
