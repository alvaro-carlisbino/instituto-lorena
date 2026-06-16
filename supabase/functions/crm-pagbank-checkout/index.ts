import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { createPagBankCheckout } from '../_shared/pagbank.ts'

// Gera um Link de Pagamento PagBank (Pix + cartão) para um lead — usado pelo botão
// manual no chat do Tricopill. Autenticado: o usuário só age sobre leads do polo
// ativo (RLS na leitura do lead). Devolve o link para o frontend inserir no compositor.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
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

  let payload: Record<string, unknown>
  try {
    const raw = await req.text()
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const leadId = String(payload.leadId ?? '').trim()

  let leadForCheckout: { id: string; patient_name?: string; phone?: string; custom_fields?: Record<string, unknown> | null }
  let tenantId = ''

  if (leadId) {
    // Vinculado a um lead: RLS garante que pertence ao polo ativo do usuário.
    const { data: lead, error: leadErr } = await userClient
      .from('leads')
      .select('id, patient_name, phone, custom_fields, tenant_id')
      .eq('id', leadId)
      .maybeSingle()
    if (leadErr || !lead) return json({ error: 'lead_not_found_or_forbidden' }, 404)
    const lf = lead as {
      id: string
      patient_name?: string
      phone?: string
      custom_fields?: Record<string, unknown>
      tenant_id?: string
    }
    tenantId = String(lf.tenant_id ?? '')
    leadForCheckout = { id: lf.id, patient_name: lf.patient_name, phone: lf.phone, custom_fields: lf.custom_fields ?? null }
    // Nome completo digitado no link → cadastro.nomeCompleto do lead, pra o Bling sair certo.
    const cn = payload.customerName != null ? String(payload.customerName).trim() : ''
    if (cn) {
      try {
        const cf = (lf.custom_fields ?? {}) as Record<string, unknown>
        const cad = (cf.cadastro ?? {}) as Record<string, unknown>
        await userClient.from('leads').update({ custom_fields: { ...cf, cadastro: { ...cad, nomeCompleto: cn } } }).eq('id', lf.id)
        leadForCheckout.custom_fields = { ...cf, cadastro: { ...cad, nomeCompleto: cn } }
      } catch { /* best-effort */ }
    }
  } else {
    // Link avulso (fora do chat): resolve o polo ativo e usa um "lead" sintético.
    const { data: tid } = await userClient.rpc('current_tenant_id')
    tenantId = typeof tid === 'string' ? tid.trim() : ''
    if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)
    const manualId = `manual-${crypto.randomUUID()}`
    leadForCheckout = {
      id: manualId,
      patient_name: payload.customerName != null ? String(payload.customerName) : 'Cliente Tricopill',
      phone: payload.phone != null ? String(payload.phone) : '',
      custom_fields: null,
    }
  }

  try {
    const out = await createPagBankCheckout(admin, {
      tenantId,
      lead: leadForCheckout,
      kit: payload.kit != null ? String(payload.kit) : undefined,
      amountCents: payload.amountCents != null ? Number(payload.amountCents) : undefined,
      description: payload.description != null ? String(payload.description) : undefined,
      couponCode: payload.couponCode != null ? String(payload.couponCode) : undefined,
      freightCents: payload.freightCents != null ? Number(payload.freightCents) : undefined,
      supabaseUrl,
    })
    return json({ ok: true, payLink: out.payLink, label: out.label, amountCents: out.amountCents, checkoutId: out.checkoutId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('pagbank_not_configured') ? 400 : 502
    return json({ ok: false, error: 'pagbank_checkout_failed', message: msg }, status)
  }
})
