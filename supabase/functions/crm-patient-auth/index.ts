import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { resolveOutboundProviderForLead } from '../_shared/whatsapp/resolveProvider.ts'
import { sendEmail } from '../_shared/resend.ts'
import {
  createManychatWhatsappSubscriber,
  pushManychatWhatsappDmAfterReply,
  readManychatPushConfigFromEnv,
  sendManychatText,
} from '../_shared/manychatPublicApi.ts'

// Login do paciente nos apps (Instituto Lorena): CPF + código de 6 dígitos.
//
// Por que CPF e não telefone: dos 690 pacientes no espelho Shosp, 676 têm CPF
// (98%), 658 e-mail (95%) e só 325 celular (47%). Login por WhatsApp sozinho
// deixaria metade dos pacientes de fora. Sem senha, de propósito — paciente
// esquece, e senha é passivo de segurança sem contrapartida aqui.
//
// A resposta do `request` é SEMPRE a mesma, ache ou não ache o CPF. Confirmar
// "este CPF existe" num app de clínica capilar é entregar de graça a informação
// de que a pessoa é paciente daqui. O app mostra "se o CPF estiver cadastrado,
// enviamos o código" e oferece o contato da clínica para quem não receber.
//
// Fluxo do token: verificado o código, geramos um magic link pelo Admin API e
// devolvemos só o `token_hash`; o app troca por sessão com
// supabase.auth.verifyOtp({ token_hash, type: 'email' }). Nenhum segredo do
// servidor sai daqui.

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

const TENANT = 'instituto-lorena'
const CODE_TTL_MIN = 10
const RESEND_GAP_S = 60
const MAX_ATTEMPTS = 5
/** Domínio interno: o paciente nunca vê nem usa este e-mail, é só a chave no auth. */
const AUTH_EMAIL_DOMAIN = 'pacientes.institutolorena.local'

const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '')

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hashCode(cpf: string, code: string): Promise<string> {
  const pepper = Deno.env.get('PATIENT_OTP_PEPPER') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return sha256(`${cpf}:${code}:${pepper}`)
}

function maskEmail(e: string): string {
  const [u, d] = e.split('@')
  if (!d) return '***'
  return `${u.slice(0, 1)}${'*'.repeat(Math.max(1, u.length - 1))}@${d}`
}

function maskPhone(p: string): string {
  return p.length < 4 ? '***' : `••••${p.slice(-4)}`
}

