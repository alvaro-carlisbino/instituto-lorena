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
import { notifyAgents } from '../_shared/notifyAgents.ts'
import {
  createMeShipment,
  getMeSender,
  meConnectionStatus,
  melhorEnvioSandbox,
  meSenderMissing,
  setMeSender,
  type MeAddress,
  type MeProduct,
} from '../_shared/melhorEnvio.ts'

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

    return json({
      ok: true, finalized: res.finalized, cartId: res.cartId, tracking: res.tracking,
      protocol: res.protocol, printUrl: res.printUrl, stage: res.stage,
    })
  }

  return json({ error: 'unknown_action' }, 400)
})
