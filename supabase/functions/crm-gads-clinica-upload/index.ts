import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { uploadGoogleAdsConversion } from '../_shared/conversions.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Sobe pro Google Ads da CLÍNICA (conta 612-036-9894, acessada pela MCC 892-820-6652) as duas
// conversões de quem chegou por anúncio na landing /consulta:
//   · "Lead landing (CRM)": deixou nome e WhatsApp na landing, com gclid. Sinal de volume.
//   · "Consulta marcada (CRM)": a Shosp mostrou uma CONSULTA marcada depois desse clique.
//     É a conversão principal: o Meta otimiza por conversa e a conversa paga vira consulta em
//     1,4%; aqui a conta aprende com quem de fato marcou.
//
// Quem escolhe o que falta subir é `crm_gads_clinica_pendentes()` (SQL), a partir do evento
// `landing_lead`/`prebooking`, que guarda o gclid do clique para sempre. `leads.attribution` só
// guarda a última origem e perderia o gclid.
//
// Varredura idempotente: `gads_conversoes_enviadas` (tipo, ref) marca o que subiu, gravado só
// depois do OK e com o protocolo (requestId). O `transactionId` fixo faz o Google descartar reenvio.
// Sem trava *_ENABLED de propósito (subir conversão não fala com paciente), como o
// crm-gads-lead-upload. Para ver sem enviar: {"dry": true}.
// ─────────────────────────────────────────────────────────────────────────────

const CUSTOMER_ID = (Deno.env.get('GOOGLE_ADS_CLINICA_CUSTOMER_ID') ?? '6120369894').trim()
const LOGIN_ID = (Deno.env.get('GOOGLE_ADS_CLINICA_LOGIN_ID') ?? '8928206652').trim()
const ACAO: Record<string, string> = {
  lead_landing: (Deno.env.get('GOOGLE_ADS_CLINICA_LEAD_ACTION_ID') ?? '7795576947').trim(),
  consulta_marcada: (Deno.env.get('GOOGLE_ADS_CLINICA_CONSULTA_ACTION_ID') ?? '7795576944').trim(),
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

type Pendente = { tipo: string; ref: string; lead_id: string | null; gclid: string; quando: string; detalhe: string | null }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const provided = (req.headers.get('x-cron-secret') ?? '').trim()
  const { data: seg } = await admin.from('app_cron_secrets').select('secret').eq('key', 'gads_clinica').maybeSingle()
  const esperado = String((seg as { secret?: string } | null)?.secret ?? '').trim()
  if (!esperado || provided !== esperado) return json({ error: 'unauthorized' }, 401)

  let corpo: { dry?: boolean; validar?: boolean; conta?: string; login?: string; acao?: string } = {}
  try { corpo = await req.json() } catch { /* corpo vazio = envio de verdade */ }
  const dry = corpo.dry === true

  // {"validar": true}: confere com o Google (validateOnly) se a conta, a MCC e as duas ações
  // aceitam envio, sem registrar conversão. Serve para provar o caminho antes do 1º lead real.
  if (corpo.validar === true) {
    const testes: Record<string, unknown> = {}
    // conta/login/acao no corpo trocam o destino do teste (login "" = sem conta de login).
    const alvo = corpo.acao ? { teste: corpo.acao } : ACAO
    for (const [tipo, acaoId] of Object.entries(alvo)) {
      testes[tipo] = await uploadGoogleAdsConversion({
        gclid: 'Cj0KCQjw_teste_validacao', valueReais: 0, orderId: `validacao:${tipo}`, actionId: acaoId,
        customerId: corpo.conta ?? CUSTOMER_ID, loginCustomerId: corpo.login ?? LOGIN_ID, validateOnly: true,
      })
    }
    return json({ ok: true, validar: true, conta: CUSTOMER_ID, testes })
  }

  const { data, error } = await admin.rpc('crm_gads_clinica_pendentes')
  if (error) return json({ error: 'consulta_falhou', detalhe: error.message }, 500)
  const pendentes = (data ?? []) as Pendente[]

  const resultado = { pendentes: pendentes.length, enviados: 0, falhas: 0, por_tipo: {} as Record<string, number>, erros: [] as string[] }
  for (const p of pendentes) resultado.por_tipo[p.tipo] = (resultado.por_tipo[p.tipo] ?? 0) + 1
  if (dry) return json({ ok: true, dry, ...resultado, amostra: pendentes.slice(0, 5).map((p) => ({ ...p, gclid: `${p.gclid.slice(0, 8)}…` })) })

  for (const p of pendentes) {
    const acaoId = ACAO[p.tipo]
    if (!acaoId) continue
    const r = await uploadGoogleAdsConversion({
      gclid: p.gclid,
      valueReais: 0,
      orderId: `${p.tipo}:${p.ref}`,
      when: new Date(p.quando),
      actionId: acaoId,
      customerId: CUSTOMER_ID,
      loginCustomerId: LOGIN_ID,
    })
    if (!r.ok) {
      resultado.falhas++
      if (resultado.erros.length < 5) resultado.erros.push(`${p.tipo} ${p.ref.slice(0, 12)}: ${r.error ?? 'erro'}`)
      continue
    }
    const { error: errMarca } = await admin.from('gads_conversoes_enviadas').insert({
      tipo: p.tipo, ref: p.ref, tenant_id: 'instituto-lorena', lead_id: p.lead_id, gclid: p.gclid,
      acao_id: acaoId, quando: p.quando, detalhe: p.detalhe, request_id: r.requestId ?? null,
    })
    // Perder a marca custa um reenvio (o Google deduplica pelo transactionId), não uma conversão.
    if (errMarca && resultado.erros.length < 5) resultado.erros.push(`marca ${p.tipo}: ${errMarca.message}`)
    resultado.enviados++
  }

  return json({ ok: true, dry, conta: CUSTOMER_ID, ...resultado })
})