/** Comparação de hash sem vazar tempo. */
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
  const cpf = onlyDigits(body.cpf)
  if (cpf.length !== 11) return json({ ok: false, error: 'cpf_invalido' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  // ---------------------------------------------------------------- request
  if (action === 'request') {
    // Resposta neutra, montada antes de qualquer consulta, para o caminho
    // "não achei" custar o mesmo que o caminho "achei".
    const neutra = { ok: true, sent: true, ttl_min: CODE_TTL_MIN }

    const { data: found } = await admin.rpc('patient_find_by_cpf', { p_cpf: cpf })
    const pac = (Array.isArray(found) ? found[0] : found) as
      | { prontuario: string; nome: string | null; email: string | null; celular: string | null; lead_id: string | null }
      | undefined
    if (!pac) return json(neutra)

    const { data: prev } = await admin
      .from('patient_otps').select('last_sent_at')
      .eq('tenant_id', TENANT).eq('cpf', cpf).maybeSingle()
    if (prev?.last_sent_at && Date.now() - new Date(prev.last_sent_at).getTime() < RESEND_GAP_S * 1000) {
      return json({ ...neutra, throttled: true })
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const phone = onlyDigits(pac.celular)
    const email = (pac.email ?? '').trim()
    // WhatsApp primeiro (chega na hora); e-mail é o fallback que cobre os 53%
    // de pacientes sem celular no cadastro.
    const canWhats = phone.length >= 10
    const channel = canWhats ? 'whatsapp' : (email ? 'email' : null)
    if (!channel) return json(neutra)

    const texto = `Instituto Lorena: seu código de acesso é ${code}. Vale ${CODE_TTL_MIN} minutos. Se não foi você que pediu, ignore.`
    let delivered = false

    // Diagnóstico protegido. Sem isto, "não chegou" e "CPF não existe" são
    // indistinguíveis de fora (que é o ponto da resposta neutra) e depurar
    // entrega vira adivinhação. Só responde com o mesmo segredo do cron.
    const debugOn = (Deno.env.get('CIRURGIA_CRON_SECRET') ?? '') !== '' &&
      req.headers.get('x-debug-secret') === Deno.env.get('CIRURGIA_CRON_SECRET')
    const trilha: string[] = []
    const anota = (s: string) => {
      trilha.push(s)
      console.log(`[patient-auth] ${s}`)
    }

    // ORDEM DOS CANAIS, e o porquê de cada um:
    //   1) ManyChat  — é o padrão da clínica, nunca Evolution. Quando o paciente
    //      não é subscriber ainda, criamos o subscriber pelo telefone.
    //   2) W-API     — rede de segurança: se o ManyChat recusar (janela de 24h
    //      fechada, plano, número novo), o código ainda precisa chegar.
    //   3) e-mail    — só com remetente próprio da clínica (ver abaixo).
    // A linha "SDR" está gravada como channel_provider='evolution' no banco, o
    // que contradiz o padrão; por isso a Evolution é excluída aqui na mão.
    const to = phone.startsWith('55') ? phone : `55${phone}`

    if (channel === 'whatsapp') {
      const apiKey = (Deno.env.get('MANYCHAT_API_KEY') ?? '').trim()
      if (apiKey) {
        try {
          // O subscriber é procurado pelo TELEFONE, não pelo lead vinculado.
          // Motivo real (visto em produção): o shosp_patients de um paciente
          // apontava para o lead do TRICOPILL, enquanto o subscriber ManyChat
          // estava no lead da CLÍNICA, com o mesmo número. Amarrar no lead
          // vinculado perdia o subscriber e caía na criação, que dá
          // "Validation error" quando o contato de WhatsApp já existe (e o
          // findBySystemField do ManyChat não acha contato criado só com
          // whatsapp_phone — ver comentário em manychatPublicApi.ts).
          let subscriberId = ''
          const cauda = to.slice(-8)
          const { data: leadsFone } = await admin
            .from('leads')
            .select('id, phone, custom_fields, tenant_id')
            .eq('tenant_id', TENANT)
            .like('phone', `%${cauda}`)
            .limit(20)
          for (const l of (leadsFone ?? [])) {
            const cf = (l.custom_fields ?? {}) as Record<string, unknown>
            const s = String(cf.manychat_subscriber_id ?? '').trim()
            if (s) { subscriberId = s; break }
          }
          if (!subscriberId && pac.lead_id) {
            const { data: lead } = await admin
              .from('leads').select('custom_fields').eq('id', pac.lead_id).maybeSingle()
            const cf = (lead?.custom_fields ?? {}) as Record<string, unknown>
            subscriberId = String(cf.manychat_subscriber_id ?? '').trim()
          }
          if (subscriberId) anota(`manychat_subscriber_achado: ${subscriberId}`)
          if (!subscriberId) {
            const novo = await createManychatWhatsappSubscriber({
              apiKey, phone: to, firstName: pac.nome?.split(' ')[0] ?? undefined,
            })
            if (novo.ok) subscriberId = novo.subscriberId
            else anota(`manychat_criar_subscriber_falhou: ${novo.error}`)
          }
          if (subscriberId) {
            // Primeiro o caminho que o CRM já usa pra empurrar resposta
            // (setCustomField + sendFlow). Ele passa por um flow do ManyChat,
            // que é o único jeito de alcançar quem está fora da janela de 24h
            // do WhatsApp. sendContent direto só funciona dentro da janela.
            const cfg = readManychatPushConfigFromEnv()
            if (cfg) {
              const push = await pushManychatWhatsappDmAfterReply({
                apiKey: cfg.apiKey,
                subscriberId,
                replyText: texto,
                fieldId: cfg.fieldId,
                flowNs: cfg.flowNs,
                messageTag: cfg.messageTag || undefined,
              })
              delivered = push.ok
              if (!push.ok) anota(`manychat_flow_falhou: ${push.error ?? 'sem detalhe'}`)
              else anota('manychat_flow_ok')
            }
            if (!delivered) {
              const r = await sendManychatText(apiKey, subscriberId, texto)
              delivered = r.ok
              if (!r.ok) anota(`manychat_envio_falhou: ${r.error}`); else anota('manychat_ok')
            }
          }
        } catch (e) {
          anota(`manychat_excecao: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else {
        anota('manychat_sem_api_key')
      }

      if (!delivered) {
        try {
          const { data: linhas } = await admin
            .from('whatsapp_channel_instances')
            .select('id, channel_provider, sort_order')
            .eq('tenant_id', TENANT)
            .eq('active', true)
            .order('sort_order', { ascending: true })
          const rede = (linhas ?? []).find(
            (l) => String(l.channel_provider ?? '').toLowerCase() === 'wapi',
          )
          if (rede) {
            const { provider } = await resolveOutboundProviderForLead(
              admin,
              { id: pac.lead_id ?? '', whatsapp_instance_id: rede.id, tenant_id: TENANT },
              { bindDefault: false },   // login não pode reamarrar a linha do lead
            )
            await provider.sendMessage({ to, text: texto })
            delivered = true
            anota('wapi_ok')
          }
        } catch (e) {
          anota(`wapi_falhou: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }

    // E-mail só sai com remetente PRÓPRIO da clínica. O único domínio verificado
    // no Resend hoje é o do Tricopill, e mandar código do Instituto Lorena
    // assinado como Tricopill mistura duas marcas que não se misturam. Enquanto
    // PATIENT_OTP_FROM não estiver setado com o domínio da clínica, esse canal
    // fica desligado e o paciente sem WhatsApp fala com a clínica.
    const remetenteClinica = Deno.env.get('PATIENT_OTP_FROM')?.trim()
    if (!delivered && email && remetenteClinica) {
      const r = await sendEmail({
        to: email,
        from: remetenteClinica,
        subject: `Seu código de acesso: ${code}`,
        html: `<p>Olá${pac.nome ? `, ${pac.nome.split(' ')[0]}` : ''}.</p>
               <p>Seu código de acesso ao app do Instituto Lorena é:</p>
               <p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p>
               <p>Ele vale ${CODE_TTL_MIN} minutos. Se não foi você que pediu, ignore este e-mail.</p>`,
      })
      delivered = r.ok
      if (!r.ok) anota(`email_falhou: ${r.error}`); else anota('email_ok')
    } else if (!delivered && email && !remetenteClinica) {
      anota('email_desligado_sem_remetente_da_clinica')
    }

    if (!delivered) return json(debugOn ? { ...neutra, entregue: false, trilha } : neutra)

    await admin.from('patient_otps').upsert({
      tenant_id: TENANT,
      cpf,
      code_hash: await hashCode(cpf, code),
      channel: delivered && channel === 'whatsapp' ? 'whatsapp' : 'email',
      destination_masked: channel === 'whatsapp' && delivered ? maskPhone(phone) : maskEmail(email),
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
      attempts: 0,
      last_sent_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,cpf' })

    return json(debugOn ? { ...neutra, entregue: true, canal: channel, trilha } : neutra)
  }

  // ----------------------------------------------------------------- verify
  if (action === 'verify') {
    const code = onlyDigits(body.code)
    if (code.length !== 6) return json({ ok: false, error: 'codigo_invalido' }, 400)

    const { data: otp } = await admin
      .from('patient_otps').select('*')
      .eq('tenant_id', TENANT).eq('cpf', cpf).maybeSingle()
    if (!otp) return json({ ok: false, error: 'codigo_invalido' }, 401)

    if (new Date(otp.expires_at).getTime() < Date.now()) {
      await admin.from('patient_otps').delete().eq('tenant_id', TENANT).eq('cpf', cpf)
      return json({ ok: false, error: 'codigo_expirado' }, 401)
    }
    if (Number(otp.attempts ?? 0) >= MAX_ATTEMPTS) {
      await admin.from('patient_otps').delete().eq('tenant_id', TENANT).eq('cpf', cpf)
      return json({ ok: false, error: 'tentativas_excedidas' }, 429)
    }
    if (!timingSafeEqual(await hashCode(cpf, code), String(otp.code_hash))) {
      await admin.from('patient_otps')
        .update({ attempts: Number(otp.attempts ?? 0) + 1 })
        .eq('tenant_id', TENANT).eq('cpf', cpf)
      return json({ ok: false, error: 'codigo_invalido' }, 401)
    }

    const { data: found } = await admin.rpc('patient_find_by_cpf', { p_cpf: cpf })
    const pac = (Array.isArray(found) ? found[0] : found) as
      | { prontuario: string; nome: string | null; email: string | null; celular: string | null; lead_id: string | null }
      | undefined
    if (!pac) return json({ ok: false, error: 'paciente_nao_encontrado' }, 404)

    // Conta no auth com e-mail interno derivado do CPF. Não é o e-mail do
    // paciente de propósito: o cadastro do Shosp muda, o CPF não.
    const authEmail = `p${cpf}@${AUTH_EMAIL_DOMAIN}`
    let authUserId: string | null = null

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: authEmail,
      email_confirm: true,
      user_metadata: { kind: 'patient', prontuario: pac.prontuario, nome: pac.nome },
    })
    if (created?.user) {
      authUserId = created.user.id
    } else {
      // já existe: acha pelo registro da conta, senão pela listagem
      const { data: acc } = await admin
        .from('patient_accounts').select('auth_user_id')
        .eq('tenant_id', TENANT).eq('cpf', cpf).maybeSingle()
      authUserId = acc?.auth_user_id ?? null
      if (!authUserId) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
        authUserId = list?.users.find((u) => u.email === authEmail)?.id ?? null
      }
      if (!authUserId) {
        return json({ ok: false, error: 'auth_user_falhou', detail: createErr?.message }, 500)
      }
    }

    await admin.from('patient_accounts').upsert({
      tenant_id: TENANT,
      auth_user_id: authUserId,
      cpf,
      nome: pac.nome,
      shosp_prontuario: pac.prontuario,
      lead_id: pac.lead_id,
      email: pac.email,
      phone: onlyDigits(pac.celular) || null,
      status: 'ativo',
      last_login_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,cpf' })

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: authEmail,
    })
    if (linkErr || !link?.properties?.hashed_token) {
      return json({ ok: false, error: 'sessao_falhou', detail: linkErr?.message }, 500)
    }

    await admin.from('patient_otps').delete().eq('tenant_id', TENANT).eq('cpf', cpf)

    return json({
      ok: true,
      token_hash: link.properties.hashed_token,   // app troca por sessão no verifyOtp
      email: authEmail,
      nome: pac.nome,
      prontuario: pac.prontuario,
    })
  }

  return json({ ok: false, error: 'action_desconhecida' }, 400)
})
