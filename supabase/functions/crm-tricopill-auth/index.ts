import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { resolveOutboundProviderForLead } from '../_shared/whatsapp/resolveProvider.ts'
import { sendEmail } from '../_shared/resend.ts'

// Login do cliente Tricopill no app: telefone + código de 6 dígitos.
//
// Aqui a chave é o TELEFONE, ao contrário do app da clínica (que usa CPF): o
// cliente Tricopill nasce de uma conversa no WhatsApp, e `tricopill_customers`
// já é chaveado por telefone desde o site.
//
// Também ao contrário da clínica, a resposta NÃO precisa ser neutra: "este
// telefone comprou suplemento" não é dado de saúde de terceiro, e o cliente
// digitou o próprio número. Aqui vale a UX de dizer "não achamos esse número".

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

const TENANT = 'tricopill'
const CODE_TTL_MIN = 10
const RESEND_GAP_S = 60
const MAX_ATTEMPTS = 5
const AUTH_EMAIL_DOMAIN = 'clientes.tricopill.local'

const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hashCode(phone: string, code: string): Promise<string> {
  const pepper = Deno.env.get('PATIENT_OTP_PEPPER') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return sha256(`${phone}:${code}:${pepper}`)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return json({ ok: false, error: 'invalid_json' }, 400) }

  const action = String(body.action ?? 'request')
  let phone = onlyDigits(body.phone)
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`
  if (phone.length < 12) return json({ ok: false, error: 'telefone_invalido' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data: found } = await admin.rpc('customer_find_by_phone', { p_phone: phone })
  const cli = (Array.isArray(found) ? found[0] : found) as
    | { id: string; phone: string; name: string | null; email: string | null }
    | undefined

  if (action === 'request') {
    if (!cli) return json({ ok: false, error: 'cliente_nao_encontrado' }, 404)

    const { data: prev } = await admin
      .from('patient_otps').select('last_sent_at')
      .eq('tenant_id', TENANT).eq('cpf', phone).maybeSingle()
    if (prev?.last_sent_at && Date.now() - new Date(prev.last_sent_at).getTime() < RESEND_GAP_S * 1000) {
      return json({ ok: true, sent: true, throttled: true, ttl_min: CODE_TTL_MIN })
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const texto = `Tricopill: seu código de acesso é ${code}. Vale ${CODE_TTL_MIN} minutos.`
    let delivered = false

    try {
      const { provider } = await resolveOutboundProviderForLead(
        admin, { id: '', whatsapp_instance_id: null, tenant_id: TENANT }, { bindDefault: false },
      )
      // Código que a própria pessoa acabou de pedir: transacional. Não entra em teto de
      // proativo (senão o login quebraria no dia movimentado), mas fica no livro-caixa.
      await provider.sendMessage({ to: phone, text: texto, metadata: { antiBanKind: 'transactional' } })
      delivered = true
    } catch (e) {
      console.error('[tricopill-auth] whatsapp falhou:', e instanceof Error ? e.message : String(e))
    }

    if (!delivered && cli.email) {
      const r = await sendEmail({
        to: cli.email,
        subject: `Seu código Tricopill: ${code}`,
        html: `<p>Seu código de acesso ao app Tricopill é:</p>
               <p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p>
               <p>Vale ${CODE_TTL_MIN} minutos.</p>`,
      })
      delivered = r.ok
    }
    if (!delivered) return json({ ok: false, error: 'envio_falhou' }, 502)

    // Reaproveita patient_otps: mesma mecânica (hash, expiração, tentativas),
    // separada por tenant_id. A coluna se chama `cpf` por causa da clínica.
    await admin.from('patient_otps').upsert({
      tenant_id: TENANT,
      cpf: phone,
      code_hash: await hashCode(phone, code),
      channel: 'whatsapp',
      destination_masked: `••••${phone.slice(-4)}`,
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
      attempts: 0,
      last_sent_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,cpf' })

    return json({ ok: true, sent: true, ttl_min: CODE_TTL_MIN, masked: `••••${phone.slice(-4)}` })
  }

  if (action === 'verify') {
    const code = onlyDigits(body.code)
    if (code.length !== 6) return json({ ok: false, error: 'codigo_invalido' }, 400)
    if (!cli) return json({ ok: false, error: 'cliente_nao_encontrado' }, 404)

    const { data: otp } = await admin
      .from('patient_otps').select('*')
      .eq('tenant_id', TENANT).eq('cpf', phone).maybeSingle()
    if (!otp) return json({ ok: false, error: 'codigo_invalido' }, 401)
    if (new Date(otp.expires_at).getTime() < Date.now()) {
      await admin.from('patient_otps').delete().eq('tenant_id', TENANT).eq('cpf', phone)
      return json({ ok: false, error: 'codigo_expirado' }, 401)
    }
    if (Number(otp.attempts ?? 0) >= MAX_ATTEMPTS) {
      await admin.from('patient_otps').delete().eq('tenant_id', TENANT).eq('cpf', phone)
      return json({ ok: false, error: 'tentativas_excedidas' }, 429)
    }
    if (!timingSafeEqual(await hashCode(phone, code), String(otp.code_hash))) {
      await admin.from('patient_otps')
        .update({ attempts: Number(otp.attempts ?? 0) + 1 })
        .eq('tenant_id', TENANT).eq('cpf', phone)
      return json({ ok: false, error: 'codigo_invalido' }, 401)
    }

    const authEmail = `c${phone}@${AUTH_EMAIL_DOMAIN}`
    let authUserId: string | null = null

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: authEmail,
      email_confirm: true,
      user_metadata: { kind: 'customer', tenant: TENANT, phone },
    })
    if (created?.user) {
      authUserId = created.user.id
    } else {
      const { data: row } = await admin
        .from('tricopill_customers').select('auth_user_id').eq('id', cli.id).maybeSingle()
      authUserId = row?.auth_user_id ?? null
      if (!authUserId) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
        authUserId = list?.users.find((u) => u.email === authEmail)?.id ?? null
      }
      if (!authUserId) return json({ ok: false, error: 'auth_user_falhou', detail: createErr?.message }, 500)
    }

    await admin.from('tricopill_customers')
      .update({ auth_user_id: authUserId, updated_at: new Date().toISOString() })
      .eq('id', cli.id)

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink', email: authEmail,
    })
    if (linkErr || !link?.properties?.hashed_token) {
      return json({ ok: false, error: 'sessao_falhou', detail: linkErr?.message }, 500)
    }

    await admin.from('patient_otps').delete().eq('tenant_id', TENANT).eq('cpf', phone)

    return json({
      ok: true,
      token_hash: link.properties.hashed_token,
      email: authEmail,
      nome: cli.name,
    })
  }

  return json({ ok: false, error: 'action_desconhecida' }, 400)
})
